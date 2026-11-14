/** 原文 dump 腾讯 LiveBMatchList 此刻的内容（确认比分字段现值） */
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0 Safari/537.36';
const res = await fetch('https://lpl.qq.com/web201612/data/LOL_MATCH2_LIVE_BMATCH_LIST.js', {
  headers: { 'User-Agent': UA, Referer: 'https://lpl.qq.com/', 'Cache-Control': 'no-cache' },
});
const t = await res.text();
console.log('Last-Modified:', res.headers.get('last-modified'), ' Age:', res.headers.get('age'), ' CC:', res.headers.get('cache-control'));
console.log('原文:\n', t);
