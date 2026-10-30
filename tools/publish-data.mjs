/* =====================================================================
 * publish-data.mjs — 把「站点运行需要的那几份 JSON」复制到数据仓目录
 *
 * 背景：站点支持「远端数据源」，运行时匿名读取该目录下的
 *       schedule.json / catalog.json / liverooms.json / version.json。
 *       这几份是机器生成的事实数据（腾讯公开赛程 + B站流地址），
 *       不含源码、不含弹幕语料、不含封面帧、不含任何本地路径。
 *
 * 用法：node tools/publish-data.mjs <目标目录>
 *   例：node tools/publish-data.mjs ../lpl-tv-data
 *       （CI 里把目标目录整个提交到公开仓库即可）
 * ===================================================================== */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA = path.resolve(__dirname, '..', 'site', 'data');

// 只发布这四个文件 —— 刻意不含 dm/（弹幕语料）与 cover/（直播画面帧）
const FILES = ['schedule.json', 'catalog.json', 'liverooms.json', 'version.json'];

const target = process.argv[2];
if (!target) {
  console.error('用法：node tools/publish-data.mjs <目标目录>');
  process.exit(1);
}

fs.mkdirSync(target, { recursive: true });
let copied = 0;
let bytes = 0;
for (const f of FILES) {
  const src = path.join(DATA, f);
  if (!fs.existsSync(src)) {
    console.log('  跳过（不存在）：' + f);
    continue;
  }
  const dst = path.join(target, f);
  fs.copyFileSync(src, dst);
  const size = fs.statSync(dst).size;
  bytes += size;
  copied++;
  console.log(`  ${f}  ${(size / 1024).toFixed(0)}KB`);
}
console.log(`已发布 ${copied} 个文件到 ${target}（共 ${(bytes / 1024).toFixed(0)}KB）`);

// 自检：确保没有把弹幕语料/封面帧一起带出去
const extra = fs.readdirSync(target).filter((f) => !FILES.includes(f));
if (extra.length) {
  console.error('⚠️ 目标目录里有计划外的文件：' + extra.join(', ') + '（不应发布）');
  process.exit(2);
}
