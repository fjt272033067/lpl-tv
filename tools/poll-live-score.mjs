/**
 * poll-live-score.mjs — 后台盯「实时比分」的字段变化
 *
 * 为什么盯：腾讯 LiveBMatchList 的 ScoreA/ScoreB 一直停在 "0"，
 * 而它的 Last-Modified 停在 02:05（开赛前）→ 说明不是 CDN 缓存，
 * 是腾讯没再发布这个文件。需要确认「它到底什么时候会变」。
 *
 * 盯三个东西：
 *   ① LiveBMatchList 的 Last-Modified + 决赛行的 ScoreA/ScoreB
 *   ② LivingGames 的 lastUpdateTime + Title（10 分钟一更，看第二个数字变不变）
 *   ③ 镜像 schedule.json 里决赛行的 score（CI 每 20 分钟烘焙）
 *
 * 用法：node tools/poll-live-score.mjs [间隔秒=30] [轮数=0=无限]
 */
import fs from 'node:fs';

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';
const INTERVAL = Number(process.argv[2] || 30);
const ROUNDS = Number(process.argv[3] || 0);
const LOG = 'data/live-score-poll.log';

const LBM = 'https://lpl.qq.com/web201612/data/LOL_MATCH2_LIVE_BMATCH_LIST.js';
const LG = 'https://lpl.qq.com/web201612/data/LOL_NEWMATCH_LIVE_PAGE_LIVING_GAMES.js';
const SCHED = 'https://gh-proxy.com/https://raw.githubusercontent.com/fjt272033067/lpl-tv/main/site/data/schedule.json';

function parseVar(text, name) {
  const m = text.match(new RegExp('var\\s+' + name + '\\s*=\\s*(\\{[\\s\\S]*?\\});?\\s*$'));
  if (!m) return null;
  try {
    return JSON.parse(m[1]);
  } catch {
    return null;
  }
}

async function grab(url) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 12000);
  try {
    const res = await fetch(url, {
      signal: ac.signal,
      headers: { 'User-Agent': UA, 'Cache-Control': 'no-cache', Referer: 'https://lpl.qq.com/' },
    });
    const text = await res.text();
    return { ok: true, text, lm: res.headers.get('last-modified'), age: res.headers.get('age') };
  } catch (e) {
    return { ok: false, error: e.message };
  } finally {
    clearTimeout(timer);
  }
}

let round = 0;
let prev = null;

async function tick() {
  round++;
  const now = new Date().toISOString();
  const [lbm, lg, sch] = await Promise.all([grab(LBM), grab(LG), grab(SCHED)]);

  let line = { at: now, round };

  if (lbm.ok) {
    const obj = parseVar(lbm.text, 'LiveBMatchList');
    const rows = obj && obj.msg ? Object.values(obj.msg).filter((x) => typeof x === 'string' && x) : [];
    const fin = rows
      .map((r) => { try { return JSON.parse(r); } catch { return null; } })
      .filter(Boolean)
      .filter((r) => /GEN|BLG/i.test(JSON.stringify(r)));
    line.lbm = { lm: lbm.lm, age: lbm.age, rows: rows.length, final: fin[0] ? {
      scoreA: fin[0].ScoreA, scoreB: fin[0].ScoreB, date: fin[0].MatchDate, proc: fin[0].GameProcName,
    } : null };
  }

  if (lg.ok) {
    const obj = parseVar(lg.text, 'LivingGames');
    line.lg = { lm: lg.lm, lastUpdateTime: obj && obj.msg && obj.msg.lastUpdateTime,
      title: obj && obj.msg && obj.msg.Title ? obj.msg.msg : undefined,
      titleHead: obj && obj.msg && obj.msg.Title ? obj.msg.Title.split('#').slice(0, 2).join('#') : '' };
  }

  if (sch.ok) {
    try {
      const j = JSON.parse(sch.text);
      const f = (j.matches || []).filter((m) => /GEN/i.test(m.teamA || '') && /BLG/i.test(m.teamB || ''));
      line.sched = { updatedAt: j.updatedAt, score: f[0] ? f[0].score : null, published: f[0] ? f[0].published : null };
    } catch (e) {
      line.sched = { error: e.message };
    }
  }

  const sig = JSON.stringify({ l: line.lbm && line.lbm.final, t: line.lg && line.lg.titleHead, s: line.sched && line.sched.score });
  const changed = prev !== null && sig !== prev;
  if (changed || round === 1) {
    const out = JSON.stringify(line, null, 1);
    fs.appendFileSync(LOG, out + '\n');
    console.log(`[${now}] ${changed ? '★ 变化' : '首轮'}\n${out}`);
  } else {
    console.log(`[${now}] 无变化  lbm.lm=${line.lbm && line.lbm.lm} lg=${line.lg && line.lg.lastUpdateTime} sched.score=${line.sched && line.sched.score}`);
  }
  prev = sig;
}

(async () => {
  await tick();
  const timer = setInterval(async () => {
    try {
      await tick();
    } catch (e) {
      console.log('tick 异常:', e.message);
    }
    if (ROUNDS && round >= ROUNDS) {
      clearInterval(timer);
      console.log('轮次用尽，退出');
    }
  }, INTERVAL * 1000);
})();
