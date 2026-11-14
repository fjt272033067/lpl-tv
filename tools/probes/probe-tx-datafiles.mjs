/**
 * probe-tx-datafiles.mjs — 扫 lpl.qq.com/web201612/data/ 下的候选数据文件
 *
 * 背景：腾讯把赛事数据做成一批全局 JS 文件挂在固定目录里
 * （已知：LOL_MATCH2_LIVE_BMATCH_LIST.js / LOL_NEWMATCH_LIVE_PAGE_LIVING_GAMES.js /
 *   LOL_MATCH2_TEAM_LIST.js）。它们由腾讯的发布流水线按不同节奏刷新
 *   （实测 TeamList 每小时、LivingGames 每 10 分钟、LiveBMatchList 停在开赛前）。
 *   其中可能有一份带着**局数/小局比分** —— 那才是真正的实时比分源。
 *
 * 做法：按命名规律枚举候选文件名，逐个 HEAD/GET，看 200 + 是否含 GEN/BLG +
 *   Last-Modified + 关键字段名（Score/Game/局）。
 *
 * 用法：node tools/probe-tx-datafiles.mjs
 */
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';
const BASE = 'https://lpl.qq.com/web201612/data/';

const NAMES = [
  // 已知的
  'LOL_MATCH2_LIVE_BMATCH_LIST.js',
  'LOL_NEWMATCH_LIVE_PAGE_LIVING_GAMES.js',
  'LOL_MATCH2_TEAM_LIST.js',
  // LIVE / BMATCH 变体
  'LOL_MATCH2_LIVE_MATCH_LIST.js',
  'LOL_MATCH2_LIVE_BMATCH_LIST_2.js',
  'LOL_MATCH2_LIVE_BMATCH_DETAIL.js',
  'LOL_MATCH2_LIVE_GAME_LIST.js',
  'LOL_MATCH2_LIVE_GAME_DETAIL.js',
  'LOL_MATCH2_LIVE_BO5.js',
  'LOL_MATCH2_LIVE_RESULT.js',
  'LOL_MATCH2_LIVE_SCORE.js',
  'LOL_MATCH2_BMATCH_LIST.js',
  'LOL_MATCH2_BMATCH_DETAIL.js',
  'LOL_MATCH2_GAME_LIST.js',
  'LOL_MATCH2_GAME_DETAIL.js',
  'LOL_MATCH2_RESULT_LIST.js',
  'LOL_MATCH2_RESULT_DETAIL.js',
  'LOL_MATCH2_MATCH_LIST.js',
  'LOL_MATCH2_MATCH_DETAIL.js',
  'LOL_MATCH2_SCHEDULE.js',
  'LOL_MATCH2_PLAYER_LIST.js',
  'LOL_MATCH2_PLAYER_DETAIL.js',
  'LOL_MATCH2_PLAYER_GAME_LIST.js',
  'LOL_MATCH2_NEWMATCH_LIST.js',
  'LOL_NEWMATCH_LIVE_PAGE_LIVE_GAMES.js',
  'LOL_NEWMATCH_LIVE_PAGE_MATCH_LIST.js',
  'LOL_NEWMATCH_LIVE_PAGE_BMATCH_LIST.js',
  'LOL_NEWMATCH_LIVE_PAGE_SCHEDULE.js',
  'LOL_NEWMATCH_LIVE_PAGE_GAME_LIST.js',
  'LOL_NEWMATCH_MATCH_LIST.js',
  'LOL_NEWMATCH_BMATCH_LIST.js',
  'LOL_MATCH2_LIVE_BMATCH.js',
  'LOL_MATCH2_HOT_SEARCH.js',
  'LOL_MATCH2_NEWS_LIST.js',
];

async function probe(name) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 10000);
  try {
    const res = await fetch(BASE + name + '?t=' + Date.now(), {
      signal: ac.signal,
      headers: { 'User-Agent': UA, Referer: 'https://lpl.qq.com/' },
    });
    if (!res.ok) {
      clearTimeout(timer);
      return { name, status: res.status, ok: false };
    }
    const text = await res.text();
    clearTimeout(timer);
    const hasGen = /GEN|BLG/i.test(text);
    // 找可能承载局数/小局比分的字段名
    const fields = new Set();
    for (const m of text.matchAll(/"([A-Za-z_]*(?:Score|Game|Count|Num|Result|State|Status)[A-Za-z_]*)"\s*:/g)) {
      fields.add(m[1]);
    }
    return {
      name,
      status: res.status,
      ok: true,
      len: text.length,
      lm: res.headers.get('last-modified'),
      age: res.headers.get('age'),
      hasGen,
      fields: [...fields].slice(0, 24),
      head: text.slice(0, 120).replace(/\s+/g, ' '),
    };
  } catch (e) {
    clearTimeout(timer);
    return { name, ok: false, error: e.message };
  }
}

const results = [];
for (const n of NAMES) {
  const r = await probe(n);
  results.push(r);
  if (r.ok) {
    console.log(
      `[HIT ] ${r.name}  len=${r.len} LM=${r.lm} Age=${r.age} GEN/BLG=${r.hasGen}\n        字段: ${r.fields.join(', ')}\n        ${r.head}`
    );
  } else {
    console.log(`[miss] ${r.name}  ${r.status || r.error}`);
  }
}

console.log('\n=== 命中汇总 ===');
for (const r of results.filter((x) => x.ok)) {
  console.log(`${r.name}: LM=${r.lm} len=${r.len} 字段=${r.fields.join('/')}`);
}
