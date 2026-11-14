/**
 * probe-tx-more-files.mjs — 实测赛事页 JS 里新发现的数据文件
 *
 * 从 event.js / live.js 里挖到的：
 *   LOL_MATCH2_GAME_GAME{GameId}_INFO.js
 *   LOL_MATCH2_GAME_{GameId}_GAMETYPE_INFO.js
 *   LOL_MATCH2_MATCH_HOMEPAGE_BMATCH_LIST.js
 *   LOL_MATCH2_MATCH_HOMEPAGE_BMATCH_LIST_day360.js
 *   LOL_MATCH2_MATCH_HOMEPAGE_BMATCH_LIST_{sGameId}.js
 *   LOL_SGameList_Info.js
 */
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';
const BASE = 'https://lpl.qq.com/web201612/data/';

async function get(name) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 15000);
  try {
    const res = await fetch(BASE + name, {
      signal: ac.signal,
      headers: { 'User-Agent': UA, Referer: 'https://lpl.qq.com/web202301/live.html?bgid=246&bmid=13660' },
    });
    return { ok: res.ok, status: res.status, text: await res.text(), lm: res.headers.get('last-modified') };
  } catch (e) {
    return { ok: false, error: e.message };
  } finally {
    clearTimeout(timer);
  }
}

const NAMES = [
  'LOL_MATCH2_GAME_GAME246_INFO.js',
  'LOL_MATCH2_GAME_246_GAMETYPE_INFO.js',
  'LOL_MATCH2_GAME_246_INFO.js',
  'LOL_MATCH2_MATCH_HOMEPAGE_BMATCH_LIST.js',
  'LOL_MATCH2_MATCH_HOMEPAGE_BMATCH_LIST_day360.js',
  'LOL_MATCH2_MATCH_HOMEPAGE_BMATCH_LIST_246.js',
  'LOL_SGameList_Info.js',
  'LOL_MATCH2_NEWS_RECOMMEND_308_INFO.js',
  'LOL_NEWMATCH_FIRPAGE_GROUP_TEAM_SCORE.js',
];

for (const n of NAMES) {
  const r = await get(n);
  if (!r.ok) {
    console.log(`[miss] ${n}  ${r.status || r.error}`);
    continue;
  }
  console.log(`\n[HIT ] ${n}  len=${r.text.length}  LM=${r.lm}`);
  console.log('  头:', r.text.slice(0, 200).replace(/\s+/g, ' '));
  const fields = new Set();
  for (const m of r.text.matchAll(/"([A-Za-z_]{2,30})"\s*:/g)) fields.add(m[1]);
  console.log('  字段:', [...fields].slice(0, 40).join(', '));
  const i = r.text.search(/GEN|BLG/i);
  if (i >= 0) {
    console.log('  ★ 命中片段:', r.text.slice(Math.max(0, i - 400), i + 500).replace(/\s+/g, ' '));
  } else {
    console.log('  无 GEN/BLG');
  }
}
