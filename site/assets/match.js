/* =====================================================================
 * match.js — 总决赛跟赛页逻辑
 *
 * 设计原则（对应项目铁律）：
 *   · 纯静态、零后端、零外部运行时依赖
 *   · **不编造比分与数字**：比分必须带来源标注与更新时间；拿不到就明说并降级
 *   · **胜率模型输入全部来自数据文件实算**（schedule.json），不硬编码历史数字
 *   · 屏蔽词过滤复用 assets/abuse-words.js（唯一来源），渲染前逐条过滤
 *   · 独立页，不改主播放器逻辑
 * ===================================================================== */
(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const qs = new URLSearchParams(location.search);

  /* ================================================================= *
   * 1. 屏蔽词过滤（唯一来源：assets/abuse-words.js）
   *    匹配规则与 tools/abuse-words.mjs / site/assets/danmaku.js 保持一致：
   *    纯 ASCII 的 2~4 位短词按「词边界」匹配，其余按子串匹配。
   * ================================================================= */
  const ABUSE_WORDS = (window.__LPLTV_ABUSE_WORDS || []).map((w) => String(w).toLowerCase());
  const ABUSE_EXACT = [];
  const ABUSE_BOUNDED = [];
  for (const w of ABUSE_WORDS) {
    if (/^[a-z]{2,4}$/.test(w)) ABUSE_BOUNDED.push(new RegExp('(?<![a-z0-9])' + w + '(?![a-z0-9])', 'g'));
    else ABUSE_EXACT.push(w);
  }
  /** 这条文本是否命中屏蔽词 */
  function hasAbuse(text) {
    const t = String(text || '').toLowerCase();
    if (!t) return false;
    for (const n of ABUSE_EXACT) if (t.indexOf(n) !== -1) return true;
    for (const re of ABUSE_BOUNDED) {
      re.lastIndex = 0;
      if (re.test(t)) return true;
    }
    return false;
  }
  /** 安全文本：命中屏蔽词一律丢弃（不留空串占位，避免误判为"有内容"） */
  function safeText(text) {
    const t = String(text || '').trim();
    if (!t || hasAbuse(t)) return '';
    return t;
  }

  /* ================================================================= *
   * 2. 基础工具
   * ================================================================= */
  function el(tag, attrs, children) {
    const n = document.createElement(tag);
    if (attrs) {
      for (const k in attrs) {
        if (k === 'class') n.className = attrs[k];
        else if (k === 'text') n.textContent = attrs[k];
        else if (k === 'html') n.innerHTML = attrs[k];
        else if (k.startsWith('on') && typeof attrs[k] === 'function') n.addEventListener(k.slice(2), attrs[k]);
        else if (attrs[k] !== null && attrs[k] !== undefined) n.setAttribute(k, attrs[k]);
      }
    }
    (children || []).forEach((c) => c && n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c));
    return n;
  }
  function clear(node) {
    while (node && node.firstChild) node.removeChild(node.firstChild);
  }
  function fmtPct(x) {
    return (x * 100).toFixed(1) + '%';
  }
  function fmtClock(d) {
    const p = (n) => String(n).padStart(2, '0');
    return p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds());
  }
  function toast(msg) {
    const t = $('toast');
    if (!t) return;
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toast._t);
    toast._t = setTimeout(() => { t.hidden = true; }, 2600);
  }
  function combo(n, k) {
    if (k < 0 || k > n) return 0;
    let r = 1;
    for (let i = 1; i <= k; i++) r = (r * (n - k + i)) / i;
    return r;
  }

  /* ================================================================= *
   * 3. 数据层
   * ================================================================= */
  function readDataBases() {
    const out = [];
    const push = (v) => {
      if (typeof v === 'string' && v.trim() && out.indexOf(v.trim()) === -1) out.push(v.trim());
    };
    const m1 = document.querySelector('meta[name="lpl-tv-data-base"]');
    if (m1) push(m1.content);
    const m2 = document.querySelector('meta[name="lpl-tv-data-mirrors"]');
    if (m2) m2.content.split(/[,\s]+/).forEach(push);
    const w = window.__LPLTV_DATA_BASE__;
    if (typeof w === 'string') push(w);
    return out;
  }
  const DATA_BASES = readDataBases();

  async function fetchJson(url, timeoutMs) {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), timeoutMs || 12000);
    try {
      const res = await fetch(url, { signal: ac.signal, cache: 'no-store' });
      if (!res.ok) return null;
      return await res.json();
    } catch (e) {
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  /** 并发取各镜像的 schedule.json，按 updatedAt 挑最新的那份 */
  async function loadSchedule() {
    const jobs = DATA_BASES.map((b) =>
      fetchJson(b + '/schedule.json', 15000).then((j) => (j ? { base: b, json: j } : null))
    );
    const got = (await Promise.all(jobs)).filter(Boolean);
    if (!got.length) {
      // 远端全挂 → 本地快照
      const local = await fetchJson('data/schedule.json', 8000);
      return local ? { json: local, origin: 'local', updatedAt: local.updatedAt || '' } : null;
    }
    got.sort((a, b) => String(b.json.updatedAt || '').localeCompare(String(a.json.updatedAt || '')));
    const best = got[0];
    return { json: best.json, origin: 'remote', base: best.base, updatedAt: best.json.updatedAt || '' };
  }

  /** 跨域加载腾讯的静态 JS 数据文件（作为全局变量注入，无需 CORS） */
  function loadGlobalScript(src, globalName) {
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.async = true;
      s.src = src + (src.indexOf('?') > -1 ? '&' : '?') + '_=' + Date.now();
      s.onload = () => resolve(window[globalName]);
      s.onerror = () => reject(new Error('加载 ' + globalName + ' 失败'));
      document.head.appendChild(s);
    });
  }

  let jsonpSeq = 0;
  function jsonp(url, params, opts) {
    opts = opts || {};
    return new Promise((resolve, reject) => {
      const cb = '__lpltv_m_' + ++jsonpSeq + '_' + Date.now().toString(36);
      const script = document.createElement('script');
      const merged = Object.assign({}, params, { callback: cb });
      const qsx = Object.keys(merged)
        .map((k) => encodeURIComponent(k) + '=' + encodeURIComponent(merged[k]))
        .join('&');
      let done = false;
      const cleanup = () => {
        clearTimeout(timer);
        try { delete window[cb]; } catch (e) { window[cb] = undefined; }
        if (script.parentNode) script.parentNode.removeChild(script);
      };
      const timer = setTimeout(() => {
        if (done) return;
        done = true;
        try {
          window[cb] = function () {};
          setTimeout(() => { try { delete window[cb]; } catch (e) {} }, 300000);
        } catch (e) {}
        if (script.parentNode) script.parentNode.removeChild(script);
        reject(new Error('接口请求超时'));
      }, opts.timeout || 15000);
      window[cb] = (data) => {
        if (done) return;
        done = true;
        cleanup();
        resolve(data);
      };
      script.onerror = () => {
        if (done) return;
        done = true;
        cleanup();
        reject(new Error('接口请求失败（可能是跨域或网络受限）'));
      };
      script.async = true;
      script.src = url + (url.indexOf('?') > -1 ? '&' : '?') + qsx;
      document.head.appendChild(script);
    });
  }

  /* ================================================================= *
   * 4. 找决赛 + 两队统计 + 胜率模型
   * ================================================================= */
  function parseScore(s) {
    const m = String(s || '').match(/(\d+)\s*[:\-]\s*(\d+)/);
    return m ? { a: +m[1], b: +m[2] } : null;
  }

  /** 找「本页要跟的那场比赛」：优先 URL 指定，否则取决赛轮次里最晚开打的一场 */
  function findFinalMatch(matches) {
    const wantGame = qs.get('g');
    const wantMatch = qs.get('m');
    if (wantMatch) {
      const hit = matches.find((x) => String(x.bMatchId) === String(wantMatch));
      if (hit) return hit;
    }
    const finals = matches
      .filter((m) => /决赛/.test(String(m.phase || '')) || /决赛/.test(String(m.title || '')))
      .filter((m) => m.teamA && m.teamB)
      .sort((a, b) => String(b.date).localeCompare(String(a.date)));
    if (finals.length) return finals[0];
    const withBoth = matches
      .filter((m) => m.teamA && m.teamB)
      .sort((a, b) => String(b.date).localeCompare(String(a.date)));
    return withBoth[0] || null;
  }

  /** 是不是同一场比赛（bMatchId 优先，缺失时用日期+两队兜底） */
  function isSameMatch(a, b) {
    if (!a || !b) return false;
    if (a.bMatchId && b.bMatchId) return String(a.bMatchId) === String(b.bMatchId);
    return String(a.date) === String(b.date) && a.teamA === b.teamA && a.teamB === b.teamB;
  }

  /** 单队在本届赛事的战绩（系列赛 / 小局 / BO5）
   *
   * ⚠️ excludeFinal：正在预测的那场**必须排除**在模型输入之外。
   *    否则就是循环论证 —— 用「已经打到 1:0」去推导「1:0 时的胜率」，
   *    先验会被自己的预测对象污染（实测这会让 p 从 0.5294 漂到 0.5594）。
   */
  function teamStats(matches, tournament, team, excludeFinal) {
    const rows = matches.filter((m) => {
      if (m.game !== tournament) return false;
      if (!(m.teamA === team || m.teamB === team)) return false;
      if (excludeFinal && isSameMatch(m, excludeFinal)) return false; // 排除本场
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
      if (m.mode === 'BO5') {
        bo5.played++;
        bo5.gamesW += won;
        bo5.gamesL += lost;
        if (won > lost) bo5.w++;
        else if (lost > won) bo5.l++;
        if (lost === 0) bo5.sweeps++;
        bo5.series.push({ date: m.date, phase: m.phase, opponent: opp, score: won + ':' + lost, won: won > lost });
      }
    }
    rows.sort((a, b) => String(a.date).localeCompare(String(b.date)));
    const last = rows[rows.length - 1];
    return { series, games, bo5, rows, lastMatch: last || null };
  }

  /** 计算两队休赛天数（决赛日 − 上一场日） */
  function restDaysBetween(lastDate, finalDate) {
    if (!lastDate || !finalDate) return null;
    const a = new Date(String(lastDate).replace(/-/g, '/')).getTime();
    const b = new Date(String(finalDate).replace(/-/g, '/')).getTime();
    if (isNaN(a) || isNaN(b)) return null;
    return Math.round((b - a) / 86400000);
  }

  /** BO5 结算：a 队已赢 a 局、b 队已赢 b 局时，a 队最终获胜的概率 */
  function seriesWinProb(p, a, b) {
    if (a >= 3) return 1;
    if (b >= 3) return 0;
    const needA = 3 - a;
    const needB = 3 - b;
    const q = 1 - p;
    let sum = 0;
    for (let j = 0; j <= needB - 1; j++) sum += combo(needA - 1 + j, j) * Math.pow(p, needA) * Math.pow(q, j);
    return sum;
  }

  /**
   * 胜率模型（可解释、可手算）
   *  ① 单队 BO5 小局胜率 r = (胜+1)/(胜+负+2)      —— 加一平滑
   *  ② 对位单小局胜率 p = r_A/(r_A+r_B)            —— Bradley-Terry
   *  ③ 赛前先验 = p³(1+3q+6q²)                    —— BO5 净胜 3 局
   *  ④ 实时条件 P = Σ_{j<需B} C(需A-1+j, j) p^需A q^j
   * 输入全部来自 schedule.json 实算，绝不硬编码。
   */
  function buildModel(matches, finalMatch, statsA, statsB) {
    const rA = (statsA.bo5.gamesW + 1) / (statsA.bo5.gamesW + statsA.bo5.gamesL + 2);
    const rB = (statsB.bo5.gamesW + 1) / (statsB.bo5.gamesW + statsB.bo5.gamesL + 2);
    const p = rA / (rA + rB);
    const q = 1 - p;
    const prior = seriesWinProb(p, 0, 0);
    const nameA = finalMatch.teamA;
    const nameB = finalMatch.teamB;
    return {
      p: p,
      q: q,
      prior: prior,
      rA: rA,
      rB: rB,
      nameA: nameA,
      nameB: nameB,
      steps: [
        `${nameA} 本届 BO5 小局 ${statsA.bo5.gamesW} 胜 ${statsA.bo5.gamesL} 负 → 加一平滑 (${statsA.bo5.gamesW}+1)/(${statsA.bo5.gamesW + statsA.bo5.gamesL}+2) = ${rA.toFixed(4)}`,
        `${nameB} 本届 BO5 小局 ${statsB.bo5.gamesW} 胜 ${statsB.bo5.gamesL} 负 → 加一平滑 (${statsB.bo5.gamesW}+1)/(${statsB.bo5.gamesW + statsB.bo5.gamesL}+2) = ${rB.toFixed(4)}`,
        `对位单小局胜率 p = ${rA.toFixed(4)} / (${rA.toFixed(4)} + ${rB.toFixed(4)}) = ${p.toFixed(4)}（Bradley-Terry）`,
        `赛前先验（0:0）= p³(1 + 3q + 6q²)，q = ${q.toFixed(4)} → ${(prior * 100).toFixed(2)}%`,
      ],
    };
  }

  /* ================================================================= *
   * 5. 比分源（多源 + 诚实降级）
   * ================================================================= */
  const SCORE = {
    a: null,
    b: null,
    known: false,
    source: 'none',     // manual | tencent | snapshot | danmaku | none
    sourceLabel: '未获取到比分',
    updatedAt: '',
    fresh: false,
    note: '',
  };

  function setScore(a, b, source, label, updatedAt, fresh, note) {
    SCORE.a = a;
    SCORE.b = b;
    SCORE.known = a !== null && b !== null;
    SCORE.source = source;
    SCORE.sourceLabel = label;
    SCORE.updatedAt = updatedAt || '';
    SCORE.fresh = !!fresh;
    SCORE.note = note || '';
  }

  const MANUAL_KEY = 'lpltv_manual_score';

  function readManual() {
    const url = qs.get('s');
    if (url && /^\d{1,2}\s*[:\-]\s*\d{1,2}$/.test(url.trim())) {
      const m = url.trim().match(/^(\d{1,2})\s*[:\-]\s*(\d{1,2})$/);
      return { a: Math.min(3, +m[1]), b: Math.min(3, +m[2]) };
    }
    try {
      const raw = localStorage.getItem(MANUAL_KEY);
      if (raw) {
        const j = JSON.parse(raw);
        if (typeof j.a === 'number' && typeof j.b === 'number') return { a: j.a, b: j.b };
      }
    } catch (e) {}
    return null;
  }
  function writeManual(v) {
    try {
      if (v) localStorage.setItem(MANUAL_KEY, JSON.stringify(v));
      else localStorage.removeItem(MANUAL_KEY);
    } catch (e) {}
  }

  /**
   * 腾讯官方赛事记分牌（<script> 注入，无需 CORS）
   *
   * ⚠️ 只读 `var xxx = {...}` 形式的文件 —— LOL_MATCH2_MATCH_HOMEPAGE_BMATCH_LIST*.js
   *    是**裸 JSON**（没有 var 赋值），用 <script> 加载只会求值后丢弃，读不出来；
   *    而腾讯的边缘节点会滞后（实测同一时刻 gh-proxy 拿到 11-09 旧副本、raw 拿到 04:39 新副本），
   *    所以这个源只能当**备选**，主源是 CI 每 20 分钟烘焙的 schedule.json。
   */
  async function fetchTencentScoreboard(finalMatch) {
    const candidates = [
      ['https://lpl.qq.com/web201612/data/LOL_MATCH2_LIVE_BMATCH_LIST.js', 'LiveBMatchList'],
    ];
    for (const [url, globalName] of candidates) {
      let obj = null;
      try {
        obj = await loadGlobalScript(url, globalName);
      } catch (e) {
        continue;
      }
      if (!obj || !obj.msg) continue;
      const rows = [];
      const msg = obj.msg;
      if (Array.isArray(msg)) rows.push(...msg);
      else {
        for (const v of Object.values(msg)) {
          if (Array.isArray(v)) rows.push(...v);
          else if (typeof v === 'string' && v) {
            try {
              const p = JSON.parse(v);
              if (Array.isArray(p)) rows.push(...p);
              else if (p && typeof p === 'object') rows.push(p);
            } catch (e) {}
          }
        }
      }
      const hit = rows.find(
        (r) =>
          r &&
          (String(r.bMatchId) === String(finalMatch.bMatchId) ||
            (/GEN|BLG/i.test(String(r.TeamNameA || '') + String(r.TeamNameB || '')) &&
              /决赛/.test(String(r.GameProcName || ''))))
      );
      if (hit) {
        const a = parseInt(hit.ScoreA, 10);
        const b = parseInt(hit.ScoreB, 10);
        return {
          a: isNaN(a) ? null : a,
          b: isNaN(b) ? null : b,
          status: hit.MatchStatus,
          lastUpTime: obj.lastUpTime || obj.lastUpdateTime || '',
        };
      }
    }
    return null;
  }

  /* ================================================================= *
   * 6. 全局状态
   * ================================================================= */
  const STATE = {
    matches: [],
    finalMatch: null,
    statsA: null,
    statsB: null,
    model: null,
    scheduleUpdatedAt: '',
    scheduleOrigin: '',
    tencentStatus: '',
    tencentFresh: false,
    tencentUpdatedAt: '',
    teamLogos: {},
    baselines: null,
    danmaku: {
      client: null,
      status: 'idle',
      statusText: '未启动',
      lines: [],
      hot: new Map(),
      pos: 0,
      neg: 0,
      milestones: [],
    },
  };

  const MILESTONE_WORDS = ['拿下', '扳回', '逆转', '翻盘', '零封', '一穿', '三杀', '四杀', '五杀', '抢大龙', '大龙', '男爵', '先锋', '决胜局', '点塔', '推塔', '扳', '晋级', '冠军'];
  const POS_WORDS = ['牛', '强', '稳', '赢', '拿下', '泪目', '帅', '棒', '香', '起飞', '逆袭', '翻盘', '晋级', '冠军', '秀', '顶', '好', '爽', '绝', '无敌', '统治'];
  const NEG_WORDS = ['输', '拉', '垮', '菜', '崩', '难受', '心疼', '离谱', '完蛋', '寄', '摆烂', '白给', '掉链子', '逆风', '惨', '垃圾', '滚', '失误', '下饭', '退钱'];

  /* ================================================================= *
   * 7. 渲染
   * ================================================================= */
  function renderScoreboard() {
    const m = STATE.finalMatch;
    if (!m) return;
    $('sb-meta').textContent =
      [m.game, m.phase, m.mode, m.date, m.place].filter(Boolean).join(' · ');
    $('sb-name-a').textContent = m.teamA;
    $('sb-name-b').textContent = m.teamB;
    // 队徽：先按队名，再按腾讯队 id 兜底（GEN 的 TeamShortName 是空字符串）
    const la = STATE.teamLogos[m.teamA] || STATE.teamLogos[String(m.teamIdA || '')];
    const lb = STATE.teamLogos[m.teamB] || STATE.teamLogos[String(m.teamIdB || '')];
    if (la) { $('sb-logo-a').src = la; $('sb-logo-a').hidden = false; }
    if (lb) { $('sb-logo-b').src = lb; $('sb-logo-b').hidden = false; }

    if (SCORE.known) {
      $('sb-score-a').textContent = String(SCORE.a);
      $('sb-score-b').textContent = String(SCORE.b);
    } else {
      $('sb-score-a').textContent = '?';
      $('sb-score-b').textContent = '?';
    }
    $('sb-note').textContent = SCORE.note || '';

    const src = $('sb-src');
    clear(src);
    src.appendChild(document.createTextNode('比分来源：'));
    const b = el('b', { text: SCORE.sourceLabel });
    src.appendChild(b);
    if (SCORE.updatedAt) src.appendChild(document.createTextNode(' · ' + SCORE.updatedAt));
    if (SCORE.source === 'tencent' && !SCORE.fresh) {
      src.appendChild(el('span', { class: 'warn', text: ' · 该源尚未刷新比分，比分未确认' }));
    }
    if (SCORE.source === 'none') {
      src.appendChild(el('span', { class: 'warn', text: ' · 所有数据源均未给出比分，请用「手动指定比分」' }));
    }

    // 状态徽标：腾讯实时表没有 MatchStatus 字段（只有 AppShowFlag_*），
    // 所以状态由「比分 + 开赛时间」推导，并在有腾讯状态时优先用腾讯的。
    const st = $('sb-state');
    const txt = $('sb-state-text');
    st.className = 'sb-state';
    const started = m.date ? new Date(String(m.date).replace(/-/g, '/')).getTime() <= Date.now() : false;
    if (SCORE.known && (SCORE.a >= 3 || SCORE.b >= 3)) {
      st.classList.add('done');
      txt.textContent = '已结束';
    } else if (STATE.tencentStatus === '3') {
      st.classList.add('done');
      txt.textContent = '已结束';
    } else if (STATE.tencentStatus === '2' || started) {
      st.classList.add('on');
      txt.textContent = '进行中';
    } else if (STATE.tencentStatus === '1') {
      txt.textContent = '未开始';
    } else {
      st.classList.add('err');
      txt.textContent = '状态未知';
    }
  }

  function renderProb() {
    const m = STATE.model;
    if (!m) return;
    const a = SCORE.known ? SCORE.a : 0;
    const b = SCORE.known ? SCORE.b : 0;
    const pA = seriesWinProb(m.p, a, b);
    const pB = 1 - pA;
    $('prob-name-a').textContent = m.nameA;
    $('prob-name-b').textContent = m.nameB;
    $('prob-pct-a').textContent = fmtPct(pA);
    $('prob-pct-b').textContent = fmtPct(pB);
    $('prob-fill').style.width = (pA * 100).toFixed(2) + '%';

    const needA = Math.max(0, 3 - a);
    const needB = Math.max(0, 3 - b);
    const why = $('prob-why');
    clear(why);
    if (!SCORE.known) {
      why.appendChild(el('b', { text: '当前比分未确认' }));
      why.appendChild(
        document.createTextNode(
          `，下方胜率显示的是**赛前先验**（${fmtPct(m.prior)} : ${fmtPct(1 - m.prior)}）。拿到比分后自动切换为条件概率。`
        )
      );
    } else if (a >= 3 || b >= 3) {
      why.appendChild(el('b', { text: '比赛已结束' }));
      why.appendChild(document.createTextNode(`：${m.nameA} ${a} : ${b} ${m.nameB}，胜率归一为 100% / 0%。`));
    } else {
      why.appendChild(el('b', { text: `当前 ${a}:${b}` }));
      why.appendChild(
        document.createTextNode(
          ` · ${m.nameA} 还需 ${needA} 胜、${m.nameB} 还需 ${needB} 胜 · 单小局胜率 p=${m.p.toFixed(4)} → ${m.nameA} ${fmtPct(pA)}`
        )
      );
    }

    const steps = $('prob-steps');
    clear(steps);
    m.steps.forEach((s) => steps.appendChild(el('li', { text: s })));
    steps.appendChild(
      el('li', {
        text:
          '实时条件概率：P(' + m.nameA + ' 拿下) = Σ_{j=0}^{' + Math.max(0, needB - 1) + '} C(' + Math.max(0, needA - 1) + '+j, j) · p^' + needA + ' · q^j = ' + fmtPct(pA),
      })
    );
    steps.appendChild(
      el('li', { text: '终局归一：3 胜即 100%，对方 3 胜即 0%；其余组合由上式直接结算' })
    );
    steps.appendChild(
      el('li', { text: '模型输入（BO5 小局胜率、单局胜率 p、先验）全部由 site/data/schedule.json 实算，未硬编码任何历史数字' })
    );
  }

  function renderCompare() {
    const m = STATE.finalMatch;
    const sA = STATE.statsA;
    const sB = STATE.statsB;
    const box = $('cmp-table');
    if (!m || !sA || !sB) return;
    const sub = $('compare-sub');
    sub.textContent =
      (m.game || '') +
      ' · ' +
      (STATE.scheduleUpdatedAt ? '数据快照 ' + STATE.scheduleUpdatedAt : '') +
      ' · 统计口径：本场决赛不计入（避免用结果预测结果）';
    const restA = restDaysBetween(sA.lastMatch && sA.lastMatch.date, m.date);
    const restB = restDaysBetween(sB.lastMatch && sB.lastMatch.date, m.date);
    const rows = [
      ['系列赛战绩', `${sA.series.w}胜${sA.series.l}负`, `${sB.series.w}胜${sB.series.l}负`, sA.series.w + sA.series.l, sB.series.w + sB.series.l],
      ['小局战绩', `${sA.games.w}-${sA.games.l}`, `${sB.games.w}-${sB.games.l}`, sA.games.w + sA.games.l, sB.games.w + sB.games.l],
      ['BO5 战绩', `${sA.bo5.w}胜${sA.bo5.l}负`, `${sB.bo5.w}胜${sB.bo5.l}负`, sA.bo5.w + sA.bo5.l, sB.bo5.w + sB.bo5.l],
      ['BO5 小局', `${sA.bo5.gamesW}-${sA.bo5.gamesL}`, `${sB.bo5.gamesW}-${sB.bo5.gamesL}`, sA.bo5.gamesW + sA.bo5.gamesL, sB.bo5.gamesW + sB.bo5.gamesL],
      ['BO5 零封率', sA.bo5.played ? Math.round((sA.bo5.sweeps / sA.bo5.played) * 100) + '%' : '—', sB.bo5.played ? Math.round((sB.bo5.sweeps / sB.bo5.played) * 100) + '%' : '—', sA.bo5.sweeps, sB.bo5.sweeps],
      ['决赛前休赛', restA === null ? '—' : restA + ' 天', restB === null ? '—' : restB + ' 天', restA, restB],
    ];
    const table = el('table');
    const thead = el('thead');
    thead.appendChild(el('tr', {}, [el('th', { text: '指标' }), el('th', { text: m.teamA }), el('th', { text: m.teamB })]));
    table.appendChild(thead);
    const tbody = el('tbody');
    for (const [label, va, vb, na, nb] of rows) {
      let clsA = '';
      let clsB = '';
      if (typeof na === 'number' && typeof nb === 'number' && na !== nb) {
        clsA = na > nb ? 'win' : 'lose';
        clsB = nb > na ? 'win' : 'lose';
      }
      tbody.appendChild(
        el('tr', {}, [
          el('td', { text: label }),
          el('td', { class: clsA, text: va }),
          el('td', { class: clsB, text: vb }),
        ])
      );
    }
    table.appendChild(tbody);
    clear(box);
    box.appendChild(table);

    // BO5 明细
    const det = el('details');
    det.style.marginTop = '12px';
    det.appendChild(el('summary', { text: '展开两队 BO5 明细与交手记录' }));
    const list = el('ul', { class: 'ins-list' });
    list.style.marginTop = '10px';
    for (const [team, st] of [[m.teamA, sA], [m.teamB, sB]]) {
      const text = st.bo5.series.length
        ? st.bo5.series.map((x) => `${x.date.slice(5, 10)} ${x.phase || ''} ${x.opponent} ${x.score}`).join('；')
        : '本届无 BO5 记录';
      list.appendChild(el('li', { text: team + ' BO5：' + text }));
    }
    const h2h = STATE.matches.filter(
      (x) => (x.teamA === m.teamA && x.teamB === m.teamB) || (x.teamA === m.teamB && x.teamB === m.teamA)
    );
    list.appendChild(
      el('li', {
        class: h2h.length ? '' : 'hl',
        text: h2h.length
          ? '历史交手 ' + h2h.length + ' 场：' + h2h.map((x) => `${x.date.slice(0, 10)} ${x.score}`).join('；')
          : '双方历史零交手 —— 本场是首次交锋，历史数据无法提供直接先验',
      })
    );
    det.appendChild(list);
    box.appendChild(det);
  }

  function renderInsight() {
    const m = STATE.finalMatch;
    const sA = STATE.statsA;
    const sB = STATE.statsB;
    const model = STATE.model;
    const list = $('ins-list');
    if (!m || !sA || !sB) return;
    clear(list);
    const push = (text, cls) => list.appendChild(el('li', { class: cls || '', html: text }));

    push(
      `<b>${m.teamA}</b> 本届 <b>${sA.series.w} 战 ${sA.series.l} 负</b>，小局 <b>${sA.games.w}-${sA.games.l}</b>` +
        (sA.bo5.played
          ? `；BO5 ${sA.bo5.w}胜${sA.bo5.l}负，小局 ${sA.bo5.gamesW}-${sA.bo5.gamesL}，零封 ${sA.bo5.sweeps} 场（零封率 ${Math.round(
              (sA.bo5.sweeps / sA.bo5.played) * 100
            )}%）`
          : '')
    );
    push(
      `<b>${m.teamB}</b> 本届 <b>${sB.series.w} 战 ${sB.series.l} 负</b>，小局 <b>${sB.games.w}-${sB.games.l}</b>` +
        (sB.bo5.played
          ? `；BO5 ${sB.bo5.w}胜${sB.bo5.l}负，小局 ${sB.bo5.gamesW}-${sB.bo5.gamesL}，零封 ${sB.bo5.sweeps} 场（零封率 ${Math.round(
              (sB.bo5.sweeps / sB.bo5.played) * 100
            )}%）`
          : '')
    );

    const h2h = STATE.matches.filter(
      (x) => (x.teamA === m.teamA && x.teamB === m.teamB) || (x.teamA === m.teamB && x.teamB === m.teamA)
    );
    if (!h2h.length) {
      push('<b>首次交手</b>：两队在本赛事无历史对阵，模型只能用各自本届表现推导先验，不存在「老对手」的历史修正项。', 'hl');
    }

    const restA = restDaysBetween(sA.lastMatch && sA.lastMatch.date, m.date);
    const restB = restDaysBetween(sB.lastMatch && sB.lastMatch.date, m.date);
    if (restA !== null && restB !== null && restA !== restB) {
      const more = restA > restB ? m.teamA : m.teamB;
      const less = restA > restB ? m.teamB : m.teamA;
      push(
        `<b>休息日差</b>：${m.teamA} 休 ${restA} 天、${m.teamB} 休 ${restB} 天 —— ${more} 多休 ${Math.abs(
          restA - restB
        )} 天，${less} 赛程更紧（BO5 后段体能是变量）。`
      );
    }

    if (model) {
      push(
        `<b>模型结论</b>：单小局对位胜率 p=${model.p.toFixed(4)}，赛前先验 <b>${fmtPct(model.prior)} : ${fmtPct(
          1 - model.prior
        )}</b>。该先验由上面两队的 BO5 小局胜率实算得到（推导链见上方）。`
      );
    }

    push(
      `<b>赛制</b>：${m.mode}（3 胜制）。BO5 的分差会被放大——领先 1 局仍可能被翻盘，领先 2 局才接近安全区。`
    );

    const oppsA = sA.bo5.series.map((x) => x.opponent);
    const oppsB = sB.bo5.series.map((x) => x.opponent);
    if (oppsA.length || oppsB.length) {
      push(
        `<b>淘汰赛路径</b>：${m.teamA} 依次打了 ${oppsA.join('、') || '—'}；${m.teamB} 依次打了 ${oppsB.join('、') || '—'}。` +
          '注意：对手强度未做量化（站内数据没有统一的评级口径），这里只陈述事实，不编造「谁更强」。'
      );
    }

    if (SCORE.source === 'tencent' && !SCORE.fresh) {
      push(
        `<b>数据时效提醒</b>：腾讯官方记分牌本轮未刷新比分（最后更新 ${SCORE.updatedAt || '未知'}），` +
          '面板显示的比分尚未被官方源确认；可在比分来源处手动指定。',
        'warn'
      );
    }
  }

  function renderSocial() {
    const dm = STATE.danmaku;
    const st = $('dm-status');
    clear(st);
    const badge = (ok, text) => el('span', { class: ok ? 'ok' : 'bad', text });
    if (dm.status === 'live') {
      st.appendChild(badge(true, '● 实时弹幕已连通'));
      st.appendChild(document.createTextNode(`（B 站直播间 · 已收到 ${dm.lines.length} 条）`));
    } else if (dm.status === 'connecting') {
      st.appendChild(badge(false, '● 正在连接实时弹幕…'));
    } else {
      st.appendChild(badge(false, '● 实时弹幕通道当前不可用'));
      st.appendChild(
        document.createTextNode(
          '：' +
            (dm.statusText || 'B 站握手被风控拦截（-352），匿名握手被服务端关闭') +
            '。下方热词 / 情绪 / 里程碑改用**站内历史弹幕基线**（已过审的历史评论样本），不是决赛实时弹幕。'
        )
      );
    }

    const live = $('dm-live');
    clear(live);
    dm.lines.slice(-60).forEach((l) => {
      const isMs = MILESTONE_WORDS.some((w) => l.text.indexOf(w) >= 0);
      live.appendChild(
        el('div', { class: 'dm-line' }, [
          el('span', { class: 'dm-time', text: fmtClock(new Date(l.time)) }),
          el('span', { class: 'dm-text' + (isMs ? ' hl' : ''), text: l.text }),
        ])
      );
    });

    // 热词
    const hot = $('hot-words');
    clear(hot);
    const baseHot = (STATE.baselines && STATE.baselines.danmaku && STATE.baselines.danmaku.hotWords) || [];
    const hotSrc = dm.hot.size ? dm.hot : new Map(baseHot.map((h) => [h.word, h.count]));
    if (!hotSrc.size) hot.appendChild(el('span', { class: 'senti-note', text: '暂无热词样本' }));
    const sorted = [...hotSrc.entries()].sort((a, b) => b[1] - a[1]).slice(0, 18);
    for (const [w, c] of sorted) {
      const word = safeText(w);
      if (!word) continue;
      hot.appendChild(el('span', { class: 'hot-word', text: word }, [el('b', { text: '×' + c })]));
    }

    // 情绪
    const sen = $('sentiment');
    clear(sen);
    const base = (STATE.baselines && STATE.baselines.danmaku && STATE.baselines.danmaku.sentiment) || null;
    const pos = dm.pos || (base && base.positive) || 0;
    const neg = dm.neg || (base && base.negative) || 0;
    const idx = pos + neg ? (pos / (pos + neg)) * 100 : null;
    sen.appendChild(el('div', { class: 'senti-num', text: idx === null ? '—' : idx.toFixed(1) + '%' }));
    sen.appendChild(
      el('div', { class: 'senti-note', text: '正向情绪占比（' + pos + ' 正 / ' + neg + ' 负，词典法，仅供趋势参考）' })
    );
    const bar = el('div', { class: 'senti-bar' });
    const tot = pos + neg || 1;
    bar.appendChild(el('div', { class: 'senti-pos', style: 'width:' + ((pos / tot) * 100).toFixed(1) + '%' }));
    bar.appendChild(el('div', { class: 'senti-neg', style: 'width:' + ((neg / tot) * 100).toFixed(1) + '%' }));
    sen.appendChild(bar);
    sen.appendChild(
      el('div', { class: 'senti-note', text: '样本来源：' + (dm.pos || dm.neg ? '实时弹幕' : '站内历史弹幕基线（site/data/final-baseline.json）') })
    );

    // 里程碑
    const ms = $('milestones');
    clear(ms);
    const msList = dm.milestones.length
      ? dm.milestones
      : (STATE.baselines && STATE.baselines.danmaku && STATE.baselines.danmaku.milestones) || [];
    if (!msList.length) ms.appendChild(el('span', { class: 'senti-note', text: '暂无里程碑样本' }));
    for (const item of msList.slice(0, 12)) {
      const text = safeText(item.text);
      if (!text) continue;
      ms.appendChild(
        el('div', { class: 'ms-item' }, [
          el('span', { class: 'ms-tag', text: item.tag }),
          el('span', { class: 'ms-text', text: text }),
        ])
      );
    }
  }

  /* ================================================================= *
   * 8. 直播源
   * ================================================================= */
  const STREAM = { anchors: [], current: null, hls: null };
  async function loadStream() {
    const ctl = $('stream-ctl');
    const links = $('stream-links');
    let raw = null;
    try {
      raw = await jsonp(
        'https://lol.sw.game.qq.com/lol/commact/',
        { proj: 'a20200415livelink', c: 'a20200415livelink', a: 'getMatchScheduleList' },
        { timeout: 15000 }
      );
    } catch (e) {
      raw = null;
    }
    const list = (raw && raw.data && raw.data.anchorList) || [];
    const m = STATE.finalMatch;
    const pick =
      list.find((a) => {
        let gp = {};
        try { gp = JSON.parse((a.extInfo && a.extInfo.gameProgram) || '{}'); } catch (e) {}
        const sub = String(gp.subTitle || '');
        return m && sub.indexOf(m.teamA) >= 0 && sub.indexOf(m.teamB) >= 0;
      }) || list[0];
    if (!pick) {
      $('stream-sub').textContent = '腾讯官方直播接口当前不可用（' + (raw ? '未返回锚点' : '请求失败') + '）';
      return;
    }
    let gp = {};
    try { gp = JSON.parse((pick.extInfo && pick.extInfo.gameProgram) || '{}'); } catch (e) {}
    const qualities = ((pick.playInfo && pick.playInfo.streamInfo) || [])
      .map((s) => ({
        name: s.desc || s.bitrate + 'k',
        bitrate: s.bitrate,
        url: String(s.hlsUrl || '').replace(/^http:/, 'https:'),
      }))
      .filter((q) => q.url);
    STREAM.anchors = qualities;
    $('stream-sub').textContent =
      '腾讯官方公开直播地址（无 token，永久有效）' + (gp.subTitle ? ' · ' + gp.subTitle : '');
    clear(ctl);
    qualities.forEach((q, i) => {
      ctl.appendChild(
        el('button', {
          class: 'btn btn-ghost' + (i === 0 ? ' on' : ''),
          type: 'button',
          text: q.name,
          onclick: () => {
            [...ctl.children].forEach((c) => c.classList.remove('on'));
            ctl.children[i].classList.add('on');
            playStream(q.url);
          },
        })
      );
    });
    clear(links);
    const biliRoom = '7734200';
    links.appendChild(
      el('a', { href: 'https://live.bilibili.com/' + biliRoom, target: '_blank', rel: 'noopener', text: 'B 站直播间（弹幕）' })
    );
    links.appendChild(el('a', { href: './index.html#/live', text: '回主站播放器' }));
    links.appendChild(el('a', { href: 'https://lpl.qq.com/web202301/event.html?tabId=schedule', target: '_blank', rel: 'noopener', text: '腾讯官方赛事页' }));
    if (qualities.length) playStream(qualities[0].url);
  }

  function playStream(url) {
    const v = $('player');
    const hint = $('video-hint');
    if (!v || !url) return;
    if (window.Hls && window.Hls.isSupported()) {
      if (STREAM.hls) {
        try { STREAM.hls.destroy(); } catch (e) {}
      }
      const hls = new window.Hls({ enableWorker: true, lowLatencyMode: true, backBufferLength: 60 });
      STREAM.hls = hls;
      hls.loadSource(url);
      hls.attachMedia(v);
      hls.on(window.Hls.Events.MANIFEST_PARSED, () => {
        v.play().catch(() => {});
        hint.textContent = '正在播放…（若无声请点一下播放器）';
      });
      hls.on(window.Hls.Events.ERROR, (e, data) => {
        if (data && data.fatal) hint.textContent = '直播流加载失败：' + (data.details || '未知错误');
      });
    } else if (v.canPlayType('application/vnd.apple.mpegurl')) {
      v.src = url;
      v.play().catch(() => {});
      hint.textContent = '正在播放…';
    } else {
      hint.textContent = '当前浏览器不支持 HLS 播放，可点下方链接到官方源观看';
    }
  }

  /* ================================================================= *
   * 9. 弹幕跟进
   * ================================================================= */
  function startDanmaku() {
    const dm = STATE.danmaku;
    if (!window.LPLTVLiveDanmaku) {
      dm.status = 'failed';
      dm.statusText = '弹幕模块未加载';
      renderSocial();
      return;
    }
    const roomId = 7734200; // B 站官方决赛直播间
    dm.status = 'connecting';
    dm.statusText = '连接中';
    renderSocial();
    const client = new window.LPLTVLiveDanmaku(
      roomId,
      (msg) => {
        const text = safeText(msg.text);
        if (!text) return; // 合规：命中屏蔽词直接丢弃
        dm.lines.push({ text: text, time: msg.time || Date.now() });
        if (dm.lines.length > 400) dm.lines.shift();
        // 热词：**与历史基线同一本词典**（基线词典在 data/final-baseline.json 的 hotDict），
        // 这样实时弹幕与历史基线的热词可以同口径对比。
        const dict =
          (STATE.baselines && STATE.baselines.danmaku && STATE.baselines.danmaku.hotDict) || [];
        const lower = text.toLowerCase();
        for (const w of dict) {
          const lw = String(w).toLowerCase();
          if (!lw) continue;
          let idx = lower.indexOf(lw);
          while (idx !== -1) {
            dm.hot.set(w, (dm.hot.get(w) || 0) + 1);
            idx = lower.indexOf(lw, idx + lw.length);
          }
        }
        for (const w of POS_WORDS) if (text.indexOf(w) >= 0) { dm.pos++; break; }
        for (const w of NEG_WORDS) if (text.indexOf(w) >= 0) { dm.neg++; break; }
        for (const w of MILESTONE_WORDS) {
          if (text.indexOf(w) >= 0) {
            dm.milestones.unshift({ tag: w, text: text.slice(0, 40), time: Date.now() });
            if (dm.milestones.length > 60) dm.milestones.pop();
            break;
          }
        }
        renderSocial();
      },
      (st) => {
        if (st === 'live') {
          dm.status = 'live';
          dm.statusText = '已连通';
        } else if (st === 'connecting') {
          dm.status = 'connecting';
        } else if (st === 'failed') {
          dm.status = 'failed';
          dm.statusText =
            'B 站握手被风控拦截（getDanmuInfo 返回 -352），匿名握手也被服务端关闭 —— 实时弹幕不可用';
        } else if (st === 'closed' || st === 'error') {
          dm.status = 'failed';
          dm.statusText = '弹幕连接被服务端关闭（可能触发风控）';
        }
        renderSocial();
      }
    );
    dm.client = client;
    client.start();
    // 15 秒还没收到任何弹幕 → 判定不可用，如实降级
    setTimeout(() => {
      if (dm.status !== 'live' && dm.client && dm.client.received === 0) {
        dm.status = 'failed';
        dm.statusText =
          '实时弹幕握手未成功' +
          (dm.client.tokenState ? '（握手状态：' + dm.client.tokenState + '）' : '') +
          ' —— 已降级为历史弹幕基线';
        try { dm.client.stop(); } catch (e) {}
        renderSocial();
      }
    }, 15000);
  }

  /* ================================================================= *
   * 10. 比分轮询与渲染
   * ================================================================= */
  /**
   * 比分源选择：**取"更先进的那个"，而不是固定优先级。**
   *
   * 为什么不能固定优先级：腾讯静态表在局末就会更新（实测 04:35 → 1:0），
   * 而 CI 烘焙的快照要等下一轮 CI（最多 20 分钟）。若固定「快照优先」，
   * 下一局结束到下一轮 CI 之间，页面会**停在旧比分** —— 对跟赛页是实质缺陷。
   *
   * 判据：BO5 的系列比分只增不减，所以「已打小局数多」= 更先进。
   * 平手时优先站内快照（它是站点的规范数据源，且带完整场次上下文）。
   */
  function pickScoreSource(snap, tx) {
    const hasSnap = !!(snap && (snap.a > 0 || snap.b > 0));
    const hasTx = !!(tx && tx.a !== null && tx.b !== null && (tx.a > 0 || tx.b > 0));
    if (hasSnap && hasTx) {
      const sg = snap.a + snap.b;
      const tg = tx.a + tx.b;
      if (tg > sg) return 'tencent';
      if (sg > tg) return 'snapshot';
      return 'snapshot'; // 平手：优先站内快照
    }
    if (hasSnap) return 'snapshot';
    if (hasTx) return 'tencent';
    return 'none';
  }

  /**
   * 比分刷新：来源优先级（高 → 低）
   *   1. manual   —— 用户手动指定（最高优先级，会覆盖一切）
   *   2. snapshot —— CI 每 20 分钟烘焙的赛程快照
   *   3. tencent  —— 腾讯官方记分牌（局末即更新，可能比快照更先进）
   *   4. none     —— 都拿不到 → 明说「未获取」，绝不编造
   */
  async function refreshScore() {
    const m = STATE.finalMatch;
    if (!m) return;
    const manual = readManual();
    const snap = parseScore(m.score);
    const tx = await fetchTencentScoreboard(m).catch(() => null);
    if (tx) {
      STATE.tencentStatus = tx.status || '';
      const txTime = tx.lastUpTime || '';
      const ageMin = txTime ? Math.round((Date.now() - new Date(String(txTime).replace(/-/g, '/')).getTime()) / 60000) : null;
      STATE.tencentFresh = ageMin !== null && ageMin <= 90;
      STATE.tencentUpdatedAt = txTime;
    }
    const txScore = tx && tx.a !== null && tx.b !== null ? { a: tx.a, b: tx.b } : null;
    const snapAgeMin = STATE.scheduleUpdatedAt
      ? Math.round((Date.now() - new Date(String(STATE.scheduleUpdatedAt).replace(/-/g, '/')).getTime()) / 60000)
      : null;
    const snapFresh = snapAgeMin !== null && snapAgeMin <= 40;

    if (manual) {
      setScore(manual.a, manual.b, 'manual', '手动指定', '本机设置', true, '');
    } else {
      const pick = pickScoreSource(snap, txScore);
      if (pick === 'snapshot') {
        setScore(snap.a, snap.b, 'snapshot', '站内赛程快照（CI 每 20 分钟刷新）', STATE.scheduleUpdatedAt, snapFresh, '');
      } else if (pick === 'tencent') {
        setScore(txScore.a, txScore.b, 'tencent', '腾讯官方赛事记分牌', STATE.tencentUpdatedAt, STATE.tencentFresh, '');
      } else if (txScore && txScore.a !== null && txScore.b !== null) {
        // 两边都是 0:0（或只有一个 0:0 的源）→ 如实显示并说明「尚未刷新」
        setScore(
          txScore.a,
          txScore.b,
          'tencent',
          '腾讯官方赛事记分牌',
          STATE.tencentUpdatedAt,
          STATE.tencentFresh,
          '腾讯记分牌最后更新于 ' + (STATE.tencentUpdatedAt || '未知') + '，尚未刷新本场比分'
        );
      } else {
        setScore(null, null, 'none', '未获取到比分', '', false, '');
      }
    }
    renderScoreboard();
    renderProb();
    renderInsight();
  }

  /* ================================================================= *
   * 11. 启动
   * ================================================================= */
  /**
   * 用烘焙基线先算一版**临时模型**（纯本地文件，秒出）。
   * 目的：远端赛程要几秒到几十秒才回来，这段时间里胜率条不该是空的。
   * 基线与运行时用的是同一套公式、同一份数据口径（都排除本场），
   * 所以临时值与最终值一致；远端数据到了会覆盖它。
   */
  function modelFromBaseline(b) {
    if (!b || !b.match || !b.teams || !b.model) return null;
    const tA = b.teams[b.match.teamA];
    const tB = b.teams[b.match.teamB];
    if (!tA || !tB) return null;
    const gA = tA.bo5 || {};
    const gB = tB.bo5 || {};
    const rA = (gA.gamesW + 1) / (gA.gamesW + gA.gamesL + 2);
    const rB = (gB.gamesW + 1) / (gB.gamesW + gB.gamesL + 2);
    const p = rA / (rA + rB);
    return {
      p: p,
      q: 1 - p,
      prior: b.model.prior,
      rA: rA,
      rB: rB,
      nameA: b.match.teamA,
      nameB: b.match.teamB,
      provisional: true,
      steps: b.model.derivation || [],
    };
  }

  async function boot() {
    // 基线（模型兜底 + 舆情基线）
    try {
      const b = await fetchJson('data/final-baseline.json', 8000);
      if (b) {
        STATE.baselines = b;
        // 先用基线出一版临时模型 → 首屏立刻有胜率，不等远端
        const provisional = modelFromBaseline(b);
        if (provisional) {
          STATE.model = provisional;
          STATE.finalMatch = {
            game: b.match.tournament,
            phase: b.match.phase,
            mode: b.match.mode,
            date: b.match.date,
            place: b.match.place,
            teamA: b.match.teamA,
            teamB: b.match.teamB,
            score: b.match.score,
            teamIdA: '',
            teamIdB: '',
          };
          STATE.statsA = {
            series: b.teams[b.match.teamA].series,
            games: b.teams[b.match.teamA].games,
            bo5: b.teams[b.match.teamA].bo5,
            lastMatch: b.teams[b.match.teamA].lastMatch,
          };
          STATE.statsB = {
            series: b.teams[b.match.teamB].series,
            games: b.teams[b.match.teamB].games,
            bo5: b.teams[b.match.teamB].bo5,
            lastMatch: b.teams[b.match.teamB].lastMatch,
          };
          renderScoreboard();
          renderCompare();
          renderProb();
          renderInsight();
        }
      }
    } catch (e) {}

    // 赛程
    const sched = await loadSchedule();
    if (!sched) {
      $('sb-meta').textContent = '赛程数据加载失败（远端与本地快照都不可达）';
      $('sb-state-text').textContent = '数据不可用';
      return;
    }
    STATE.matches = sched.json.matches || [];
    STATE.scheduleUpdatedAt = sched.updatedAt || sched.json.updatedAt || '';
    STATE.scheduleOrigin = sched.origin;

    const fm = findFinalMatch(STATE.matches);
    if (!fm) {
      $('sb-meta').textContent = '赛程数据里找不到可跟赛的场次';
      return;
    }
    STATE.finalMatch = fm;
    const tournament = fm.game;
    // 关键：模型输入排除本场（否则循环论证）
    STATE.statsA = teamStats(STATE.matches, tournament, fm.teamA, fm);
    STATE.statsB = teamStats(STATE.matches, tournament, fm.teamB, fm);
    STATE.model = buildModel(STATE.matches, fm, STATE.statsA, STATE.statsB);

    renderScoreboard();
    renderCompare();
    renderInsight();
    await refreshScore();

    // 队徽（异步补，不阻塞首屏）
    // ⚠️ 腾讯 TeamList 里 GEN 的 TeamShortName 是**空字符串**（实测），
    //    所以要同时按 TeamName / TeamShortName / TeamId 建索引，否则 GEN 队徽出不来。
    loadGlobalScript('https://lpl.qq.com/web201612/data/LOL_MATCH2_TEAM_LIST.js', 'TeamList')
      .then((tl) => {
        if (!tl || !tl.msg) return;
        for (const k in tl.msg) {
          const t = tl.msg[k];
          if (!t) continue;
          const logo = String(t.TeamLogo || '');
          const url = logo.indexOf('//') === 0 ? 'https:' + logo : logo;
          if (!url) continue;
          if (t.TeamShortName) STATE.teamLogos[t.TeamShortName] = url;
          if (t.TeamName) STATE.teamLogos[t.TeamName] = url;
          if (t.TeamId) STATE.teamLogos[String(t.TeamId)] = url;
        }
        renderScoreboard();
      })
      .catch(() => {});

    loadStream();
    renderSocial();
    startDanmaku();

    // 轮询比分（60 秒）
    setInterval(() => {
      refreshScore().catch(() => {});
    }, 60000);

    // 交互
    $('btn-refresh').addEventListener('click', async () => {
      toast('正在刷新比分…');
      await refreshScore();
      toast('已刷新');
    });
    $('btn-manual').addEventListener('click', () => {
      const box = $('sb-manual');
      box.hidden = !box.hidden;
      if (!box.hidden) {
        const man = readManual();
        if (man) {
          $('in-a').value = man.a;
          $('in-b').value = man.b;
        }
      }
    });
    $('btn-apply').addEventListener('click', async () => {
      const a = Math.max(0, Math.min(3, parseInt($('in-a').value, 10) || 0));
      const b = Math.max(0, Math.min(3, parseInt($('in-b').value, 10) || 0));
      writeManual({ a: a, b: b });
      await refreshScore();
      toast('已应用手动比分 ' + a + ':' + b);
    });
    $('btn-clear').addEventListener('click', async () => {
      writeManual(null);
      await refreshScore();
      toast('已清除手动比分');
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();

  // 供验收脚本调用
  window.__LPLTV_MATCH__ = {
    state: STATE,
    score: SCORE,
    seriesWinProb: seriesWinProb,
    buildModel: buildModel,
    teamStats: teamStats,
    hasAbuse: hasAbuse,
    refreshScore: refreshScore,
    pickScoreSource: pickScoreSource,
  };
})();
