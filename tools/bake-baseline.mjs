/* =====================================================================
 * bake-baseline.mjs — 烘焙「总决赛跟赛」基线数据
 *
 * 产出 site/data/final-baseline.json，内容**全部由站内数据实算**：
 *   · 对阵信息（从 schedule.json 找，不写死队名/日期）
 *   · 两队本届赛事的系列赛战绩、小局战绩、BO5 零封率、休赛天数
 *   · 胜率模型的输入与先验（Bradley-Terry 对位单小局胜率 + 负二项 BO5）
 *   · 站内历史弹幕里提到这两队的评论样本 → 热词 / 情绪 / 里程碑
 *
 * 页面运行时**优先**自己从 schedule.json 实算；本文件是它取不到远端数据时的
 * 兜底快照（以及赛前舆情基线 —— 那部分只能烘焙，浏览器里扫 17MB 弹幕不现实）。
 *
 * 用法：node tools/bake-baseline.mjs
 * ===================================================================== */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { hasAbuse } from './abuse-words.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const SITE = path.join(ROOT, 'site');
const DATA = path.join(SITE, 'data');

const schedule = JSON.parse(fs.readFileSync(path.join(DATA, 'schedule.json'), 'utf8'));
const matches = schedule.matches || [];

/* ---------------------------------------------------------------- *
 * 1. 找决赛（不写死队名：取「决赛轮次里最晚开打、且两队都在同一赛事」的一场）
 * ---------------------------------------------------------------- */
function isFinalPhase(m) {
  return /决赛/.test(String(m.phase || '')) || /决赛/.test(String(m.title || ''));
}
function parseScore(s) {
  const m = String(s || '').match(/(\d+)\s*[:\-]\s*(\d+)/);
  return m ? { a: +m[1], b: +m[2] } : null;
}

const finalCandidates = matches
  .filter(isFinalPhase)
  .filter((m) => m.teamA && m.teamB && m.score !== undefined)
  .sort((a, b) => String(b.date).localeCompare(String(a.date)));
if (!finalCandidates.length) {
  console.error('schedule.json 里找不到决赛场次');
  process.exit(1);
}
const finalMatch = finalCandidates[0];
const TEAM_A = finalMatch.teamA;
const TEAM_B = finalMatch.teamB;
const TOURNAMENT = finalMatch.game;
console.log('决赛:', TOURNAMENT, '|', finalMatch.date, '|', finalMatch.mode, '|', TEAM_A, 'vs', TEAM_B, '| score=', finalMatch.score);

/* ---------------------------------------------------------------- *
 * 2. 两队本届赛事战绩
 * ---------------------------------------------------------------- */
/** 单队在本届赛事的战绩（系列赛 / 小局 / BO5）
 *  ⚠️ excludeFinal：正在预测的那场**必须排除** —— 否则是循环论证
 *     （用「已经打到 1:0」推导「1:0 时的胜率」）。
 *  ⚠️ schedule.json 里**没有 bMatchId 字段**（只有 id/title），所以只能按
 *     日期 + 两队来识别同一场 —— 早先用 bMatchId 比较会让 undefined === undefined
 *     成立，把整届赛事全排空（实测 BO5 小局变成 0 胜 0 负）。 */
function isSameMatch(a, b) {
  if (!a || !b) return false;
  if (a.bMatchId && b.bMatchId) return String(a.bMatchId) === String(b.bMatchId);
  return String(a.date) === String(b.date) && a.teamA === b.teamA && a.teamB === b.teamB;
}
function teamStats(team, excludeFinal) {
  const rows = matches.filter((m) => {
    if (m.game !== TOURNAMENT) return false;
    if (!(m.teamA === team || m.teamB === team)) return false;
    if (excludeFinal && isSameMatch(m, excludeFinal)) return false;
    return true;
  });
  const series = { w: 0, l: 0, played: 0 };
  const games = { w: 0, l: 0 };
  const bo5 = { w: 0, l: 0, played: 0, gamesW: 0, gamesL: 0, sweeps: 0, series: [] };
  for (const m of rows) {
    const sc = parseScore(m.score);
    if (!sc) continue;
    const isA = m.teamA === team;
    const opp = isA ? m.teamB : m.teamA;
    const won = isA ? sc.a : sc.b;
    const lost = isA ? sc.b : sc.a;
    series.played++;
    if (won > lost) series.w++;
    else if (lost > won) series.l++;
    games.w += won;
    games.l += lost;
    const rec = { date: m.date, phase: m.phase, opponent: opp, score: `${won}:${lost}`, mode: m.mode, won: won > lost };
    if (m.mode === 'BO5') {
      bo5.played++;
      bo5.gamesW += won;
      bo5.gamesL += lost;
      if (won > lost) bo5.w++;
      else if (lost > won) bo5.l++;
      if (lost === 0) bo5.sweeps++;
      bo5.series.push(rec);
    }
  }
  rows.sort((a, b) => String(a.date).localeCompare(String(b.date)));
  const last = rows[rows.length - 1];
  const restDays = last ? Math.round((new Date(finalMatch.date) - new Date(last.date)) / 86400000) : null;
  return { series, games, bo5, restDays, lastMatch: last ? { date: last.date, opponent: last.teamA === team ? last.teamB : last.teamA } : null };
}

const statsA = teamStats(TEAM_A, finalMatch);
const statsB = teamStats(TEAM_B, finalMatch);

// 历史交手（两队彼此对过几次）
const h2h = matches.filter(
  (m) =>
    (m.teamA === TEAM_A && m.teamB === TEAM_B) || (m.teamA === TEAM_B && m.teamB === TEAM_A)
);

/* ---------------------------------------------------------------- *
 * 3. 胜率模型（可解释、可手算）
 *
 * ① 单队小局胜率 r = (胜 + 1) / (胜 + 负 + 2)   ← 加一平滑，样本少时不过度极端
 * ② 对位单小局胜率 p = r_A / (r_A + r_B)      ← Bradley-Terry
 * ③ 赛前先验（BO5 净胜 3 局）P0 = p³(1 + 3q + 6q²)
 * ④ 实时条件 P(GEN | a:b) = Σ_{j=0}^{3-b-1} C(3-a-1+j, j) p^(3-a) q^j
 * ---------------------------------------------------------------- */
function combo(n, k) {
  if (k < 0 || k > n) return 0;
  let r = 1;
  for (let i = 1; i <= k; i++) r = (r * (n - k + i)) / i;
  return r;
}
function seriesWinProb(p, a, b) {
  // a = A 队已胜局数, b = B 队已胜局数
  if (a >= 3) return 1;
  if (b >= 3) return 0;
  const needA = 3 - a;
  const needB = 3 - b;
  const q = 1 - p;
  let sum = 0;
  for (let j = 0; j <= needB - 1; j++) sum += combo(needA - 1 + j, j) * Math.pow(p, needA) * Math.pow(q, j);
  return sum;
}
const rA = (statsA.bo5.gamesW + 1) / (statsA.bo5.gamesW + statsA.bo5.gamesL + 2);
const rB = (statsB.bo5.gamesW + 1) / (statsB.bo5.gamesW + statsB.bo5.gamesL + 2);
const p = rA / (rA + rB);
const prior = seriesWinProb(p, 0, 0);

const model = {
  method: 'Bradley-Terry 对位单小局胜率 + 负二项 BO5 结算',
  inputs: {
    a: { team: TEAM_A, bo5GamesWon: statsA.bo5.gamesW, bo5GamesLost: statsA.bo5.gamesL, smoothed: rA },
    b: { team: TEAM_B, bo5GamesWon: statsB.bo5.gamesW, bo5GamesLost: statsB.bo5.gamesL, smoothed: rB },
  },
  perGameWinProb: p,
  prior: prior,
  derivation: [
    `${TEAM_A} 本届 BO5 小局 ${statsA.bo5.gamesW}胜${statsA.bo5.gamesL}负 → 平滑 (${statsA.bo5.gamesW}+1)/(${statsA.bo5.gamesW + statsA.bo5.gamesL}+2) = ${rA.toFixed(4)}`,
    `${TEAM_B} 本届 BO5 小局 ${statsB.bo5.gamesW}胜${statsB.bo5.gamesL}负 → 平滑 (${statsB.bo5.gamesW}+1)/(${statsB.bo5.gamesW + statsB.bo5.gamesL}+2) = ${rB.toFixed(4)}`,
    `对位单小局胜率 p = ${rA.toFixed(4)} / (${rA.toFixed(4)} + ${rB.toFixed(4)}) = ${p.toFixed(4)}`,
    `赛前先验（0:0）= p³(1 + 3q + 6q²) = ${(prior * 100).toFixed(2)}%`,
  ],
};

/* ---------------------------------------------------------------- *
 * 4. 站内历史弹幕 → 热词 / 情绪 / 里程碑
 * ---------------------------------------------------------------- */
const dmDir = path.join(DATA, 'dm');
const TEAM_KEYS = [TEAM_A, TEAM_B].map((t) => t.toUpperCase());
const PLAYER_KEYS = ['GEN', 'BLG', 'Canyon', 'Zeus', 'Chovy', 'Bin', 'knight', 'On', 'Faker', 'Knight', 'View', 'Delight'];
const NAME_RE = new RegExp(TEAM_KEYS.concat(PLAYER_KEYS).join('|'), 'i');

const POS = ['牛', '强', '稳', '赢', '拿下', '泪目', '帅', '棒', '香', '起飞', '逆袭', '翻盘', '晋级', '冠军', '秀', '顶', '好', '爽', '期待', '加油', '绝', '无敌', '统治', 'carry', 'Carry', 'CARRY'];
const NEG = ['输', '拉', '垮', '菜', '崩', '难受', '心疼', '离谱', '完蛋', '寄', '摆烂', '白给', '掉链子', '逆风', '惨', '垃圾', '滚', '失误', '下饭', '退钱'];
const MILESTONE = ['拿下', '扳回', '逆转', '翻盘', '零封', '一穿', '三杀', '四杀', '五杀', '抢大龙', '大龙', '男爵', '先锋', '结束', '晋级', '冠军', '决胜局', '点塔', '推塔', '扳'];

// 热词：**策展词典**法，不是 n-gram。
// 早期版本用 2~4 字中文 n-gram，结果出来一堆「呢吗」「育有」「玩具」这种
// 无意义碎片 —— 不可解释也没法用。改成「词典命中次数」后，
// 每个热词都是赛事里真正被讨论的实体/术语，且实时弹幕与历史基线可以同口径对比。
const HOT_DICT = [
  // 队伍 / 选手
  'GEN', 'BLG', 'Canyon', 'Chovy', 'Zeu', 'Bin', 'knight', 'On', 'Faker', 'View', 'Delight',
  'Lehends', 'Bdd', 'Yike', 'Ruler', 'Peyz', 'Elk', 'T1', 'IG', 'HLE', 'DK', 'KT', 'C9', 'KC',
  'TLAW', 'MKOI', 'VKS', 'FNC', 'PSG', 'AL', 'G2', 'FLY', 'GAM', 'LYON', 'S16',
  // 赛况 / 战术
  '拿下', '零封', '逆转', '翻盘', '一穿', '三杀', '四杀', '五杀', '团灭', '一血', '大龙', '男爵',
  '先锋', '决胜局', '晋级', '冠军', '拉扯', '差距', '状态', '手感', '节奏', '运营', '视野',
  '资源', '团战', '龙团', '双排', '联动', '打野', '中单', '辅助', '上单', '下路', 'AD',
  '稳健', '激进', '绝活', '招牌', '掏出', '藏牌', '暂停', '阵容', 'BP', '闪现', '推塔', '点塔',
  // 情绪
  '牛', '强', '稳', '菜', '拉', '崩', '寄', '泪目', '帅', '爽', '香', '绝了', '无敌', '统治',
  '逆风', '顺风', '梦游', '划水', '摆烂', '白给', '心疼', '难受', '离谱', '下饭', '退钱', '加油',
];

const hotMap = new Map();
const milestoneHits = [];
let posHits = 0;
let negHits = 0;
let sampleCount = 0;
const milestoneMap = new Map();

/** 词典命中计数（拉丁词不区分大小写；中文按子串） */
function countDict(text, dict, into) {
  const lower = text.toLowerCase();
  for (const w of dict) {
    const lw = w.toLowerCase();
    let hit = 0;
    let idx = lower.indexOf(lw);
    while (idx !== -1) {
      hit++;
      idx = lower.indexOf(lw, idx + lw.length);
    }
    if (hit) into.set(w, (into.get(w) || 0) + hit);
  }
}

const dmFiles = fs.existsSync(dmDir) ? fs.readdirSync(dmDir).filter((f) => f.endsWith('.json')) : [];
for (const f of dmFiles) {
  let j;
  try {
    j = JSON.parse(fs.readFileSync(path.join(dmDir, f), 'utf8'));
  } catch {
    continue;
  }
  const items = j.items || [];
  for (const it of items) {
    const text = typeof it === 'string' ? it : Array.isArray(it) ? it[4] : '';
    const t = String(text || '');
    if (!t || t.length > 60) continue;
    if (hasAbuse(t)) continue; // 合规：命中屏蔽词的一律不进基线
    if (!NAME_RE.test(t)) continue;
    sampleCount++;
    // 情绪
    for (const w of POS) if (t.includes(w)) { posHits++; break; }
    for (const w of NEG) if (t.includes(w)) { negHits++; break; }
    // 里程碑
    for (const w of MILESTONE) {
      if (t.includes(w)) {
        const k = w;
        milestoneMap.set(k, (milestoneMap.get(k) || 0) + 1);
        if (milestoneHits.length < 40) milestoneHits.push({ text: t.slice(0, 40), tag: w });
        break;
      }
    }
    // 热词：词典命中
    countDict(t, HOT_DICT, hotMap);
  }
}

// 热词：按命中次数排序；同义/包含关系只保留一个（更长的优先）
const hotSorted = [...hotMap.entries()].sort((a, b) => b[1] - a[1]);
const hotWords = [];
for (const [w, c] of hotSorted) {
  if (c < 2) continue;
  if (hotWords.some((h) => h.word.toLowerCase() === w.toLowerCase())) continue;
  hotWords.push({ word: w, count: c });
  if (hotWords.length >= 24) break;
}

const sentiment = {
  positive: posHits,
  negative: negHits,
  index: posHits + negHits ? +((posHits / (posHits + negHits)) * 100).toFixed(1) : null,
  method: '词典法（正/负情绪词命中次数占比），仅供趋势参考',
};

/* ---------------------------------------------------------------- *
 * 5. 落盘
 *
 * ⚠️ updatedAt 只在**内容真的变了**时才更新（与 bake.mjs 同一口径）。
 *    否则 CI 每 20 分钟都会因为这个字段产生一次实质提交 —— 数据没变却
 *    让仓库多一条记录、也让「这次刷新到底改了什么」变得看不清。
 * ---------------------------------------------------------------- */
const OUT_PATH = path.join(DATA, 'final-baseline.json');
const out = {
  updatedAt: '',
  source: {
    schedule: 'site/data/schedule.json',
    scheduleUpdatedAt: schedule.updatedAt || '',
    danmakuFiles: dmFiles.length,
  },
  match: {
    gameId: String(finalMatch.gameId || ''),
    bMatchId: String(finalMatch.bMatchId || ''),
    tournament: TOURNAMENT,
    phase: finalMatch.phase,
    mode: finalMatch.mode,
    date: finalMatch.date,
    place: finalMatch.place || '',
    teamA: TEAM_A,
    teamB: TEAM_B,
    score: finalMatch.score,
  },
  teams: {
    [TEAM_A]: {
      series: statsA.series,
      games: statsA.games,
      bo5: { ...statsA.bo5, sweepRate: statsA.bo5.played ? +(statsA.bo5.sweeps / statsA.bo5.played).toFixed(3) : 0 },
      restDays: statsA.restDays,
      lastMatch: statsA.lastMatch,
    },
    [TEAM_B]: {
      series: statsB.series,
      games: statsB.games,
      bo5: { ...statsB.bo5, sweepRate: statsB.bo5.played ? +(statsB.bo5.sweeps / statsB.bo5.played).toFixed(3) : 0 },
      restDays: statsB.restDays,
      lastMatch: statsB.lastMatch,
    },
  },
  h2h: { played: h2h.length, matches: h2h.map((m) => ({ date: m.date, event: m.game, score: m.score, a: m.teamA, b: m.teamB })) },
  model,
  danmaku: {
    sampleCount,
    hotDict: HOT_DICT,
    hotWords,
    sentiment,
    milestones: milestoneHits.slice(0, 20),
    milestoneTags: [...milestoneMap.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([tag, count]) => ({ tag, count })),
    note: '样本来自站内已过审的历史弹幕（site/data/dm/*.json），不是决赛实时弹幕',
  },
};

// 与上一份比：忽略 updatedAt 字段，其余完全一致 → 说明内容没变
let prevUpdatedAt = '';
let changed = true;
if (fs.existsSync(OUT_PATH)) {
  try {
    const prev = JSON.parse(fs.readFileSync(OUT_PATH, 'utf8'));
    prevUpdatedAt = prev.updatedAt || '';
    const strip = (o) => {
      const c = JSON.parse(JSON.stringify(o));
      delete c.updatedAt;
      return JSON.stringify(c);
    };
    changed = strip(prev) !== strip(out);
  } catch (e) {
    changed = true;
  }
}
out.updatedAt = changed ? new Date().toISOString() : prevUpdatedAt || new Date().toISOString();

fs.writeFileSync(OUT_PATH, JSON.stringify(out, null, 1), 'utf8');
console.log('\n基线已写入 site/data/final-baseline.json' + (changed ? '（内容有变化）' : '（内容无变化，沿用原 updatedAt）'));
console.log('  模型: p =', p.toFixed(4), ' 先验 =', (prior * 100).toFixed(2) + '%');
console.log('  弹幕样本:', sampleCount, ' 热词:', hotWords.length, ' 情绪:', JSON.stringify(sentiment));
console.log('  里程碑标签:', out.danmaku.milestoneTags.map((t) => t.tag + '×' + t.count).join(', '));
