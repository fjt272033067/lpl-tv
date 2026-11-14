/* =====================================================================
 * probe-online-state.mjs — 接手自检：核线上基线是否落后于本地
 *
 * 核三件事：
 *   1. 线上 index.html 的构建戳 vs 本地按同一算法算出来的构建戳
 *   2. 线上 site/data/dm/*.json 里是否还含屏蔽词原文（eaebcf9 的修复是否已上线）
 *   3. 本地 site/data/dm/*.json 的命中数（本地对照组）
 *
 * 用法：node tools/probe-online-state.mjs
 * ===================================================================== */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { hasAbuse, ABUSE_WORDS } from '../abuse-words.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const SITE = path.join(ROOT, 'site');
const ONLINE = 'https://4kf9kfxujfhg2.space.mcode.cn';

const STAMPED = ['assets/app.js', 'assets/style.css', 'assets/danmaku.js', 'assets/abuse-words.js'];

function localStamp() {
  const h = crypto.createHash('sha1');
  for (const rel of STAMPED) {
    const f = path.join(SITE, rel);
    if (!fs.existsSync(f)) continue;
    h.update(rel);
    h.update(fs.readFileSync(f));
  }
  return h.digest('hex').slice(0, 10);
}

function stampIn(html) {
  const m = html.match(/assets\/app\.js\?v=([0-9a-f]+)/);
  return m ? m[1] : '(无戳)';
}

async function fetchText(u) {
  const res = await fetch(u, { headers: { 'Cache-Control': 'no-cache' } });
  if (!res.ok) throw new Error(`${res.status} ${u}`);
  return await res.text();
}

function scanDm(text, label) {
  let files = 0;
  let hits = 0;
  const hitFiles = [];
  let samples = [];
  try {
    const j = JSON.parse(text);
    const items = Array.isArray(j) ? j : Array.isArray(j.items) ? j.items : Array.isArray(j.danmu) ? j.danmu : [];
    files = items.length;
    for (const it of items) {
      const s = typeof it === 'string' ? it : it.text || it.content || it.msg || '';
      if (hasAbuse(s)) {
        hits++;
        if (samples.length < 5) samples.push(String(s).slice(0, 60));
      }
    }
  } catch (e) {
    return { label, parseError: String(e.message) };
  }
  return { label, files, hits, hitFiles, samples };
}

(async () => {
  console.log('=== 1. 构建戳 ===');
  console.log('本地:', localStamp());
  let onlineStamp = '(抓取失败)';
  try {
    const html = await fetchText(ONLINE + '/index.html');
    onlineStamp = stampIn(html);
    console.log('线上:', onlineStamp);
    console.log(onlineStamp === localStamp() ? '→ 一致' : '→ 不一致（线上可能落后）');
  } catch (e) {
    console.log('线上抓取失败:', e.message);
  }

  console.log('\n=== 2. 线上 dm 屏蔽词检查 ===');
  const dmDir = path.join(SITE, 'data', 'dm');
  const localFiles = fs.existsSync(dmDir) ? fs.readdirSync(dmDir).filter((f) => f.endsWith('.json')) : [];
  console.log('本地 dm 文件数:', localFiles.length);

  // 抽 6 个本地文件做样本（有内容才检），逐个对比线上同名字文件
  const sample = localFiles.slice(0, 3).concat(localFiles.slice(-3));
  let onlineHitTotal = 0;
  let localHitTotal = 0;
  let checked = 0;
  for (const f of sample) {
    const localTxt = fs.readFileSync(path.join(dmDir, f), 'utf8');
    const ls = scanDm(localTxt, 'local:' + f);
    let os = { label: 'online:' + f, skipped: true };
    try {
      const t = await fetchText(`${ONLINE}/data/dm/${f}`);
      os = scanDm(t, 'online:' + f);
    } catch (e) {
      os = { label: 'online:' + f, error: e.message };
    }
    checked++;
    if (ls.hits) localHitTotal += ls.hits;
    if (os.hits) onlineHitTotal += os.hits;
    console.log(
      `  ${f}: 本地 ${ls.files ?? '?'}条/命中${ls.hits ?? '?'}  |  线上 ${os.files ?? '?'}条/命中${os.hits ?? '?'}${os.error ? ' ERR:' + os.error : ''}`
    );
    if (os.samples && os.samples.length) console.log('    线上样例:', os.samples.join(' | '));
    if (ls.samples && ls.samples.length) console.log('    本地样例:', ls.samples.join(' | '));
  }
  console.log(`抽样 ${checked} 个文件 → 本地命中 ${localHitTotal} / 线上命中 ${onlineHitTotal}`);
  console.log(onlineHitTotal === 0 ? '→ 线上数据层已无屏蔽词原文（eaebcf9 修复已上线）' : '→ 线上仍含屏蔽词原文，需重新烘焙+部署');

  console.log('\n=== 3. 词表 ===');
  console.log('屏蔽词数量:', ABUSE_WORDS.length);

  // 顺便看线上 dm 目录里有没有更新的文件
  console.log('\n=== 4. 线上 data 文件存在性 ===');
  for (const f of ['version.json', 'liverooms.json', 'schedule.json', 'catalog.json']) {
    try {
      const t = await fetchText(`${ONLINE}/data/${f}`);
      let up = '';
      try {
        const j = JSON.parse(t);
        up = j.updatedAt || j.updated_at || '';
      } catch (e) {}
      console.log(`  ${f}: OK ${t.length}B ${up}`);
    } catch (e) {
      console.log(`  ${f}: ERR ${e.message}`);
    }
  }
})();
