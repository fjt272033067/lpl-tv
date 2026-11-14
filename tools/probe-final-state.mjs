/**
 * 探测总决赛实时数据源在 Node 侧的可达性。
 *
 * 背景：这些源是「跟赛解读」功能的数据地基，必须先分清
 *   ① Node 侧能不能取到（构建期/探测脚本用）
 *   ② 浏览器侧能不能取到（运行时用）
 * 两者的网络路径不同 —— 浏览器不继承系统代理，hosts 指向 127.0.0.1 的域名
 * 在 Node 里通、在浏览器里可能不通。所以本脚本只负责 Node 侧，
 * 浏览器侧必须另跑 tools/probe-browser-sources.mjs（无头）实测。
 *
 * 用法：node tools/probe-final-state.mjs
 */
import fs from 'node:fs';

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';

async function tryGet(label, url, { jsonp = false, timeout = 12000 } = {}) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeout);
  const t0 = Date.now();
  try {
    const res = await fetch(url, {
      signal: ac.signal,
      headers: { 'User-Agent': UA, Referer: 'https://lpl.qq.com/' },
    });
    const text = await res.text();
    const ms = Date.now() - t0;
    let parsed = null;
    if (jsonp) {
      const m = text.match(/\(([\s\S]*)\)\s*;?\s*$/);
      parsed = m ? JSON.parse(m[1]) : null;
    } else if (/^\s*[{[]/.test(text)) {
      try {
        parsed = JSON.parse(text);
      } catch {
        /* ignore */
      }
    }
    console.log(`[OK  ] ${label}  ${res.status}  ${ms}ms  len=${text.length}`);
    return { ok: true, status: res.status, text, parsed, ms };
  } catch (e) {
    const ms = Date.now() - t0;
    console.log(`[FAIL] ${label}  ${e.name}: ${e.message}  ${ms}ms`);
    return { ok: false, error: e.message, ms };
  } finally {
    clearTimeout(timer);
  }
}

/** 找出跟 GEN / BLG 相关的比赛（决赛及两队近期） */
function pickFinal(matches) {
  const arr = Array.isArray(matches) ? matches : [];
  return arr.filter(
    (m) =>
      /GEN|BLG/i.test(m.teamA || '') ||
      /GEN|BLG/i.test(m.teamB || '') ||
      /GEN|BLG/i.test(m.title || '')
  );
}

const out = { at: new Date().toISOString(), results: {} };

// ① 腾讯实时比赛列表（比分 + 局数）
const lbm = await tryGet(
  'LOL_MATCH2_LIVE_BMATCH_LIST.js',
  'https://lpl.qq.com/web201612/data/LOL_MATCH2_LIVE_BMATCH_LIST.js'
);
if (lbm.ok) {
  const m = lbm.text.match(/var\s+LiveBMatchList\s*=\s*(\{[\s\S]*?\});?\s*$/);
  const obj = m ? JSON.parse(m[1]) : null;
  const rows = obj && obj.msg ? Object.values(obj.msg) : [];
  const finals = rows.filter((r) => /GEN|BLG/i.test(JSON.stringify(r)));
  out.results.liveBMatch = { total: rows.length, finals };
  console.log('   实时表总行数:', rows.length, ' 决赛相关行:', finals.length);
  for (const r of finals.slice(0, 6)) {
    console.log('   →', JSON.stringify(r).slice(0, 400));
  }
}

// ② 正在直播的比赛（房间号 / 在线人数）
const lg = await tryGet(
  'LOL_NEWMATCH_LIVE_PAGE_LIVING_GAMES.js',
  'https://lpl.qq.com/web201612/data/LOL_NEWMATCH_LIVE_PAGE_LIVING_GAMES.js'
);
if (lg.ok) {
  const m = lg.text.match(/var\s+LivingGames\s*=\s*(\{[\s\S]*?\});?\s*$/);
  const obj = m ? JSON.parse(m[1]) : null;
  const rows = obj && obj.msg ? Object.values(obj.msg) : [];
  out.results.livingGames = { total: rows.length, rows: rows.slice(0, 20) };
  console.log('   在播条目:', rows.length);
}

// ③ 腾讯赛程 JSONP（实时）
const sched = await tryGet(
  'getMatchScheduleList(JSONP)',
  'https://lol.sw.game.qq.com/lol/commact/?proj=a20200415livelink&c=a20200415livelink&a=getMatchScheduleList&callback=__probe',
  { jsonp: true }
);
if (sched.ok && sched.parsed) {
  const p = sched.parsed;
  const rows = (p.data && (p.data.matchList || p.data.lists)) || [];
  out.results.txSchedule = { keys: Object.keys(p), rows: rows.length };
  console.log('   腾讯赛程顶层键:', Object.keys(p).join(','), ' rows:', rows.length);
}

// ④ 镜像赛程（CI 每 20 分钟刷新；含最终比分）
for (const base of [
  'https://gh-proxy.com/https://raw.githubusercontent.com/fjt272033067/lpl-tv/main/site/data',
  'https://gcore.jsdelivr.net/gh/fjt272033067/lpl-tv@main/site/data',
]) {
  const r = await tryGet(`${base.split('/')[2]} schedule.json`, `${base}/schedule.json`);
  if (r.ok && r.parsed) {
    const ms = r.parsed.matches || [];
    const f = pickFinal(ms).filter((x) => (x.date || '') >= '2026-11-01');
    out.results[`mirror_${base.split('/')[2]}`] = {
      updatedAt: r.parsed.updatedAt,
      total: ms.length,
      finals: f,
    };
    console.log('   updatedAt:', r.parsed.updatedAt, ' 决赛相关:', f.length);
    for (const x of f.slice(0, 8)) {
      console.log('   →', x.date, x.mode, x.teamA, x.score, x.teamB, '|', x.title);
    }
  }
}

// ⑤ 直播源快照（CI 烘焙的 B 站流地址 + 在线人数）
const lr = await tryGet(
  'mirror liverooms.json',
  'https://gh-proxy.com/https://raw.githubusercontent.com/fjt272033067/lpl-tv/main/site/data/liverooms.json'
);
if (lr.ok && lr.parsed) {
  const rooms = lr.parsed.rooms || lr.parsed.list || lr.parsed.liverooms || [];
  const gen = rooms.filter((x) => /GEN|BLG|决赛|全球总决赛|S16/i.test(JSON.stringify(x)));
  out.results.liverooms = {
    updatedAt: lr.parsed.updatedAt,
    total: rooms.length,
    finals: gen.slice(0, 12),
  };
  console.log('   liverooms updatedAt:', lr.parsed.updatedAt, ' 房间总数:', rooms.length);
  for (const x of gen.slice(0, 10)) {
    console.log('   →', JSON.stringify(x).slice(0, 260));
  }
}

const file = 'tools/probe-final-state.report.json';
fs.writeFileSync(file, JSON.stringify(out, null, 1), 'utf8');
console.log('\n报告已写入', file);
