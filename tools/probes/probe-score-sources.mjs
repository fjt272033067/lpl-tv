/**
 * probe-score-sources.mjs — 「实时比分到底从哪来」全候选源实测
 *
 * 核心假设要验证：腾讯 LiveBMatchList 的 ScoreA/ScoreB 一直停在 "0"，
 * 到底是「该字段不更新」还是「我们拿到的是 CDN 缓存副本」。
 * 做法：同�� URL 用三种取法（普通 / 加时间戳破缓存 / 带 no-cache 头）各取一次，
 * 比对响应头（Age / Cache-Control / Last-Modified / ETag）与内容哈希。
 *
 * 同时实测备选源：B 站直播间信息（标题/描述/公告）、腾讯的其它详情接口。
 *
 * 用法：node tools/probe-score-sources.mjs
 */
import crypto from 'node:crypto';

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';

async function get(label, url, opts = {}) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), opts.timeout || 12000);
  const t0 = Date.now();
  try {
    const headers = { 'User-Agent': UA, ...(opts.headers || {}) };
    const res = await fetch(url, { signal: ac.signal, headers, cache: opts.cache || 'default' });
    const text = await res.text();
    const h = (k) => res.headers.get(k);
    console.log(
      `[OK  ] ${label}  ${res.status}  ${Date.now() - t0}ms  len=${text.length}  ` +
        `Age=${h('age')} CC="${h('cache-control')}" LM=${h('last-modified')} ETag=${(h('etag') || '').slice(0, 24)} ` +
        `ACAO=${h('access-control-allow-origin')}`
    );
    return { ok: true, status: res.status, text, headers: res.headers, ms: Date.now() - t0 };
  } catch (e) {
    console.log(`[FAIL] ${label}  ${e.name}: ${e.message}`);
    return { ok: false, error: e.message };
  } finally {
    clearTimeout(timer);
  }
}

const sha = (s) => crypto.createHash('sha1').update(s).digest('hex').slice(0, 10);

function parseVar(text, name) {
  const m = text.match(new RegExp('var\\s+' + name + '\\s*=\\s*(\\{[\\s\\S]*?\\});?\\s*$'));
  if (!m) return null;
  try {
    return JSON.parse(m[1]);
  } catch {
    return null;
  }
}

function finalsFrom(obj) {
  const rows = obj && obj.msg ? Object.values(obj.msg).filter((x) => typeof x === 'string' && x) : [];
  return rows
    .map((r) => {
      try {
        return JSON.parse(r);
      } catch {
        return null;
      }
    })
    .filter(Boolean)
    .filter((r) => /GEN|BLG/i.test(JSON.stringify(r)));
}

console.log('########## 1. 腾讯 LiveBMatchList：是不是 CDN 缓存副本？ ##########');
const LBM = 'https://lpl.qq.com/web201612/data/LOL_MATCH2_LIVE_BMATCH_LIST.js';
const variants = [
  ['A 普通取法', LBM, {}],
  ['B 加时间戳破缓存', LBM + '?t=' + Date.now(), {}],
  ['C 带 no-cache 头', LBM, { headers: { 'Cache-Control': 'no-cache', Pragma: 'no-cache' } }],
];
const lbmTexts = [];
for (const [label, url, opts] of variants) {
  const r = await get(label, url, opts);
  if (!r.ok) continue;
  lbmTexts.push({ label, sha: sha(r.text), text: r.text });
  const obj = parseVar(r.text, 'LiveBMatchList');
  const fin = finalsFrom(obj);
  for (const f of fin) {
    console.log(
      `    → ${f.GameName} | ${f.bMatchName} | ${f.MatchDate} | ${f.TeamNameA}=${f.ScoreA} : ${f.ScoreB}=${f.TeamNameB} | GameProc=${f.GameProcName}`
    );
  }
}
if (lbmTexts.length >= 2) {
  const same = new Set(lbmTexts.map((x) => x.sha)).size === 1;
  console.log(same ? '→ 三种取法内容完全一致（哈希 ' + lbmTexts[0].sha + '）' : '→ 三种取法内容不一致！说明存在 CDN 缓存差异');
  for (const x of lbmTexts) console.log('   ', x.label, x.sha);
}

console.log('\n########## 2. 腾讯 LivingGames（Title 里的比分位？） ##########');
const LG = 'https://lpl.qq.com/web201612/data/LOL_NEWMATCH_LIVE_PAGE_LIVING_GAMES.js';
for (const [label, url] of [
  ['普通', LG],
  ['破缓存', LG + '?t=' + Date.now()],
]) {
  const r = await get(label, url);
  if (!r.ok) continue;
  const obj = parseVar(r.text, 'LivingGames');
  console.log('    lastUpdateTime:', obj && obj.lastUpdateTime);
  console.log('    Title:', (obj && obj.msg && obj.msg.Title) || '');
}

console.log('\n########## 3. B 站直播间信息（标题/描述是否带比分） ##########');
for (const rid of [7734200, 1722160589, 8016907, 13242941, 1967216004]) {
  const r = await get(
    `bili getInfoByRoom ${rid}`,
    `https://api.live.bilibili.com/xlive/web-room/v1/index/getInfoByRoom?room_id=${rid}`,
    { headers: { Referer: `https://live.bilibili.com/room/${rid}` } }
  );
  if (!r.ok) continue;
  try {
    const j = JSON.parse(r.text);
    const ri = j.data && j.data.room_info;
    console.log(
      `    ${rid}: code=${j.code} live_status=${j.data && j.data.live_status} title="${ri && ri.title}" desc="${(ri && ri.description || '').slice(0, 80)}"`
    );
    if (j.data && j.data.room_info && j.data.room_info.tags) {
      console.log('        tags:', JSON.stringify(j.data.room_info.tags).slice(0, 200));
    }
  } catch (e) {
    console.log('    解析失败:', e.message, r.text.slice(0, 150));
  }
}

console.log('\n########## 4. 腾讯其它可能带比分的接口 ##########');
const txCandidates = [
  ['esports detail htm', 'https://lol.qq.com/esports/detail.htm?GID=246'],
  ['lpl live htm', 'https://lpl.qq.com/live/index.shtml'],
  ['match2 match list', 'https://lpl.qq.com/web201612/data/LOL_MATCH2_MATCH_LIST.js'],
  ['commact getMatchDetail', 'https://lol.qq.com/commact/?proj=a20200415livelink&c=a20200415livelink&a=getMatchDetail&bMatchId=13660&callback=__p'],
  ['apps.game match info', 'https://apps.game.qq.com/cmc/zmMatchInfo?bMatchId=13660'],
  ['lol.qq.com match detail api', 'https://lol.qq.com/esports-info/api/match/detail?bMatchId=13660'],
  ['lpl match detail js', 'https://lpl.qq.com/web201612/data/LOL_MATCH2_MATCH_DETAIL.js'],
  ['lol data team list', 'https://lpl.qq.com/web201612/data/LOL_MATCH2_TEAM_LIST.js'],
];
for (const [label, url] of txCandidates) {
  const r = await get(label, url, { referer: 'https://lpl.qq.com/' });
  if (!r.ok) continue;
  const has = /GEN|BLG/.test(r.text);
  console.log(`    含 GEN/BLG: ${has}  片段: ${r.text.slice(0, 200).replace(/\s+/g, ' ')}`);
}

console.log('\n########## 5. 镜像数据源（浏览器要用，先确认 Node 侧可用） ##########');
for (const [label, url] of [
  ['gh-proxy schedule', 'https://gh-proxy.com/https://raw.githubusercontent.com/fjt272033067/lpl-tv/main/site/data/schedule.json'],
  ['gh-proxy liverooms', 'https://gh-proxy.com/https://raw.githubusercontent.com/fjt272033067/lpl-tv/main/site/data/liverooms.json'],
  ['gcore schedule', 'https://gcore.jsdelivr.net/gh/fjt272033067/lpl-tv@main/site/data/schedule.json'],
  ['cdn.jsdelivr liverooms', 'https://cdn.jsdelivr.net/gh/fjt272033067/lpl-tv@main/site/data/liverooms.json'],
  ['raw.gh schedule', 'https://raw.githubusercontent.com/fjt272033067/lpl-tv/main/site/data/schedule.json'],
]) {
  const r = await get(label, url);
  if (!r.ok) continue;
  try {
    const j = JSON.parse(r.text);
    console.log(`    updatedAt=${j.updatedAt}  matches=${(j.matches || []).length}  rooms=${(j.rooms || []).length}`);
    if (j.matches) {
      const f = j.matches.filter((m) => /GEN/i.test(m.teamA || '') && /BLG/i.test(m.teamB || ''));
      for (const m of f) console.log('    → 决赛行:', m.date, m.mode, m.teamA, m.score, m.teamB, 'published=' + m.published);
    }
  } catch (e) {
    console.log('    解析失败:', e.message);
  }
}

console.log('\n完成。');
