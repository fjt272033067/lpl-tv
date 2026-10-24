/* 解析 playwright 依赖位置，避免把别的项目的 node_modules 路径写死 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

function tryResolve(dir) {
  if (!dir) return null;
  const attempts = [];
  // 情况 A：dir 是项目目录，playwright 在 dir/node_modules 下
  attempts.push(path.join(dir, 'index.js'));
  // 情况 B：dir 本身就是 node_modules 目录
  attempts.push(path.join(dir, '..', 'index.js'));
  // 情况 C：dir 直接就是 playwright 包目录
  attempts.push(path.join(dir, '..', 'index.js'));
  for (const anchor of attempts) {
    try {
      const req = createRequire(anchor);
      const pw = req('playwright');
      if (pw && pw.chromium) return { pw, from: path.resolve(dir) };
    } catch (e) {
      /* try next */
    }
  }
  // 情况 D：直接按绝对路径加载包
  try {
    const direct = path.join(dir, 'playwright');
    if (fs.existsSync(direct)) {
      const req = createRequire(path.join(direct, 'index.js'));
      const pw = req(direct);
      if (pw && pw.chromium) return { pw, from: direct };
    }
  } catch (e) {
    /* try next */
  }
  return null;
}

/**
 * 查找顺序：
 *  1. PLAYWRIGHT_PATH 环境变量（指向 playwright 包目录或其父目录）
 *  2. 本项目 node_modules
 *  3. 同级目录下的其它项目 node_modules（按字母序，最多找 12 个）
 *  4. 全局 npm root
 */
export function resolvePlaywright() {
  const candidates = [];

  if (process.env.PLAYWRIGHT_PATH) {
    const p = path.resolve(process.env.PLAYWRIGHT_PATH);
    candidates.push(p, path.dirname(p));
  }
  candidates.push(ROOT, path.join(ROOT, 'node_modules'));

  // 同级 / 上级项目（最多向上找两层，覆盖 "工作区/项目" 与 "盘符/项目" 两种布局）
  for (const base of [path.dirname(ROOT), path.dirname(path.dirname(ROOT))]) {
    try {
      const siblings = fs
        .readdirSync(base, { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .flatMap((d) => [path.join(base, d.name), path.join(base, d.name, 'node_modules')]);
      candidates.push(...siblings.slice(0, 120));
    } catch (e) {
      /* ignore */
    }
  }

  // 全局
  try {
    const g = execFileSync('npm', ['root', '-g'], { encoding: 'utf8', windowsHide: true }).trim();
    if (g) candidates.push(g);
  } catch (e) {
    /* ignore */
  }

  const seen = new Set();
  for (const c of candidates) {
    if (!c || seen.has(c)) continue;
    seen.add(c);
    const hit = tryResolve(c);
    if (hit) return hit;
  }
  throw new Error(
    '找不到 playwright。请在项目目录执行：npm install --save-dev playwright  （或设置环境变量 PLAYWRIGHT_PATH 指向 playwright 包目录）'
  );
}

const isMain = (() => {
  try {
    if (!process.argv[1]) return false;
    return import.meta.url === pathToFileURL(process.argv[1]).href;
  } catch (e) {
    return false;
  }
})();
if (isMain) {
  const r = resolvePlaywright();
  console.log('playwright 解析成功：' + r.from);
}
