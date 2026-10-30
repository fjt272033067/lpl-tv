/*
 * 后台观察器：同时盯三件事，按 UTC 时间线记录。
 *   1) GitHub main 的 HEAD（git ls-remote，不受 API 速率限制）→ 判断 cron / CI 有没有出数据提交
 *   2) jsDelivr 上的 site/data/version.json 内容        → 判断 CDN 有没有跟上新提交
 *   3) raw.githubusercontent 上的同一文件               → 对照组
 *
 * 用法：node tools/watch-freshness.mjs [分钟]
 */
const MIN = Number(process.argv[2] || 20);
const END = Date.now() + MIN * 60 * 1000;

const RAW = 'https://raw.githubusercontent.com/fjt272033067/lpl-tv/main/site/data/version.json';
const JSD = 'https://cdn.jsdelivr.net/gh/fjt272033067/lpl-tv@main/site/data/version.json';
const GCORE = 'https://gcore.jsdelivr.net/gh/fjt272033067/lpl-tv@main/site/data/version.json';

const t = () => new Date().toISOString().slice(11, 19) + 'Z';

async function get(url) {
  const ctl = new AbortController();
  const to = setTimeout(() => ctl.abort(), 6000);
  try {
    const r = await fetch(url, { signal: ctl.signal, headers: { 'User-Agent': 'Mozilla/5.0' } });
    clearTimeout(to);
    if (!r.ok) return 'http' + r.status;
    const j = await r.json();
    return j.updatedAt + ' | liverooms=' + (j.files && j.files.liverooms) + ' | probe=' + (j.probe || '-');
  } catch (e) {
    clearTimeout(to);
    return 'ERR ' + (e && e.name === 'AbortError' ? 'timeout' : String(e && e.message).slice(0, 40));
  }
}

let last = '';
while (Date.now() < END) {
  const raws = await Promise.all([get(RAW), get(JSD), get(GCORE)]);
  const line = raws.join('   ||   ');
  if (line !== last) {
    console.log(`[${t()}] ${line}`);
    last = line;
  }
  await new Promise((r) => setTimeout(r, 30000));
}
console.log(`[${t()}] 观察结束`);
