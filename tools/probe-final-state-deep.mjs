/**
 * 深度探测：决赛实时比分到底从哪个源能拿到？
 *
 * 已知：LOL_MATCH2_LIVE_BMATCH_LIST.js 与 getMatchScheduleList 都返回 0:0，
 *      而开赛时间已过 1 小时。需要验证：
 *   A. 腾讯这两个接口在「进行中」时到底给不给实时比分（完整字段 dump）
 *   B. Riot Esports 官方 API（esports-api.lolesports.com）是否可用 + 是否带 CORS
 *      —— 这是国际赛事最权威的实时源，且历史上允许跨域
 *   C. 直播源快照里的房间结构（哪些房间是聊天房、哪些有弹幕）
 */
import fs from 'node:fs';

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';

async function get(label, url, opts = {}) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), opts.timeout || 12000);
  const t0 = Date.now();
  try {
    const res = await fetch(url, {
      signal: ac.signal,
      headers: { 'User-Agent': UA, Referer: opts.referer || 'https://lpl.qq.com/' },
    });
    const cors = res.headers.get('access-control-allow-origin');
    const text = await res.text();
    console.log(`[OK  ] ${label}  ${res.status}  ${Date.now() - t0}ms  len=${text.length}  ACAO=${cors}`);
    return { ok: true, status: res.status, cors, text };
  } catch (e) {
    console.log(`[FAIL] ${label}  ${e.name}: ${e.message}`);
    return { ok: false, error: e.message };
  } finally {
    clearTimeout(timer);
  }
}

const out = { at: new Date().toISOString() };

/* ── A. 腾讯实时比赛表：完整字段 ───────────────────────── */
console.log('\n=== A. 腾讯 LiveBMatchList 完整行 ===');
const lbm = await get('LIVE_BMATCH_LIST', 'https://lpl.qq.com/web201612/data/LOL_MATCH2_LIVE_BMATCH_LIST.js');
if (lbm.ok) {
  const m = lbm.text.match(/var\s+LiveBMatchList\s*=\s*(\{[\s\S]*?\});?\s*$/);
  const obj = m ? JSON.parse(m[1]) : null;
  const rows = obj?.msg ? Object.values(obj.msg) : [];
  out.liveBMatchAll = rows;
  for (const r of rows) {
    console.log(`--- ${r.GameName} | ${r.bMatchName} | ${r.MatchDate} | ${r.GameProcName} | ${r.TeamNameA}(${r.ScoreA}) vs ${r.TeamNameB}(${r.ScoreB})`);
    console.log('    全字段:', JSON.stringify(r));
  }
}

/* ── A2. 在播比赛完整内容 ─────────────────────────────── */
console.log('\n=== A2. LIVING_GAMES 完整内容 ===');
const lg = await get('LIVING_GAMES', 'https://lpl.qq.com/web201612/data/LOL_NEWMATCH_LIVE_PAGE_LIVING_GAMES.js');
if (lg.ok) {
  out.livingGamesRaw = lg.text.slice(0, 4000);
  console.log(lg.text.slice(0, 2500));
}

/* ── A3. 腾讯赛程 JSONP 完整结构 ─────────────────────── */
console.log('\n=== A3. getMatchScheduleList 完整 JSONP ===');
const js = await get(
  'getMatchScheduleList',
  'https://lol.sw.game.qq.com/lol/commact/?proj=a20200415livelink&c=a20200415livelink&a=getMatchScheduleList&callback=__p'
);
if (js.ok) {
  out.txScheduleRaw = js.text.slice(0, 8000);
  const m = js.text.match(/__p\(([\s\S]*)\)/);
  if (m) {
    try {
      const p = JSON.parse(m[1]);
      console.log('顶层:', JSON.stringify(p).slice(0, 1200));
      // 深度搜索含 GEN/BLG 的对象
      const hits = [];
      const walk = (o, path, depth) => {
        if (depth > 6 || hits.length > 8) return;
        if (Array.isArray(o)) return o.forEach((v, i) => walk(v, `${path}[${i}]`, depth + 1));
        if (o && typeof o === 'object') {
          const s = JSON.stringify(o);
          if (/GEN|BLG/i.test(s) && s.length < 1500) hits.push({ path, v: o });
          for (const k of Object.keys(o)) walk(o[k], `${path}.${k}`, depth + 1);
        }
      };
      walk(p, '$', 0);
      for (const h of hits) console.log('HIT', h.path, JSON.stringify(h.v).slice(0, 700));
    } catch (e) {
      console.log('JSONP 解析失败:', e.message);
    }
  }
}

/* ── B. Riot Esports 官方 API ──────────────────────────── */
console.log('\n=== B. Riot Esports 官方 API ===');
for (const [label, url] of [
  ['getLive', 'https://esports-api.lolesports.com/persisted/gw/getLive?hl=en-US'],
  ['getSchedule LEC(10)', 'https://esports-api.lolesports.com/persisted/gw/getSchedule?hl=en-US&leagueId=10'],
]) {
  const r = await get(label, url, { referer: 'https://lolesports.com/' });
  if (r.ok) {
    try {
      const j = JSON.parse(r.text);
      out[label] = j;
      console.log('   keys:', Object.keys(j).join(','), ' status:', j.status);
      const s = JSON.stringify(j);
      const i = s.search(/GEN|BLG|Worlds|Global/i);
      if (i >= 0) console.log('   命中片段:', s.slice(Math.max(0, i - 200), i + 500));
      else console.log('   无 GEN/BLG 命中');
    } catch {
      console.log('   非 JSON:', r.text.slice(0, 300));
    }
  }
}

/* ── C. 直播源房间结构 ─────────────────────────────────── */
console.log('\n=== C. liverooms 快照结构 ===');
const lr = await get(
  'liverooms',
  'https://gh-proxy.com/https://raw.githubusercontent.com/fjt272033067/lpl-tv/main/site/data/liverooms.json'
);
if (lr.ok) {
  const j = JSON.parse(lr.text);
  out.liverooms = j;
  console.log('顶层键:', Object.keys(j).join(','));
  const rooms = j.rooms || [];
  console.log('updatedAt:', j.updatedAt, '房间数:', rooms.length);
  console.log('房间字段样例:', JSON.stringify(rooms[0]).slice(0, 600));
  console.log('全部房间标题:');
  for (const r of rooms) console.log(`   ${r.roomid} | ${r.title} | online=${r.online} | live=${r.live}`);
}

fs.writeFileSync('tools/probe-final-state.report.json', JSON.stringify(out, null, 1), 'utf8');
console.log('\n报告已更新 tools/probe-final-state.report.json');
