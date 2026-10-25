/* =====================================================================
 * bake.mjs — 构建期数据烘焙
 *  1) 抓取腾讯 LPL 公开赛程/录像目录 → site/data/catalog.json
 *  2) 用 B 站公开搜索定位同一场比赛的 BV/CID → 写入 catalog
 *  3) 抓取 comment.bilibili.com/{cid}.xml 弹幕 → site/data/dm/{cid}.json
 *  4) 收集 B 站直播间 → site/data/liverooms.json
 *
 *  用法： node tools/bake.mjs [--vods=120] [--no-danmaku]
 * ===================================================================== */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { fetchLiveRoom } from './bili-live.mjs';
import { BILI_ROOM_IDS, EXTERNAL_ROOMS } from './live-rooms.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const SITE = path.join(ROOT, 'site');
const DATA = path.join(SITE, 'data');
const DM_DIR = path.join(DATA, 'dm');

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

const argv = process.argv.slice(2);
const argNum = (k, d) => {
  const a = argv.find((x) => x.startsWith('--' + k + '='));
  return a ? Number(a.split('=')[1]) : d;
};
const MAX_VODS = argNum('vods', 120);
const SKIP_DM = argv.includes('--no-danmaku');

fs.mkdirSync(DM_DIR, { recursive: true });

/* ---------- 网络小工具 ---------- */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 用 curl 请求（B 站风控按 TLS 指纹拦截，curl 的指纹可以通过）。
 *  用 execFileSync 而非 execSync：Windows 下 execSync 走 cmd.exe，Cookie 里的 ; & 会破坏命令。
 *  注意 B 站部分接口（弹幕 XML）会带 Content-Encoding: deflate，需要解压。 */
function curlBuf(url, headers = [], timeout = 30) {
  const args = ['-s', '--max-time', String(timeout), '-A', UA];
  headers.forEach((h) => args.push('-H', h));
  args.push(url);
  try {
    return execFileSync('curl.exe', args, {
      encoding: 'buffer',
      maxBuffer: 256 * 1024 * 1024,
      windowsHide: true,
    });
  } catch (e) {
    return Buffer.alloc(0);
  }
}

/** 自动识别 gzip / deflate / zlib 并解压 */
function decodeBody(buf) {
  if (!buf || !buf.length) return '';
  if (buf[0] === 0x1f && buf[1] === 0x8b) {
    try { return zlib.gunzipSync(buf).toString('utf8'); } catch (e) { return buf.toString('utf8'); }
  }
  // zlib 头：0x78 0x01/0x9c/0xda
  if (buf[0] === 0x78) {
    try { return zlib.inflateSync(buf).toString('utf8'); } catch (e) { /* fallthrough */ }
  }
  // 裸 deflate（无 zlib 头）
  try {
    const out = zlib.inflateRawSync(buf);
    if (out.length) return out.toString('utf8');
  } catch (e) {}
  return buf.toString('utf8');
}

function curlText(url, headers = [], timeout = 30) {
  return decodeBody(curlBuf(url, headers, timeout));
}

let buvid3 = '';
function ensureBuvid() {
  if (buvid3) return buvid3;
  try {
    const j = JSON.parse(curlText('https://api.bilibili.com/x/frontend/finger/spi'));
    buvid3 = j.data.b_3;
  } catch (e) {
    buvid3 = '';
  }
  return buvid3;
}
const biliHeaders = () => {
  const b = ensureBuvid();
  return [`Referer: https://www.bilibili.com/`, b ? `Cookie: buvid3=${b}; b_nut=${Math.floor(Date.now() / 1000)}` : ''].filter(Boolean);
};

/** 腾讯的 TeamShortNameA/B 经常为空，但 bMatchName 始终有 "A vs B"；
 *  TeamA/TeamB 是队伍 ID（可配合 TeamList 解析队名与队徽）。 */
function pickTeams(it) {
  const bn = String(it.bMatchName || '')
    .replace(/\s*vs\.?\s*/gi, ' vs ')
    .split(/\s+vs\s+/i);
  const a = (it.TeamShortNameA || bn[0] || '').trim();
  const b = (it.TeamShortNameB || bn[1] || '').trim();
  return { teamA: a, teamB: b, teamIdA: it.TeamA || '', teamIdB: it.TeamB || '' };
}

/* ---------- 1. 腾讯赛程（含未开赛 / 未发布的全部条目） ---------- */
async function fetchTencentSchedule() {
  const url = 'https://lpl.qq.com/web201612/data/LOL_MATCH2_MATCH_HOMEPAGE_BMATCH_LIST.js';
  const res = await fetch(url, { headers: { 'User-Agent': UA, Referer: 'https://lpl.qq.com/' } });
  const text = await res.text();
  const data = JSON.parse(text);
  const out = [];
  for (const it of data.msg || []) {
    let ext = {};
    try { ext = JSON.parse(it.sExt1 || '{}'); } catch (e) {}
    const t = pickTeams(it);
    out.push({
      id: ext.sVID || '',
      title: (ext.sName || it.bMatchName || '').replace(/&#160;/g, ' ').trim(),
      game: it.GameName || '',
      phase: it.GameProcName || '',
      mode: it.GameModeName || '',
      date: it.MatchDate || '',
      duration: ext.iTime || 0,
      cover: ext.sImg ? 'https:' + String(ext.sImg).trim() : '',
      teamA: t.teamA,
      teamB: t.teamB,
      teamIdA: t.teamIdA,
      teamIdB: t.teamIdB,
      score: it.ScoreA != null ? `${it.ScoreA}:${it.ScoreB}` : '',
      place: it.GamePlaceName || '',
      published: !!ext.sVID,
      bvid: '',
      biliPage: 0,
    });
  }
  out.sort((a, b) => ((a.date || '') < (b.date || '') ? -1 : 1));
  return out;
}

/* ---------- 2. 腾讯赛程（仅有录像的） ---------- */
async function fetchTencentCatalog() {
  const url = 'https://lpl.qq.com/web201612/data/LOL_MATCH2_MATCH_HOMEPAGE_BMATCH_LIST.js';
  const res = await fetch(url, { headers: { 'User-Agent': UA, Referer: 'https://lpl.qq.com/' } });
  const text = await res.text();
  const data = JSON.parse(text);
  const list = data.msg || [];
  const out = [];
  for (const it of list) {
    let ext = {};
    try { ext = JSON.parse(it.sExt1 || '{}'); } catch (e) {}
    if (!ext.sVID) continue;
    const title = (ext.sName || '').replace(/&#160;/g, ' ').trim() || it.bMatchName || '';
    const t = pickTeams(it);
    out.push({
      id: ext.sVID,
      title,
      game: it.GameName || '',
      phase: it.GameProcName || '',
      mode: it.GameModeName || '',
      date: it.MatchDate || '',
      duration: ext.iTime || 0,
      cover: (() => {
        const s = String(ext.sImg || '').trim();
        if (!s) return '';
        if (/^https?:/i.test(s)) return s;
        return 'https:' + (s.startsWith('//') ? s : '//' + s.replace(/^\/+/, ''));
      })(),
      teamA: t.teamA,
      teamB: t.teamB,
      teamIdA: t.teamIdA,
      teamIdB: t.teamIdB,
      score: it.ScoreA != null ? `${it.ScoreA}:${it.ScoreB}` : '',
      place: it.GamePlaceName || '',
      comments: ext.iComment || 0,
      raw: { sName: ext.sName, iTime: ext.iTime, docid: ext.sDocid },
    });
  }
  // 按时间倒序（新的在前）
  out.sort((a, b) => (a.date < b.date ? 1 : -1));
  return out;
}

/* ---------- 2. B 站视频检索 ---------- */
const EVENTS = [
  ['全球总决赛', /全球总决赛|世界赛|worlds/i],
  ['职业联赛', /职业联赛|LPL/i],
  ['德玛西亚杯', /德玛西亚杯|demacia/i],
  ['NEST', /NEST/i],
  ['MSI', /\bMSI\b/i],
  ['亚洲杯', /亚洲杯/i],
  ['季中冠军赛', /季中冠军赛/i],
];

function eventTag(text) {
  for (const [tag, re] of EVENTS) if (re.test(text)) return tag;
  return '其他';
}

function teamsOf(text) {
  const s = String(text || '').toUpperCase();
  const m = s.match(/([A-Z][A-Z0-9]{1,7})\s*(?:VS|V\.S\.|对阵|-|—)\s*([A-Z][A-Z0-9]{1,7})/);
  if (m) return [m[1], m[2]];
  const m2 = s.match(/([A-Z][A-Z0-9]{1,7})\s+(VS|V\.S\.)\s+([A-Z][A-Z0-9]{1,7})/);
  if (m2) return [m2[1], m2[3]];
  return [];
}

/** 归一化：去掉空格与符号 */
function normKey(s) {
  return String(s || '')
    .toUpperCase()
    .replace(/[^A-Z0-9\u4e00-\u9fa5]/g, '');
}

/** 检索 B 站视频（search/all/v2 不需要 wbi 签名，也不会触发风控） */
function biliSearch(keyword, page = 1) {
  const url = `https://api.bilibili.com/x/web-interface/search/all/v2?keyword=${encodeURIComponent(
    keyword
  )}&page=${page}`;
  const raw = curlText(url, [`Referer: https://search.bilibili.com/`, ...biliHeaders()]);
  if (!raw || raw[0] !== '{') return null;
  try {
    return JSON.parse(raw);
  } catch (e) {
    return null;
  }
}

/** 从搜索结果里抽出视频条目 */
function extractVideos(sj) {
  const out = [];
  if (!sj || !sj.data) return out;
  for (const group of sj.data.result || []) {
    if (group.result_type !== 'video') continue;
    for (const it of group.data || []) {
      if (!it.bvid) continue;
      out.push({
        bvid: it.bvid,
        title: String(it.title || '').replace(/<[^>]+>/g, '').replace(/&quot;/g, '"'),
        duration: it.duration || '',
        author: it.author || '',
        mid: it.mid || 0,
      });
    }
  }
  return out;
}

/** 从搜索结果里抽出直播间 */
function extractLives(sj) {
  const out = [];
  if (!sj || !sj.data) return out;
  for (const group of sj.data.result || []) {
    if (group.result_type !== 'video') continue;
    for (const it of group.data || []) {
      if (!it.roomid) continue;
      out.push({
        roomid: it.roomid,
        uid: it.uid || 0,
        title: String(it.title || '').replace(/<[^>]+>/g, '').replace(/&quot;/g, '"'),
      });
    }
  }
  return out;
}

/* ---------- 3. 弹幕 ---------- */
function fetchDanmakuXml(cid) {
  const raw = curlText(
    `https://comment.bilibili.com/${cid}.xml`,
    [`Referer: https://www.bilibili.com/video/`, ...biliHeaders()]
  );
  return raw && raw.indexOf('<d p=') > -1 ? raw : '';
}

/** 取某个 bvid 的分 P 列表（B 站赛事录像常按第N局分P） */
function fetchPages(bvid) {
  const raw = curlText(
    `https://api.bilibili.com/x/player/pagelist?bvid=${bvid}`,
    biliHeaders()
  );
  try {
    const j = JSON.parse(raw);
    return j.code === 0 && Array.isArray(j.data) ? j.data : [];
  } catch (e) {
    return [];
  }
}

const CN_NUM = ['一', '二', '三', '四', '五', '六', '七', '八', '九'];

/** 从腾讯标题尾部推断这是第几局： "..._03" / " ... _3" */
function gameNumberOf(title) {
  const m = String(title || '').match(/[_\-]\s*(\d{1,2})\s*$/);
  return m ? Number(m[1]) : 0;
}

/** 在分P列表里挑出最匹配的那一局 */
function pickPage(pages, gameNo, duration) {
  if (!pages.length) return null;
  if (gameNo > 0) {
    const cn = CN_NUM[gameNo - 1];
    const exact = pages.find((p) => {
      const part = String(p.part || '');
      return part.includes('第' + cn + '局') || part.includes('第' + gameNo + '局') || part.includes(cn);
    });
    if (exact) return exact;
  }
  if (duration) {
    let best = null;
    let diff = Infinity;
    for (const p of pages) {
      const d = Math.abs((p.duration || 0) - duration);
      if (d < diff) {
        diff = d;
        best = p;
      }
    }
    if (best) return best;
  }
  return pages[0];
}

function parseDanmakuXml(xml) {
  const items = [];
  const re = /<d p="([^"]+)"[^>]*>([^<]*)<\/d>/g;
  let m;
  while ((m = re.exec(xml)) !== null) {
    const p = m[1].split(',');
    const t = +p[0] || 0;
    const mode = +p[1] || 1;
    const size = +p[2] || 25;
    const color = +p[3] || 16777215;
    const text = m[2]
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'")
      .replace(/&amp;/g, '&');
    if (!text) continue;
    items.push([t, mode, color, size, text]);
  }
  return items;
}

/* ---------- 主流程 ---------- */
/** 读取数据文件的内容签名（忽略 updatedAt 这类每次都变的时间戳） */
function contentSig(file, omit = ['updatedAt']) {
  try {
    if (!fs.existsSync(file)) return '';
    const j = JSON.parse(fs.readFileSync(file, 'utf8'));
    omit.forEach((k) => delete j[k]);
    return JSON.stringify(j);
  } catch (e) {
    return '';
  }
}

/** 直播间签名：忽略具体流地址（每次刷新都会变），只看房间集合与开播状态 */
function liveSigOf(file) {
  try {
    if (!fs.existsSync(file)) return '';
    const j = JSON.parse(fs.readFileSync(file, 'utf8'));
    return JSON.stringify((j.rooms || []).map((r) => [r.roomid, r.live ? 1 : 0, r.stream ? 1 : 0]));
  } catch (e) {
    return '';
  }
}

/** B 站视频时长字符串 → 秒（"569:8" → 34148；"1:05:23" → 3923） */
function parseDur(dur) {
  const parts = String(dur || '')
    .split(':')
    .map((x) => Number(x));
  if (!parts.length || parts.some((n) => !isFinite(n))) return 0;
  return parts.reduce((acc, p) => acc * 60 + p, 0);
}

/** 标题里是否以独立词出现该队名（避免 "GEN" 命中 "GENG"） */
function titleHasTeam(title, team) {
  if (!team) return false;
  const k = String(team).toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!k) return false;
  const t = String(title || '').toUpperCase();
  return new RegExp('(^|[^A-Z0-9])' + k + '($|[^A-Z0-9])').test(t);
}

/** 明显不是「整场比赛录像」的标题（赛后雷达图、锐评、预测、采访…） */
const BILI_BAD_TITLE =
  /(雷达图|锐评|赛后数据|赛后分析|集锦|高光|盘点|预测|采访|花絮|表情包|速看|脑洞|切片|杂谈|吐槽|搞笑|挑战|大事记|回顾)/;
/** 整场比赛录像的时长下限（秒）——短于此的基本都是切片/集锦 */
const BILI_MIN_DURATION = 25 * 60;

/** 腾讯尚未发布录像、且已经开打（近 10 天内开始）的比赛 —— 只能靠 B 站搬运版 */
function pendingCandidates(schedule) {
  const now = Date.now();
  return schedule.filter((m) => {
    if (m.published || m.bvid) return false;
    if (!m.date || !m.teamA || !m.teamB || /^D\d/i.test(m.teamA)) return false;
    const ts = new Date(String(m.date).replace(/-/g, '/')).getTime();
    // 只处理已经开打或刚开始的比赛；还没开始的（明天/下周）不该有录像
    return isFinite(ts) && ts > now - 10 * 86400000 && ts < now + 2 * 3600000;
  });
}

/**
 * 清理「还没开打」的比赛上的历史 B 站源映射。
 * 之前某次烘焙可能把当天合集录像误配给了次日的比赛（合集标题里包含了同名的队）。
 */
function resetFuturePending(schedule) {
  const now = Date.now();
  let n = 0;
  schedule.forEach((m) => {
    if (!m.bvid) return;
    const ts = new Date(String(m.date || '').replace(/-/g, '/')).getTime();
    if (isFinite(ts) && ts > now + 2 * 3600000) {
      m.bvid = '';
      m.biliPage = 0;
      n++;
    }
  });
  return n;
}

/** 找到该场对战在 B 站视频里的分P页码（赛事录像常按场次分P） */
function resolveBiliPage(bvid, teamA, teamB) {
  const pages = fetchPages(bvid);
  if (!pages.length) return 1;
  let idx = pages.findIndex(
    (p) => titleHasTeam(p.part || '', teamA) && titleHasTeam(p.part || '', teamB)
  );
  if (idx < 0) {
    idx = pages.findIndex((p) => titleHasTeam(p.part || '', teamA) || titleHasTeam(p.part || '', teamB));
  }
  return idx < 0 ? 1 : idx + 1;
}

/**
 * 给「腾讯尚未发布录像」的比赛找 B 站搬运版。
 * 腾讯的 sVID 通常滞后数小时到一天（刚打完的比赛完全没有），
 * 这类比赛只能靠 B 站源，赛程页点击后跳 B 站视频页观看。
 */
function matchPending(schedule, pool, candidates) {
  const hits = [];
  for (const m of candidates || pendingCandidates(schedule)) {
    let best = null;
    let bestScore = 0;
    for (const v of pool.values()) {
      if (!titleHasTeam(v.title, m.teamA) || !titleHasTeam(v.title, m.teamB)) continue;
      if (BILI_BAD_TITLE.test(v.title)) continue;
      const dur = parseDur(v.duration);
      if (dur < BILI_MIN_DURATION) continue;
      let score = 0;
      // 官方赛事账号发布的回放优先于解说/搬运
      if (/英雄联盟赛事|哔哩哔哩英雄联盟/i.test(v.author || '')) score += 4;
      if (/弹幕版/.test(v.title)) score += 3;
      if (/直播回放|录播|录像|直播录像|完整版/.test(v.title)) score += 2;
      if (dur >= 60 * 60) score += 2;
      else if (dur >= 35 * 60) score += 1;
      // 标题里出现多场对阵 → 是合集视频；不如单场精准（但有分P时同样可用）
      const vsCount = (String(v.title).match(/vs/gi) || []).length;
      score -= Math.min(3, Math.max(0, vsCount - 1));
      if (score > bestScore) {
        bestScore = score;
        best = v;
      }
    }
    if (best) {
      m.bvid = best.bvid;
      m.biliTitle = best.title;
      m.biliPage = resolveBiliPage(best.bvid, m.teamA, m.teamB);
      hits.push(`${m.teamA} vs ${m.teamB} → ${best.bvid} p${m.biliPage} (${best.title.slice(0, 40)})`);
    }
  }
  return hits;
}

async function main() {
  const t0 = Date.now();
  console.log('[1/4] 抓取腾讯 LPL 赛程…');
  const matches = await fetchTencentCatalog();
  console.log(`      录像条目 ${matches.length} 条`);

  const schedulePath = path.join(DATA, 'schedule.json');
  const livePath = path.join(DATA, 'liverooms.json');
  // 上一次产物的内容签名（用于判断是否需要重新部署）
  const prevSchedSig = contentSig(schedulePath);
  const prevLiveSig = liveSigOf(livePath);
  // 上一次赛程里的 B 站源映射（schedule.json 每次都由腾讯接口重建，必须迁移）
  let prevBiliMap = new Map();
  try {
    if (fs.existsSync(schedulePath)) {
      const prev = JSON.parse(fs.readFileSync(schedulePath, 'utf8'));
      (prev.matches || []).forEach((m) => {
        if (m.bvid && m.date && m.teamA && m.teamB) {
          prevBiliMap.set(`${m.date}|${m.teamA}|${m.teamB}`, { bvid: m.bvid, biliPage: m.biliPage || 0 });
        }
      });
    }
  } catch (e) {
    /* 忽略损坏的旧文件 */
  }

  // 完整赛程（含未开赛 / 尚未发布录像的比赛）—— 对阵图要靠它显示 TBD 与后续轮次
  const schedule = await fetchTencentSchedule();
  console.log(`      完整赛程 ${schedule.length} 条 → schedule.json`);

  // 增量模式：沿用上一次的 B 站映射，只处理新出现的比赛
  const catalogPath = path.join(DATA, 'catalog.json');
  let prevById = new Map();
  let prevJson = null;
  if (fs.existsSync(catalogPath)) {
    try {
      prevJson = JSON.parse(fs.readFileSync(catalogPath, 'utf8'));
      (prevJson.matches || []).forEach((m) => {
        if (m.bvid) prevById.set(m.id, m);
      });
    } catch (e) {
      /* 忽略损坏的旧目录 */
    }
  }
  const isNew = matches.filter((m) => !prevById.has(m.id));
  // 腾讯尚未发布录像、但已经开打/打完的比赛：这些只能靠 B 站搬运版
  const pending = pendingCandidates(schedule);
  // 沿用上一次的 B 站源映射（赛程是每次重建的，不迁移就会丢）
  schedule.forEach((m) => {
    const k = `${m.date}|${m.teamA}|${m.teamB}`;
    const prev = prevBiliMap.get(k);
    if (prev && !m.bvid && !m.published) {
      m.bvid = prev.bvid;
      m.biliPage = prev.biliPage;
    }
  });
  // 只对「上次没出现过」的比赛去 B 站检索（增量模式，避免每轮都碰 B 站接口）
  const pendingFresh = pending.filter(
    (m) => !m.bvid && !prevBiliMap.has(`${m.date}|${m.teamA}|${m.teamB}`)
  );
  console.log(
    `      其中 ${isNew.length} 场是新录像（增量模式只处理这些）；` +
      `${pendingFresh.length} 场待发布录像待找 B 站源（另有 ${pending.length - pendingFresh.length} 场沿用已有映射）`
  );

  console.log('[2/4] 检索 B 站视频并匹配…');
  const pool = new Map();
  const lives = new Map();
  // 增量模式：没有新比赛就完全不碰 B 站接口（既快又避免触发风控）
  if (!isNew.length && !pendingFresh.length) {
    console.log('      无新比赛，跳过 B 站检索');
  } else {
    // 2a. 广撒网：几个通用关键词 + 分页
    const broad = ['英雄联盟全球总决赛', 'LPL 比赛', '英雄联盟赛事', '全球总决赛'];
    for (const kw of broad) {
      for (let pg = 1; pg <= 3; pg++) {
        const sj = biliSearch(kw, pg);
        const vs = extractVideos(sj);
        const ls = extractLives(sj);
        vs.forEach((v) => pool.set(v.bvid, v));
        ls.forEach((l) => lives.set(String(l.roomid), l));
        console.log(`      "${kw}" p${pg} -> 视频 ${vs.length} / 直播间 ${ls.length}`);
        await sleep(700);
      }
    }
    console.log(`      视频池 ${pool.size}，直播间池 ${lives.size}`);

    // 2b. 针对「需要处理」的比赛做队伍组合精搜
    const recent = isNew.slice(0, MAX_VODS);
    const pairSeen = new Set();
    for (const m of recent) {
      const t = teamsOf(m.title);
      if (!t.length) continue;
      const pairKey = [t[0], t[1]].sort().join('|');
      if (pairSeen.has(pairKey)) continue;
      pairSeen.add(pairKey);
      if (pool.size > 6000) break;
      const sj = biliSearch(`${t[0]} ${t[1]}`, 1);
      extractVideos(sj).forEach((v) => pool.set(v.bvid, v));
      extractLives(sj).forEach((l) => lives.set(String(l.roomid), l));
      await sleep(650);
    }
    // 待发布录像的比赛也按队伍对精搜（标题用队伍简称，比 bMatchName 稳）
    for (const m of pendingFresh) {
      const pairKey = [m.teamA, m.teamB].sort().join('|');
      if (pairSeen.has(pairKey)) continue;
      pairSeen.add(pairKey);
      if (pool.size > 6000) break;
      const sj = biliSearch(`${m.teamA} ${m.teamB} ${m.game || ''}`, 1);
      extractVideos(sj).forEach((v) => pool.set(v.bvid, v));
      await sleep(650);
    }
    console.log(`      精搜后视频池 ${pool.size}，直播间池 ${lives.size}`);
  }

  // 2c. 匹配：队伍组合 + 赛事标签
  const index = new Map();
  for (const v of pool.values()) {
    const ts = teamsOf(v.title);
    if (!ts.length) continue;
    const tag = eventTag(v.title);
    const key = tag + '|' + [ts[0], ts[1]].sort().join('|');
    if (!index.has(key)) index.set(key, []);
    index.get(key).push(v);
  }

  let matched = 0;
  for (const m of matches) {
    // 已有映射的直接沿用（增量模式的关键：绝大多数比赛无需重新匹配）
    const prev = prevById.get(m.id);
    if (prev && prev.bvid) {
      m.bvid = prev.bvid;
      m.biliTitle = prev.biliTitle || prev.biliPart || '';
      m.cid = prev.cid || null;
      m.dmCount = prev.dmCount || 0;
      m.biliPage = prev.biliPage || 1;
      m.biliPages = prev.biliPages || 1;
      matched++;
      continue;
    }
    const ts = teamsOf(m.title);
    if (!ts.length) continue;
    const tag = eventTag(m.game + ' ' + m.title);
    const key = tag + '|' + [ts[0], ts[1]].sort().join('|');
    const cands = index.get(key);
    if (!cands || !cands.length) continue;
    // 标题相似度打分
    const mt = normKey(m.title);
    let best = null;
    let bestScore = -1;
    for (const c of cands) {
      const ct = normKey(c.title);
      let score = 0;
      // 公共 token 数
      const mTokens = new Set(mt.match(/[A-Z]{2,8}|[0-9]{1,3}|[一-龥]{2,6}/g) || []);
      const cTokens = new Set(ct.match(/[A-Z]{2,8}|[0-9]{1,3}|[一-龥]{2,6}/g) || []);
      for (const tk of mTokens) if (cTokens.has(tk)) score += tk.length >= 3 ? 2 : 1;
      if (ct.includes('高光') || ct.includes('集锦')) score -= 2;
      if (ct.includes('二路') || ct.includes('直播')) score -= 3;
      if (score > bestScore) {
        bestScore = score;
        best = c;
      }
    }
    if (!best || bestScore <= 0) continue;
    m.bvid = best.bvid;
    m.biliTitle = best.title;
    matched++;
  }
  console.log(`      匹配上 B 站视频 ${matched} / ${matches.length} 场`);

  // 2c-2. 腾讯还没发录像的比赛（刚打完的那些）→ 找 B 站搬运版，写回赛程
  const cleared = resetFuturePending(schedule);
  if (cleared) console.log(`      清理未来比赛的 B 站源映射 ${cleared} 条`);
  const pendingHits = matchPending(schedule, pool, pendingFresh);
  if (pendingHits.length) {
    console.log(`      待发布录像比赛匹配到 B 站源 ${pendingHits.length} 场：`);
    pendingHits.slice(0, 12).forEach((h) => console.log('        ' + h));
  }

  // 赛程（含 B 站源映射）
  fs.writeFileSync(
    schedulePath,
    JSON.stringify({
      updatedAt: new Date().toISOString(),
      source: '腾讯 LPL 公开赛程接口 (lpl.qq.com)',
      total: schedule.length,
      matches: schedule,
    })
  );
  console.log(`      赛程已写入 schedule.json（含 ${schedule.filter((m) => m.bvid).length} 场 B 站源）`);

  // 2d. 取 CID
  const withBvid = matches.filter((m) => m.bvid);
  console.log('[3/4] 获取 CID 与弹幕…');
  let dmOk = 0;
  let dmSkip = 0;
  let cidFail = 0;
  const targets = withBvid.slice(0, MAX_VODS);
  let debugShown = 0;
  for (let i = 0; i < targets.length; i++) {
    const m = targets[i];
    // 增量：cid 已知且弹幕文件已在 → 完全跳过
    if (m.cid && fs.existsSync(path.join(DM_DIR, m.cid + '.json'))) {
      dmOk++;
      continue;
    }
    const pages = fetchPages(m.bvid);
    if (!pages.length) {
      if (debugShown < 4) {
        console.log(`      [pagelist] ${m.bvid} 返回空`);
        debugShown++;
      }
      cidFail++;
      m.dmCount = 0;
      await sleep(1200);
      continue;
    }
    const page = pickPage(pages, gameNumberOf(m.title), m.duration);
    const cid = page.cid;
    m.cid = cid;
    m.biliTitle = page.part || '';
    m.biliPage = page.page;
    m.biliDuration = page.duration || 0;
    m.biliPages = pages.length;
    if (SKIP_DM) {
      m.dmCount = 0;
      await sleep(400);
      continue;
    }
    const outFile = path.join(DM_DIR, cid + '.json');
    if (fs.existsSync(outFile)) {
      try {
        const prev = JSON.parse(fs.readFileSync(outFile, 'utf8'));
        m.dmCount = prev.count || 0;
        dmOk++;
        await sleep(250);
        continue;
      } catch (e) {
        /* re-fetch */
      }
    }
    const xml = fetchDanmakuXml(cid);
    if (!xml) {
      m.dmCount = 0;
      dmSkip++;
      await sleep(600);
      continue;
    }
    const items = parseDanmakuXml(xml);
    if (!items.length) {
      m.dmCount = 0;
      dmSkip++;
      await sleep(600);
      continue;
    }
    const payload = {
      cid,
      bvid: m.bvid,
      page: page.page,
      part: page.part || '',
      title: m.biliTitle,
      count: items.length,
      items,
    };
    fs.writeFileSync(outFile, JSON.stringify(payload));
    m.dmCount = items.length;
    dmOk++;
    if ((i + 1) % 10 === 0) {
      const files = fs.readdirSync(DM_DIR);
      let bytes = 0;
      files.forEach((f) => (bytes += fs.statSync(path.join(DM_DIR, f)).size));
      console.log(
        `      ${i + 1}/${targets.length} 弹幕就绪 ${dmOk}，无弹幕 ${dmSkip}，失败 ${cidFail}，累计 ${files.length} 文件 / ${(
          bytes / 1024 / 1024
        ).toFixed(1)}MB`
      );
    }
    await sleep(500);
  }
  console.log(`      弹幕就绪 ${dmOk}，无弹幕 ${dmSkip}，cid失败 ${cidFail}`);

  // 2e. 直播间列表（标记开播状态 + 抓取直播流地址）
  //     流地址只能构建期拿：api.live.bilibili.com 的 playUrl 无 ACAO 头，
  //     运行时 fetch 必被 CORS 拦，JSONP 又会被 Chrome ORB 拦（application/json）。
  console.log('[4/4] 输出数据文件…');
  const COVER_DIR = path.join(DATA, 'cover');
  const liveList = [];
  // B 站 LPL 官方赛事直播间（搜索不一定能搜到，固定兜底）
  const KNOWN_ROOM_IDS = BILI_ROOM_IDS;
  const roomCandidates = new Map();
  for (const id of KNOWN_ROOM_IDS) roomCandidates.set(String(id), { roomid: id });
  for (const l of Array.from(lives.values())) roomCandidates.set(String(l.roomid), l);

  for (const cand of roomCandidates.values()) {
    const t = cand.title + '';
    const isKnown = KNOWN_ROOM_IDS.includes(Number(cand.roomid));
    if (!isKnown && !/英雄联盟|LPL|总决赛|赛事|二路|4K/i.test(t)) continue;
    let info = null;
    try {
      info = await fetchLiveRoom(cand.roomid);
    } catch (e) {
      /* 忽略 */
    }
    if (!info) continue;
    liveList.push({
      roomid: info.roomid,
      uid: info.uid || cand.uid || 0,
      title: info.title || t,
      live: info.live,
      online: info.online || 0,
      attention: info.attention || 0,
      uname: info.uname || '',
      area: info.area || '',
      // 封面帧由 capture-covers.mjs 抓；文件存在才写，否则前端显示平台占位
      cover: (() => {
        const f = path.join(COVER_DIR, `${info.roomid}.jpg`);
        return fs.existsSync(f) && fs.statSync(f).size > 2000 ? 'data/cover/' + info.roomid + '.jpg' : '';
      })(),
      stream: info.stream || null,
      biliUrl: info.biliUrl,
    });
    await sleep(200);
  }
  liveList.sort((a, b) => (b.live ? 1 : 0) - (a.live ? 1 : 0));
  fs.writeFileSync(
    livePath,
    JSON.stringify(
      {
        updatedAt: new Date().toISOString(),
        currentMatch: '',
        rooms: liveList,
        externalRooms: EXTERNAL_ROOMS,
      },
      null,
      1
    )
  );
  // 直播间签名：忽略具体流地址（每次刷新都会变），只看房间集合与开播状态
  const liveSig = liveSigOf(livePath);
  const anyLive = liveList.some((r) => r.live && r.stream);
  console.log(
    `      直播间 ${liveList.length} 个，其中 ${liveList.filter((r) => r.live).length} 个在播${
      anyLive ? '（已抓取流地址）' : ''
    }`
  );

  // catalog
  const clean = matches.map((m) => ({
    id: m.id,
    title: m.title,
    game: m.game,
    phase: m.phase,
    mode: m.mode,
    date: m.date,
    duration: m.duration,
    cover: m.cover,
    teamA: m.teamA,
    teamB: m.teamB,
    score: m.score,
    place: m.place,
    comments: m.comments,
    bvid: m.bvid || null,
    cid: m.cid || null,
    biliPage: m.biliPage || 1,
    biliPages: m.biliPages || 1,
    biliPart: m.biliTitle || '',
    dmCount: m.dmCount || 0,
  }));
  const catalog = {
    updatedAt: new Date().toISOString(),
    source: '腾讯 LPL 公开赛程接口 (lpl.qq.com)',
    total: clean.length,
    withDanmaku: clean.filter((m) => m.cid).length,
    matches: clean,
  };
  fs.writeFileSync(path.join(DATA, 'catalog.json'), JSON.stringify(catalog));

  const catSize = fs.statSync(path.join(DATA, 'catalog.json')).size;
  const dmFiles = fs.readdirSync(DM_DIR).filter((f) => f.endsWith('.json'));
  let dmSize = 0;
  dmFiles.forEach((f) => (dmSize += fs.statSync(path.join(DM_DIR, f)).size));

  // 是否有实质变化（供定时任务判断是否需要重新部署）
  let changed = true;
  if (prevJson) {
    const prevIds = new Set((prevJson.matches || []).map((m) => m.id));
    const newIds = new Set(clean.map((m) => m.id));
    const added = clean.filter((m) => !prevIds.has(m.id)).length;
    const removed = (prevJson.matches || []).filter((m) => !newIds.has(m.id)).length;
    const dmChanged = clean.filter((m) => {
      const p = (prevJson.matches || []).find((x) => x.id === m.id);
      return !p || (p.dmCount || 0) !== (m.dmCount || 0);
    }).length;
    changed = added > 0 || removed > 0 || dmChanged > 0;
    console.log(
      `      变化检查：新增 ${added} 场 / 移除 ${removed} 场 / 弹幕变化 ${dmChanged} 场`
    );
  }

  // 直播间 / 赛程变化也要触发部署：
  //   - 直播流地址有效期约 60 分钟，不刷新上线就会过期
  //   - 新赛程里的 B 站录像映射变化也必须同步到线上
  const schedSig = contentSig(schedulePath);
  const schedChanged = schedSig !== prevSchedSig;
  const liveChanged = liveSig !== prevLiveSig;
  if (schedChanged || liveChanged) changed = true;
  // 正在直播时，流地址必须随每次烘焙一起上线（否则观众打开就是过期流）
  if (anyLive) changed = true;
  console.log(
    `      赛程变化 ${schedChanged ? '是' : '否'} / 直播间变化 ${liveChanged ? '是' : '否'}` +
      (anyLive ? ' / 正在直播（强制同步流地址）' : '')
  );

  console.log(`CHANGED=${changed ? 1 : 0}`);

  console.log(
    `\n完成：catalog ${(catSize / 1024).toFixed(0)}KB / ${clean.length} 场；弹幕 ${dmFiles.length} 个文件 / ${(
      dmSize / 1024 / 1024
    ).toFixed(1)}MB；直播间 ${liveList.length} 个；耗时 ${((Date.now() - t0) / 1000).toFixed(0)}s`
  );
}

main().catch((e) => {
  console.error('bake 失败：', e);
  process.exit(1);
});
