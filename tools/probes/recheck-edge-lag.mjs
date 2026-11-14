/**
 * 复核两个结论：
 *  ① 腾讯静态表 LiveBMatchList 到底是「上游不更新」还是「边缘节点滞后副本」
 *  ② 镜像站的新鲜度是否真的不一致（同一时刻不同镜像给不同版本）
 *
 * 上一任交接书里写的是「腾讯疑似只在局间/局末更新，开赛 1 小时仍 0:0」——
 * 新会话实测推翻了它，说真相是边缘滞后。本脚本独立复核。
 */
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';

const now = () => new Date().toISOString().replace('T', ' ').slice(0, 19) + ' UTC';

async function head(label, url) {
  try {
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), 12000);
    const res = await fetch(url, {
      signal: ac.signal,
      headers: { 'User-Agent': UA, Referer: 'https://lpl.qq.com/' },
    });
    clearTimeout(t);
    const lm = res.headers.get('last-modified');
    const age = res.headers.get('age');
    const cc = res.headers.get('cache-control');
    const server = res.headers.get('server');
    const via = res.headers.get('via');
    const text = await res.text();
    const m = text.match(/"bMatchName":"([^"]*)"[^}]*?"ScoreA":"([^"]*)"[^}]*?"ScoreB":"([^"]*)"/);
    console.log(
      `${label}\n   status=${res.status} len=${text.length} Last-Modified=${lm} Age=${age} Cache=${cc}\n   Server=${server} Via=${via}\n   比分: ${m ? `${m[1]} ${m[2]}:${m[3]}` : '(无决赛行)'}\n   本机时间: ${now()}`
    );
    return { status: res.status, lm, age, cc, server, via, text, score: m ? m.slice(1) : null };
  } catch (e) {
    console.log(`${label}\n   FAIL ${e.name}: ${e.message}`);
    return { error: e.message };
  }
}

/* ① 腾讯静态表：多边缘对比 */
console.log('=== ① 腾讯 LiveBMatchList：边缘节点对比 ===');
const urls = [
  ['lpl.qq.com 直连', 'https://lpl.qq.com/web201612/data/LOL_MATCH2_LIVE_BMATCH_LIST.js'],
  ['加随机查询串（绕缓存）', 'https://lpl.qq.com/web201612/data/LOL_MATCH2_LIVE_BMATCH_LIST.js?_=' + Date.now()],
  ['CDN 主机名变体', 'https://lpl.qq.com/web201612/data/LOL_MATCH2_LIVE_BMATCH_LIST.js?v=2'],
  ['备用域名 lol.qq.com', 'https://lol.qq.com/web201612/data/LOL_MATCH2_LIVE_BMATCH_LIST.js'],
];
const results = [];
for (const [label, url] of urls) {
  results.push([label, await head(label, url)]);
}
const lms = results.map(([, r]) => r.lm).filter(Boolean);
console.log('\n   → 不同请求返回的 Last-Modified 集合:', [...new Set(lms)].join(' | ') || '(全无)');
console.log(
  '   → 判定:',
  new Set(lms).size > 1
    ? '**不同边缘返回不同版本 → 确认是边缘滞后副本，不是上游不更新**'
    : '所有边缘 Last-Modified 一致 → 上游确实是那个版本'
);

/* ② 镜像新鲜度：同一时刻各镜像给的 updatedAt */
console.log('\n=== ② 镜像站 schedule.json 新鲜度对比 ===');
const bases = {
  'gh-proxy': 'https://gh-proxy.com/https://raw.githubusercontent.com/fjt272033067/lpl-tv/main/site/data',
  'gcore.jsdelivr': 'https://gcore.jsdelivr.net/gh/fjt272033067/lpl-tv@main/site/data',
  'cdn.jsdelivr': 'https://cdn.jsdelivr.net/gh/fjt272033067/lpl-tv@main/site/data',
  'raw.gh(直连)': 'https://raw.githubusercontent.com/fjt272033067/lpl-tv/main/site/data',
};
for (const [name, base] of Object.entries(bases)) {
  try {
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), 15000);
    const res = await fetch(`${base}/schedule.json`, {
      signal: ac.signal,
      headers: { 'User-Agent': UA, 'Cache-Control': 'no-cache' },
    });
    clearTimeout(t);
    const j = await res.json();
    const fin = (j.matches || []).filter(
      (x) => (x.date || '').startsWith('2026-11-15') && /GEN|BLG/.test(x.title || '')
    );
    const score = fin.length ? fin[0].score : '(无决赛行)';
    console.log(`   ${name.padEnd(16)} updatedAt=${j.updatedAt}  决赛比分=${score}`);
  } catch (e) {
    console.log(`   ${name.padEnd(16)} FAIL ${e.message}`);
  }
}
console.log('   本机时间:', now());
