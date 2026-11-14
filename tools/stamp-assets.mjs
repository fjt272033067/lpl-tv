/* =====================================================================
 * stamp-assets.mjs — 给 index.html 里的静态资源加构建戳
 *
 * 为什么需要它：站点托管在阿里云 OSS + CDN 上，资源对象会被缓存约 10 分钟
 * （响应里 `X-Swift-CacheTime: 2592000`、`Age: xxx`）。实测后果是：
 * 刚发完版，线上 /assets/app.js 仍返回**上一版**的旧文件（ETag 与本地不一致）。
 * 于是「我改了但用户看不到」，还会让发版后的线上验收拿到旧代码。
 *
 * 做法：把「参与计算的资源内容哈希」拼成 ?v=xxxx 挂到 URL 上。
 *   · CDN 按完整 URL 缓存 → 新戳 = 新对象 = 必然取到新文件；
 *   · 资源没变 → 哈希不变 → 戳不变 → 仍然命中 CDN 缓存，不会白白多下载；
 *   · index.html 与 app.js 的戳同源 → 不会出现「新页面配旧脚本」的错配。
 *
 * 用法：node tools/stamp-assets.mjs   （发布前跑一次）
 * ===================================================================== */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const SITE = path.join(ROOT, 'site');
const INDEX = path.join(SITE, 'index.html');

// 只有会变的资源参与哈希；vendor 下的库是固定的，不参与（免得无谓地让它们换 URL）
const STAMPED = ['assets/app.js', 'assets/style.css', 'assets/danmaku.js', 'assets/abuse-words.js'];
// 跟赛页（独立页）自己的资源 —— 不参与上面的哈希（它有独立的引用集合），
// 但也必须加戳，否则 CDN 会拿旧文件（和主站同样的坑）。
const MATCH_STAMPED = ['assets/match.js', 'assets/match.css', 'assets/live-danmaku.js', 'assets/abuse-words.js'];

function stampInto(html, list) {
  let changed = 0;
  for (const rel of list) {
    const re = new RegExp('("' + rel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')(\\?v=[0-9a-f]+)?(")');
    html = html.replace(re, (m, a, _old, b) => {
      changed++;
      return a + '?v=' + stamp + b;
    });
  }
  return { html, changed };
}

const h = crypto.createHash('sha1');
for (const rel of STAMPED) {
  const f = path.join(SITE, rel);
  if (!fs.existsSync(f)) continue;
  h.update(rel);
  h.update(fs.readFileSync(f));
}
const stamp = h.digest('hex').slice(0, 10);

let html = fs.readFileSync(INDEX, 'utf8');
let changed = 0;
{
  const r = stampInto(html, STAMPED);
  html = r.html;
  changed += r.changed;
}
if (html !== fs.readFileSync(INDEX, 'utf8')) fs.writeFileSync(INDEX, html, 'utf8');

// 跟赛页：独立戳（内容哈希与主站不同，避免互相牵连）
const MATCH_INDEX = path.join(SITE, 'final.html');
if (fs.existsSync(MATCH_INDEX)) {
  const mh = crypto.createHash('sha1');
  for (const rel of MATCH_STAMPED) {
    const f = path.join(SITE, rel);
    if (!fs.existsSync(f)) continue;
    mh.update(rel);
    mh.update(fs.readFileSync(f));
  }
  const mStamp = mh.digest('hex').slice(0, 10);
  const before = fs.readFileSync(MATCH_INDEX, 'utf8');
  const r = stampInto(before, MATCH_STAMPED);
  if (r.html !== before) fs.writeFileSync(MATCH_INDEX, r.html, 'utf8');
  console.log('构建戳 v=' + stamp + '（更新 ' + changed + ' 处资源引用）');
  console.log('跟赛页戳 v=' + mStamp + '（更新 ' + r.changed + ' 处资源引用）');
} else {
  console.log('构建戳 v=' + stamp + '（更新 ' + changed + ' 处资源引用）');
}
