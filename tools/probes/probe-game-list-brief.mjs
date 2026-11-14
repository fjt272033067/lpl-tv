/**
 * probe-game-list-brief.mjs — 实测 LOL_MATCH2_GAME_LIST_BRIEF.js 与赛事页 JS
 *
 * 腾讯赛事进度页 event.html 引用了 /web201612/data/LOL_MATCH2_GAME_LIST_BRIEF.js
 * —— 名字直指「小局列表」，很可能就是带局数的比分源。
 * 同时抓 event-data.js / event.js 看页面用哪个接口刷比分。
 */
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';

async function get(url) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 15000);
  try {
    const res = await fetch(url, {
      signal: ac.signal,
      headers: { 'User-Agent': UA, Referer: 'https://lpl.qq.com/web202301/event.html' },
    });
    const text = await res.text();
    return { ok: res.ok, status: res.status, text, lm: res.headers.get('last-modified') };
  } catch (e) {
    return { ok: false, error: e.message };
  } finally {
    clearTimeout(timer);
  }
}

console.log('########## 1. LOL_MATCH2_GAME_LIST_BRIEF.js ##########');
for (const name of [
  'LOL_MATCH2_GAME_LIST_BRIEF.js',
  'LOL_MATCH2_GAME_LIST_BRIEF_2.js',
  'LOL_MATCH2_GAME_LIST.js',
  'LOL_MATCH2_LIVE_GAME_LIST_BRIEF.js',
]) {
  const r = await get('https://lpl.qq.com/web201612/data/' + name);
  if (!r.ok) {
    console.log(`[miss] ${name}  ${r.status || r.error}`);
    continue;
  }
  console.log(`[HIT ] ${name}  len=${r.text.length}  LM=${r.lm}`);
  console.log('  头部:', r.text.slice(0, 260).replace(/\s+/g, ' '));
  const fields = new Set();
  for (const m of r.text.matchAll(/"([A-Za-z_]{2,30})"\s*:/g)) fields.add(m[1]);
  console.log('  字段:', [...fields].slice(0, 40).join(', '));
  const i = r.text.search(/GEN|BLG/i);
  if (i >= 0) console.log('  命中片段:', r.text.slice(Math.max(0, i - 300), i + 400).replace(/\s+/g, ' '));
  else console.log('  无 GEN/BLG 命中');
}

console.log('\n########## 2. 赛事页 JS 里的接口 ##########');
for (const js of [
  'https://lpl.qq.com/web202301/js/event-data.js',
  'https://lpl.qq.com/web202301/js/event.js',
  'https://lpl.qq.com/web201612/js/lplMatchConfig.js',
  'https://lpl.qq.com/web201612/js/lib.js',
]) {
  const r = await get(js);
  if (!r.ok) {
    console.log(`[miss] ${js}  ${r.status || r.error}`);
    continue;
  }
  console.log(`\n▸ ${js}  len=${r.text.length}`);
  const hits = new Set();
  for (const m of r.text.matchAll(/['"]([^'"\s]{4,160})['"]/g)) {
    const v = m[1];
    if (/commact|cgi-bin|\/api\/|getSchedule|getLive|getMatch|gameId|bMatchId|LIVE_BMATCH|GAME_LIST/i.test(v)) hits.add(v);
  }
  for (const h of [...hits].slice(0, 25)) console.log('    ', h);
}
