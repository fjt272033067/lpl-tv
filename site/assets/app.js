/* =====================================================================
 * LPL-TV · 主程序
 * 数据源：腾讯 LPL 公开接口（JSONP / 静态 JS）+ B 站公开弹幕数据
 * ===================================================================== */
(function () {
  'use strict';

  /* ------------------------------------------------------------------ *
   * 0. 基础工具
   * ------------------------------------------------------------------ */
  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));

  // B 站风控返回的是裸 JSON（不是 JSONP 包装），作为脚本执行会抛 SyntaxError。
  // 这里把该来源的报错静默掉，避免污染控制台。
  window.addEventListener(
    'error',
    (e) => {
      if (e.filename && /getDanmuInfo/.test(e.filename)) e.preventDefault();
    },
    true
  );

  function el(tag, attrs, children) {
    const node = document.createElement(tag);
    if (attrs) {
      for (const k in attrs) {
        const v = attrs[k];
        if (v === null || v === undefined || v === false) continue;
        if (k === 'class') node.className = v;
        else if (k === 'text') node.textContent = v;
        else if (k === 'html') node.innerHTML = v;
        else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
        else if (k === 'style' && typeof v === 'object') Object.assign(node.style, v);
        else node.setAttribute(k, v);
      }
    }
    (Array.isArray(children) ? children : children ? [children] : []).forEach((c) => {
      if (c === null || c === undefined || c === false) return;
      node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    });
    return node;
  }

  const svg = (d, size, extra) =>
    `<svg viewBox="0 0 24 24" width="${size || 20}" height="${size || 20}" fill="none"
      stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"
      ${extra || ''}>${d}</svg>`;

  const ICON = {
    play: svg('<path d="M8 5.5v13l11-6.5z" fill="currentColor" stroke="none"/>'),
    pause: svg('<rect x="7" y="5" width="3.4" height="14" rx="1" fill="currentColor" stroke="none"/><rect x="13.6" y="5" width="3.4" height="14" rx="1" fill="currentColor" stroke="none"/>'),
    volume: svg('<path d="M4 9.5h3L11 6v12L7 14.5H4z" fill="currentColor" stroke="none"/><path d="M15.5 9a4 4 0 0 1 0 6"/><path d="M18 6.5a7.5 7.5 0 0 1 0 11"/>'),
    mute: svg('<path d="M4 9.5h3L11 6v12L7 14.5H4z" fill="currentColor" stroke="none"/><path d="M16 9.5l5 5m0-5l-5 5"/>'),
    full: svg('<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>'),
    live: svg('<circle cx="12" cy="12" r="3.4" fill="currentColor" stroke="none"/><path d="M7.8 7.8a6 6 0 0 0 0 8.4M16.2 16.2a6 6 0 0 0 0-8.4M5 5a10 10 0 0 0 0 14M19 19a10 10 0 0 0 0-14"/>'),
    danmaku: svg('<rect x="3" y="5" width="18" height="14" rx="3"/><path d="M7 10h7M7 14h4"/>'),
    back: svg('<path d="M15 6l-6 6 6 6"/>'),
    clock: svg('<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>'),
  };

  let toastTimer = null;
  function toast(msg) {
    let t = $('#toast');
    if (!t) {
      t = el('div', { id: 'toast', class: 'toast' });
      document.body.appendChild(t);
    }
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), 2600);
  }

  const fmtTime = (sec) => {
    if (!isFinite(sec) || sec < 0) sec = 0;
    const s = Math.floor(sec % 60);
    const m = Math.floor((sec / 60) % 60);
    const h = Math.floor(sec / 3600);
    const p = (n) => String(n).padStart(2, '0');
    return h > 0 ? `${h}:${p(m)}:${p(s)}` : `${m}:${p(s)}`;
  };

  const fmtDur = (sec) => {
    if (!sec) return '';
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = Math.floor(sec % 60);
    return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
  };

  /** JSONP：跨域取 JSON，无需 CORS 头 */
  let jsonpSeq = 0;
  function jsonp(url, params, opts) {
    opts = opts || {};
    return new Promise((resolve, reject) => {
      const cb = '__lpltv_' + ++jsonpSeq + '_' + Date.now().toString(36);
      const script = document.createElement('script');
      const merged = Object.assign({}, params, { callback: cb });
      const qs = Object.keys(merged)
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
        // 超时后不能 delete window[cb] —— 脚本可能刚好在超时后到达，
        // 此时回调已被删，脚本执行就会抛 "<cb> is not defined"。
        // 改成留一个空函数，等脚本自然过期后再回收。
        try {
          window[cb] = function () {};
          setTimeout(() => {
            try { delete window[cb]; } catch (e) {}
          }, 300000);
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
      script.src = url + (url.indexOf('?') > -1 ? '&' : '?') + qs;
      document.head.appendChild(script);
    });
  }

  /** 跨域加载腾讯的静态 JS 数据文件（作为全局变量注入，无需 CORS） */
  const loadedGlobals = new Map();
  function loadGlobalScript(src, globalName, fresh) {
    if (!fresh && loadedGlobals.has(src)) return loadedGlobals.get(src);
    const p = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.async = true;
      s.src = src + (src.indexOf('?') > -1 ? '&' : '?') + '_=' + Date.now();
      s.onload = () => resolve(window[globalName]);
      s.onerror = () => reject(new Error('加载 ' + src + ' 失败'));
      document.head.appendChild(s);
    });
    loadedGlobals.set(src, p);
    return p;
  }

  /* ------------------------------------------------------------------ *
   * 1. 接口封装
   * ------------------------------------------------------------------ */
  const API = {
    /** 腾讯直播（JSONP） */
    live: () =>
      jsonp('https://lol.sw.game.qq.com/lol/commact/', {
        proj: 'a20200415livelink',
        c: 'a20200415livelink',
        a: 'getMatchScheduleList',
      }),

    /** 腾讯点播信息（JSONP）；defn = hd | shd | fhd */
    vod: (vid, defn) =>
      jsonp(
        'https://vv.video.qq.com/getinfo',
        {
          otype: 'json',
          platform: '101001',
          charge: '0',
          ehost: 'https://vsports.qq.com',
          vid: vid,
          defn: defn || 'shd',
        },
        // 腾讯生成 vkey 偶尔很慢，12 秒不够（实测会偶发超时导致播放页黑屏）
        { timeout: 28000 }
      ),
  };

  const LIVE_BMATCH_JS = 'https://lpl.qq.com/web201612/data/LOL_MATCH2_LIVE_BMATCH_LIST.js';
  const LIVING_GAMES_JS = 'https://lpl.qq.com/web201612/data/LOL_NEWMATCH_LIVE_PAGE_LIVING_GAMES.js';
  const TEAM_LIST_JS = 'https://lpl.qq.com/web201612/data/LOL_MATCH2_TEAM_LIST.js';
  // 腾讯官方「赛事进度」页 —— 快照陈旧时的权威出口
  const OFFICIAL_SCHEDULE_URL = 'https://lpl.qq.com/web202301/event.html?tabId=schedule&gameId=246';
  // 英雄联盟赛事官方账号的最新内容（var authorid = {...}，可用 <script> 跨域加载，无需 CORS）
  const OFFICIAL_FEED_JS =
    'https://apps.game.qq.com/cmc/zmMcnAuthorContentList?type=1&page=1&num=40&r1=authorid&authorid=288&source=web_pc';

  /* ------------------------------------------------------------------ *
   * 远端数据源（可选，默认关闭）
   * ------------------------------------------------------------------ *
   * 赛程 / 录像目录 / 直播源这三份数据是构建期烘焙的 —— 腾讯的全量对阵表是裸 JSON
   * 且没有跨域头，B 站的直播流地址接口同样不给 ACAO、JSONP 又会被 ORB 拦死，
   * 浏览器运行时都读不到。所以本地快照必然会随时间变旧。
   *
   * 这里开一个口子：如果配置了远端基址（CI 每次重建后把 site/data 提交到公开仓库，
   * 由 raw.githubusercontent.com / jsDelivr 这类带 ACAO 的静态托管提供），站点就把
   * 本地与远端两份都读回来，**按 updatedAt 取更新的那份**。于是：
   *   · 数据更新只需要更新 JSON 文件，**不必重新部署站点**；
   *   · 远端挂了自动回退本地快照，站点不会因为外部依赖而打不开；
   *   · 站点本身依然是纯静态、零后端。
   *
   * 配置方式：index.html 里的 <meta name="lpl-tv-data-base" content="…">，
   * 或运行时设置 window.__LPLTV_DATA_BASE__（测试用）。留空 = 只用本地快照。
   */
  function readDataBase() {
    try {
      const w = window.__LPLTV_DATA_BASE__;
      if (typeof w === 'string' && w.trim()) return w.trim().replace(/\/+$/, '');
    } catch (e) {
      /* 非浏览器环境 */
    }
    const m = document.querySelector('meta[name="lpl-tv-data-base"]');
    const v = m ? (m.getAttribute('content') || '').trim() : '';
    return v.replace(/\/+$/, '');
  }
  const REMOTE_DATA_BASE = readDataBase();

  /** 带超时的 JSON 抓取：远端不可用时返回 null，绝不拖慢首屏、也不抛错 */
  async function fetchJson(url, timeoutMs) {
    if (!timeoutMs) {
      try {
        const r = await fetch(url, { cache: 'no-cache' });
        return r.ok ? await r.json() : null;
      } catch (e) {
        return null;
      }
    }
    const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = ctrl ? setTimeout(() => ctrl.abort(), timeoutMs) : null;
    try {
      const r = await fetch(url, { cache: 'no-cache', signal: ctrl ? ctrl.signal : undefined });
      return r.ok ? await r.json() : null;
    } catch (e) {
      return null;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  /** 两份数据取更新的那份（updatedAt 大的优先） */
  function pickNewer(local, remote) {
    if (!remote) return local;
    if (!local) return remote;
    const lt = Date.parse(local.updatedAt || '') || 0;
    const rt = Date.parse(remote.updatedAt || '') || 0;
    return rt > lt ? remote : local;
  }

  /**
   * 读取一份数据（本地 / 远端取内容更新的那份）。
   *
   * ⚠️ 铁律：**远端绝不能挡住首屏**。
   * 远端是「增强」不是「依赖」：本地快照永远先渲染，远端在后台探测，
   * 拿到更新的数据后再自动升级（直播页会重绘）。
   *
   * 为什么这么讲究：远端探测带超时，而超时靠 setTimeout 实现 ——
   * 页面在后台标签里时 Chrome 会节流定时器，超时可能迟迟不触发，
   * 于是那个 Promise 永远不 resolve，整页卡在「正在加载…」。
   * （这个坑真的踩过：验收里新开的标签页全部空白，本地页却正常。）
   *
   * 版本信息 version.json（很小）记着：
   *   · updatedAt      —— 「上次核对上游的时间」，用于判断数据新不新；
   *   · files[名字]     —— 每份数据「内容最后变化的时间」。
   * 远端版本信息缓存在 sessionStorage 里（5 分钟），避免每次加载都去探测。
   */
  const REMOTE_VER_KEY = 'lpltv-remote-ver';
  const REMOTE_VER_TTL = 5 * 60 * 1000;
  /** 后台探测到更新的远端数据时的回调（页面注册，用来自动重绘） */
  let remoteUpgradeHook = null;
  let remoteProbeInFlight = false;
  function onRemoteUpgrade(fn) {
    remoteUpgradeHook = fn;
    return () => {
      if (remoteUpgradeHook === fn) remoteUpgradeHook = null;
    };
  }
  function readRemoteVer(base) {
    try {
      const c = JSON.parse(sessionStorage.getItem(REMOTE_VER_KEY) || 'null');
      if (!c || c.base !== base || !c.ts) return null;
      if (Date.now() - c.ts > REMOTE_VER_TTL) return null;
      return c;
    } catch (e) {
      return null;
    }
  }
  function writeRemoteVer(base, ver, failed) {
    try {
      sessionStorage.setItem(
        REMOTE_VER_KEY,
        JSON.stringify({
          base,
          ts: Date.now(),
          updatedAt: (ver && ver.updatedAt) || '',
          files: (ver && ver.files) || null,
          failed: !!failed,
        })
      );
    } catch (e) {
      /* 隐私模式下 sessionStorage 不可用，忽略 */
    }
  }

  async function loadDataFile(name, force) {
    const bust = force ? '?t=' + Date.now() : '';
    const localVer = await fetchJson('data/version.json' + bust, 0);
    let remoteVer = null;
    if (REMOTE_DATA_BASE) {
      const cached = readRemoteVer(REMOTE_DATA_BASE);
      if (cached) {
        // 已经有探测结果：直接用，不发请求
        remoteVer = cached.failed ? null : { updatedAt: cached.updatedAt, files: cached.files };
      } else {
        // 首次探测：放后台跑，**不 await** —— 首屏不能等它
        if (!remoteProbeInFlight) {
          remoteProbeInFlight = true;
          fetchJson(REMOTE_DATA_BASE + '/version.json' + bust, 4000).then((v) => {
            remoteProbeInFlight = false;
            writeRemoteVer(REMOTE_DATA_BASE, v, !v);
            if (v && remoteUpgradeHook && Date.parse(v.updatedAt || '') > Date.parse(localVer?.updatedAt || '')) {
              remoteUpgradeHook(v);
            }
          });
        }
      }
    }
    const ver = pickNewer(localVer, remoteVer); // 「刷新时间」取新的那份
    const lv = localVer && localVer.files ? localVer.files[name] : '';
    const rv = remoteVer && remoteVer.files ? remoteVer.files[name] : '';

    if (lv && rv && Date.parse(rv) > Date.parse(lv)) {
      // 远端内容更新 → 取远端（内容时间戳拼进 URL 当缓存键：内容没变就命中缓存）
      const j = await fetchJson(REMOTE_DATA_BASE + '/' + name + '.json?v=' + encodeURIComponent(rv), 8000);
      if (j) return { json: j, origin: 'remote', ver };
    }
    // 其余情况一律用本地（远端不可用 / 内容不比本地新 / 还没探测出远端版本）
    const local = await fetchJson('data/' + name + '.json' + bust, 0);
    if (local) return { json: local, origin: 'local', ver };
    // 本地也没有 → 最后才试远端
    if (REMOTE_DATA_BASE) {
      const j = await fetchJson(REMOTE_DATA_BASE + '/' + name + '.json' + bust, 8000);
      if (j) return { json: j, origin: 'remote', ver };
    }
    return { json: null, origin: 'local', ver };
  }

  /* 运行时数据：队伍 logo 与简称（按简称 / ID 双索引） */
  let teamLogos = null;
  let teamById = null;
  async function ensureTeamLogos() {
    if (teamLogos) return teamLogos;
    teamLogos = {};
    teamById = {};
    try {
      const tl = await loadGlobalScript(TEAM_LIST_JS, 'TeamList');
      const teams = (tl && tl.msg) || {};
      Object.keys(teams).forEach((k) => {
        const t = teams[k];
        const logo = t.TeamLogo || t.TeamLogoDeep;
        const url = logo
          ? logo.indexOf('//') === 0
            ? 'https:' + logo
            : logo
          : '';
        const short = (t.TeamShortName || '').toUpperCase();
        const name = (t.TeamName || '').toUpperCase();
        if (short) teamLogos[short] = url;
        if (name) teamLogos[name] = url;
        if (k) teamById[String(k)] = { short: short || name, logo: url };
      });
    } catch (e) {
      teamLogos = {};
      teamById = {};
    }
    return teamLogos;
  }

  function teamLogo(name) {
    if (!name || !teamLogos) return '';
    return teamLogos[String(name).toUpperCase()] || '';
  }

  /** 用队伍 ID 兜底解析简称与队徽（腾讯的 TeamShortName 经常为空） */
  function teamByTeamId(id, fallbackName) {
    if (fallbackName) return { name: fallbackName, logo: teamLogo(fallbackName) };
    const t = teamById && teamById[String(id || '')];
    return t ? { name: t.short, logo: t.logo } : { name: '', logo: '' };
  }

  /* 运行时数据：官方账号最新内容（始终最新，script 加载） */
  let officialFeed = null;
  async function ensureOfficialFeed() {
    if (officialFeed) return officialFeed;
    officialFeed = [];
    try {
      const feed = await loadGlobalScript(OFFICIAL_FEED_JS, 'authorid');
      const res = (feed && feed.data && feed.data.result) || [];
      officialFeed = res
        .filter((r) => r.sVID)
        .map((r) => ({
          id: r.sVID,
          title: r.sTitle || '官方内容',
          cover: r.sIMG ? (r.sIMG.indexOf('//') === 0 ? 'https:' + r.sIMG : r.sIMG) : '',
          duration: r.iTime || 0,
          date: r.sCreated || '',
          author: r.sAuthor || '英雄联盟赛事官方',
          desc: r.sDesc || '',
          plays: r.iTotalPlay || 0,
        }));
    } catch (e) {
      officialFeed = [];
    }
    return officialFeed;
  }

  /* 运行时数据：赛事元信息（赛事名 / 起止日期 / 队徽），var 赋值可跨域加载 */
  const EVENT_INFO_JS =
    'https://apps.game.qq.com/lol/match/apis/searchMatchGameInfo.php?r1=gamelist&p1=1';
  let eventInfoList = null;
  async function ensureEventInfo() {
    if (eventInfoList) return eventInfoList;
    eventInfoList = [];
    try {
      const g = await loadGlobalScript(EVENT_INFO_JS, 'gamelist');
      const arr = (g && g.msg) || [];
      eventInfoList = arr
        .filter((x) => x && x.GameId)
        .map((x) => ({
          gameId: String(x.GameId),
          name: x.GameName || '',
          enName: x.GameEnName || '',
          start: x.sDate || '',
          end: x.eDate || '',
          logo: x.GameLogo ? (x.GameLogo.indexOf('//') === 0 ? 'https:' + x.GameLogo : x.GameLogo) : '',
        }));
    } catch (e) {
      eventInfoList = [];
    }
    return eventInfoList;
  }

  /** 快照时间戳 → 本地 "10-29 04:54" */
  function fmtSnapshotTime(iso) {
    if (!iso) return '—';
    const t = Date.parse(iso);
    if (!isFinite(t)) return String(iso).replace('T', ' ').slice(0, 16);
    const d = new Date(t);
    return (
      d.getFullYear() +
      '-' +
      String(d.getMonth() + 1).padStart(2, '0') +
      '-' +
      String(d.getDate()).padStart(2, '0') +
      ' ' +
      String(d.getHours()).padStart(2, '0') +
      ':' +
      String(d.getMinutes()).padStart(2, '0')
    );
  }

  /** 从赛事元信息里挑出「当前正在进行的那个赛事」 */
  function pickCurrentEvent(evInfos, list) {
    if (!evInfos || !evInfos.length) return null;
    const names = new Set((list || []).map((m) => m.game));
    const today = new Date();
    const todayKey =
      today.getFullYear() +
      '-' +
      String(today.getMonth() + 1).padStart(2, '0') +
      '-' +
      String(today.getDate()).padStart(2, '0');
    // 优先：赛程里出现过的、且日期区间覆盖今天的
    const inList = evInfos.filter((e) => names.has(e.name));
    const pool = inList.length ? inList : evInfos;
    const covering = pool.filter((e) => e.start && e.end && e.start <= todayKey && e.end >= todayKey);
    if (covering.length) return covering[covering.length - 1];
    // 其次：结束日期还没到的最后一个
    const upcoming = pool.filter((e) => !e.end || e.end >= todayKey);
    return upcoming.length ? upcoming[upcoming.length - 1] : pool[pool.length - 1];
  }

  /**
   * 赛程快照新鲜度。
   *
   * 为什么需要它：腾讯的全量对阵表（BMATCH_LIST / PROCDATA）都是裸 JSON 且没有
   * CORS 头，浏览器运行时读不到 —— 只能构建期抓一份快照。所以站内必须如实
   * 告诉用户这份快照有多新，否则就会出现「已淘汰的队伍还挂在后续赛程里」。
   *
   * 判定为「陈旧」的两条依据（任一成立即陈旧）：
   *   1. 快照比现在老了 24 小时以上；
   *   2. 快照里有「开打超过 2 小时却仍是 0:0」的比赛 —— 说明这场的结果它根本没见过。
   *
   * 注意第 2 条的方向：只有**已经开打**且仍无比分的场次才算漏赛果；尚未开打的
   * 场次（0:0 是正常的，包括「总决赛」「D8G1」这类还没定对阵的占位行）不能算，
   * 否则一份新鲜快照会被自己的未来赛程判成陈旧。
   */
  function scheduleFreshness(meta, list) {
    // 「刷新时间」优先用 version.json 的 updatedAt（上次从上游核对的时间）；
    // 老产物没有版本文件时退回 schedule.json 自己的 updatedAt。
    const iso = (meta && (meta.refreshedAt || meta.updatedAt)) || '';
    const ts = Date.parse(iso);
    const ageH = isFinite(ts) ? (Date.now() - ts) / 3600000 : NaN;
    let missed = 0;
    const now = Date.now();
    (list || []).forEach((m) => {
      if (!m.date) return;
      const mt = new Date(String(m.date).replace(/-/g, '/')).getTime();
      if (!isFinite(mt)) return;
      if (mt + 2 * 3600000 >= now) return; // 还没开打 / 刚开始：0:0 是正常的
      const sc = String(m.score == null ? '0:0' : m.score).replace(/\s+/g, '');
      if (sc === '' || sc === '0:0') missed++; // 开打超过 2 小时却没比分 → 快照没见过这场结果
    });
    const stale = !isFinite(ageH) || ageH > 24 || missed > 0;
    let ageLabel = '未知';
    if (isFinite(ageH)) {
      if (ageH < 1) ageLabel = Math.max(1, Math.round(ageH * 60)) + ' 分钟前';
      else if (ageH < 48) ageLabel = Math.round(ageH) + ' 小时前';
      else ageLabel = Math.round(ageH / 24) + ' 天前';
    }
    return { ageH, ageLabel, missed, stale, updatedAt: iso };
  }

  /**
   * 从腾讯 LiveBMatchList 里递归找直播地址。
   * 这个文件是 `var LiveBMatchList = {...}` 形式，可用 <script> 跨域加载
   * （不需要 CORS），所以是唯一「赛事进行时能站内实时拿到腾讯直播源」的通道。
   * 休赛时它的 msg 值是空字符串；开赛时会带上直播流信息。
   */
  function extractStreamsFromLiveBMatch(liveBMatch) {
    const out = [];
    const seen = new Set();
    const visit = (v, depth) => {
      if (v === null || v === undefined || depth > 5) return;
      if (typeof v === 'string') {
        const re = /https?:\/\/[^"'\s\\]+\.(?:m3u8|flv)(?:\?[^"'\s\\]*)?/g;
        let m;
        while ((m = re.exec(v)) !== null) {
          if (seen.has(m[0])) continue;
          seen.add(m[0]);
          out.push({ url: m[0], hls: /\.m3u8/.test(m[0]) ? m[0] : '', flv: /\.flv/.test(m[0]) ? m[0] : '' });
        }
        return;
      }
      if (Array.isArray(v)) {
        v.forEach((x) => visit(x, depth + 1));
        return;
      }
      if (typeof v === 'object') {
        Object.keys(v).forEach((k) => {
          if (/hls|flv|stream|url|play/i.test(k)) visit(v[k], depth + 1);
        });
      }
    };
    if (liveBMatch && typeof liveBMatch === 'object') visit(liveBMatch.msg || liveBMatch, 0);
    return out;
  }

  /** 把腾讯直播接口数据整理成统一结构 */
  function normalizeLive(raw) {
    const list = (raw && raw.data && raw.data.anchorList) || [];
    return list
      .map((a) => {
        const gp = (a.extInfo && a.extInfo.gameProgram) || '{}';
        let prog = {};
        try { prog = JSON.parse(gp); } catch (e) { prog = {}; }
        const streams = ((a.playInfo && a.playInfo.streamInfo) || [])
          .filter((s) => s.hlsUrl)
          .map((s) => ({
            name: s.desc || s.bitrate + 'k',
            bitrate: s.bitrate,
            hls: s.hlsUrl.replace(/^http:/, 'https:'),
            flv: s.flvUrl,
          }))
          .sort((a, b) => b.bitrate - a.bitrate);
        return {
          anchorId: String(a.anchorInfo && a.anchorInfo.anchorId),
          title: (a.roomInfo && a.roomInfo.roomTitle) || '直播',
          detail: (a.roomInfo && a.roomInfo.roomDetail) || '',
          icon: (a.roomInfo && a.roomInfo.roomIcon) || '',
          viewers: (a.roomInfo && a.roomInfo.viewers) || 0,
          subtitle: prog.subTitle || '',
          barrage: !!prog.barrageSwitch,
          official: prog.streamSrc === 'official_stream',
          memo: prog.memoContent || '',
          streams,
        };
      })
      .filter((x) => x.streams.length);
  }

  /** 点播接口 → 可播放地址 */
  function normalizeVod(raw, defn) {
    const vi = raw && raw.vl && raw.vl.vi && raw.vl.vi[0];
    if (!vi) throw new Error((raw && raw.msg) || '未找到该视频的可播放地址');
    const ui = (vi.ul && vi.ul.ui) || [];
    const base = (ui.find((u) => u.vt === 503) || ui[0] || {}).url || '';
    if (!base) throw new Error('点播接口未返回播放地址');
    const url = base.replace(/^http:/, 'https:') + vi.fn + '?vkey=' + vi.fvkey;
    return {
      url,
      width: vi.vw,
      height: vi.vh,
      duration: Math.round(parseFloat(vi.td) || 0),
      title: vi.ti || '',
      cover: vi.sshot ? '' : '',
      defn,
    };
  }

  /* ------------------------------------------------------------------ *
   * 2. 播放器
   * ------------------------------------------------------------------ */
  const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 3];
  /** 当前页面持有的播放器实例：路由切换时必须销毁，否则 hls/flv 会继续在后台拉流 */
  let activePlayer = null;

  class Player {
    /**
     * @param {HTMLElement} host
     * @param {Object} opts {mode:'live'|'vod', title, onQuality, onSpeed, danmakuFile}
     */
    constructor(host, opts) {
      this.host = host;
      this.opts = opts || {};
      this.mode = this.opts.mode || 'vod';
      this.hls = null;
      this.quality = null;
      this.qualities = [];
      this.speed = 1;
      this.dmEnabled = true;
      this.dm = null;
      this._raf = null;
      this._hideTimer = null;
      this._cleanups = [];
      this.build();
    }

    build() {
      const host = this.host;
      host.classList.add('player');
      host.innerHTML = '';

      this.video = el('video', { playsinline: '', preload: 'auto', crossorigin: 'anonymous' });
      this.video.setAttribute('playsinline', '');
      if (this.mode === 'live') this.video.muted = false;

      this.dmLayer = el('div', { class: 'dm-layer' });

      this.bigPlay = el('button', { class: 'big-play', 'aria-label': '播放', html: ICON.play });

      this.msg = el('div', { class: 'player-msg', style: { display: 'none' } });

      this.top = el('div', { class: 'player-top' });
      this.tags = el('div', { class: 'tags' });
      this.top.appendChild(this.tags);

      this.ctrl = el('div', { class: 'ctrl' });
      this.buildControls();

      host.appendChild(this.video);
      host.appendChild(this.dmLayer);
      host.appendChild(this.top);
      host.appendChild(el('div', { class: 'player-center' }, this.bigPlay));
      host.appendChild(this.msg);
      host.appendChild(this.ctrl);

      this.bind();
    }

    buildControls() {
      const c = this.ctrl;
      c.innerHTML = '';

      // 进度条
      this.progWrap = el('div', { class: 'ctrl-progress' });
      this.progTrack = el('div', { class: 'ctrl-track' });
      this.progBuffer = el('div', { class: 'ctrl-buffer' });
      this.progPlayed = el('div', { class: 'ctrl-played' });
      this.progKnob = el('div', { class: 'ctrl-knob' });
      this.progEdge = el('div', { class: 'ctrl-live-edge' });
      this.progTrack.appendChild(this.progBuffer);
      this.progTrack.appendChild(this.progPlayed);
      this.progTrack.appendChild(this.progKnob);
      this.progTrack.appendChild(this.progEdge);
      this.progWrap.appendChild(this.progTrack);
      c.appendChild(this.progWrap);

      const row = el('div', { class: 'ctrl-row' });
      this.btnPlay = el('button', { class: 'ctrl-btn', 'aria-label': '播放/暂停', html: ICON.play });
      this.btnMute = el('button', { class: 'ctrl-btn', 'aria-label': '静音', html: ICON.volume });
      this.timeEl = el('span', { class: 'ctrl-time', text: this.mode === 'live' ? '直播中' : '00:00 / 00:00' });
      row.appendChild(this.btnPlay);
      row.appendChild(this.btnMute);
      row.appendChild(this.timeEl);

      const vol = el('div', { class: 'ctrl-vol' });
      this.volInput = el('input', { type: 'range', min: '0', max: '1', step: '0.02', value: '1' });
      vol.appendChild(this.volInput);
      row.appendChild(vol);

      row.appendChild(el('span', { class: 'ctrl-spacer' }));

      // 菜单按钮必须带图标：移动端会隐藏 .label 文字，
      // 只有文字的按钮在手机上会变成空白点（清晰度/线路/倍速都受影响）
      this.btnQuality = el('button', {
        class: 'ctrl-btn',
        'data-ctl': 'quality',
        html: '<span class="ico">HD</span><span class="label">清晰度</span>',
      });
      this.btnSource = el('button', {
        class: 'ctrl-btn',
        'data-ctl': 'source',
        html: '<span class="ico">⇄</span><span class="label">线路</span>',
      });
      this.btnSpeed = el('button', {
        class: 'ctrl-btn',
        'data-ctl': 'speed',
        html: '<span class="ico">1×</span><span class="label">倍速</span>',
      });
      this.btnDm = el('button', { class: 'ctrl-btn on', 'data-ctl': 'danmaku', html: ICON.danmaku + '<span class="label">弹幕</span>' });
      this.btnFull = el('button', { class: 'ctrl-btn', 'data-ctl': 'fullscreen', 'aria-label': '全屏', html: ICON.full });
      row.appendChild(this.btnSource);
      row.appendChild(this.btnQuality);
      row.appendChild(this.btnSpeed);
      row.appendChild(this.btnDm);
      row.appendChild(this.btnFull);
      c.appendChild(row);
      // 菜单
      this.menuSource = el('div', { class: 'menu', 'data-menu': 'source' });
      this.menuQuality = el('div', { class: 'menu', 'data-menu': 'quality' });
      this.menuSpeed = el('div', { class: 'menu', 'data-menu': 'speed' });
      this.menuDm = el('div', { class: 'menu', 'data-menu': 'dm' });
      c.appendChild(this.menuSource);
      c.appendChild(this.menuQuality);
      c.appendChild(this.menuSpeed);
      c.appendChild(this.menuDm);
    }

    bind() {
      const v = this.video;

      this.bigPlay.addEventListener('click', () => this.toggle());
      this.btnPlay.addEventListener('click', () => this.toggle());
      this.btnMute.addEventListener('click', () => this.toggleMute());
      this.volInput.addEventListener('input', () => {
        v.volume = parseFloat(this.volInput.value);
        v.muted = v.volume === 0;
        try { localStorage.setItem('lpltv_volume', String(v.volume)); } catch (e) {}
        this.syncMuteIcon();
      });
      this.btnFull.addEventListener('click', () => this.fullscreen());
      // 音量记忆：刷新 / 切页后保留用户设定
      try {
        const saved = localStorage.getItem('lpltv_volume');
        if (saved !== null) {
          const vol = Math.max(0, Math.min(1, parseFloat(saved)));
          v.volume = vol;
          v.muted = vol === 0;
        }
      } catch (e) {}
      this.btnDm.addEventListener('click', (e) => {
        e.stopPropagation();
        this.toggleMenu(this.menuDm);
      });
      this.btnQuality.addEventListener('click', (e) => {
        e.stopPropagation();
        this.toggleMenu(this.menuQuality);
      });
      this.btnSource.addEventListener('click', (e) => {
        e.stopPropagation();
        this.toggleMenu(this.menuSource);
      });
      this.btnSpeed.addEventListener('click', (e) => {
        e.stopPropagation();
        this.toggleMenu(this.menuSpeed);
      });

      document.addEventListener('click', () => this.closeMenus());

      v.addEventListener('play', () => {
        this.btnPlay.innerHTML = ICON.pause;
        this.bigPlay.style.display = 'none';
        this.startLoop();
      });
      v.addEventListener('pause', () => {
        this.btnPlay.innerHTML = ICON.play;
        this.bigPlay.style.display = 'grid';
        this.stopLoop();
      });
      v.addEventListener('volumechange', () => this.syncMuteIcon());
      // 倍速保护：任何外部改动（含 hls.js 的 live sync、媒体重挂载）都要还原成用户选的值
      v.addEventListener('ratechange', () => this.applySpeed());
      ['loadedmetadata', 'canplay', 'play', 'durationchange'].forEach((ev) =>
        v.addEventListener(ev, () => this.applySpeed())
      );
      v.addEventListener('timeupdate', () => this.syncProgress());
      v.addEventListener('progress', () => this.syncBuffer());
      v.addEventListener('waiting', () => this.showMsg('缓冲中…'));
      v.addEventListener('playing', () => this.hideMsg());
      v.addEventListener('error', () => {
        if (this.mode === 'live') this.showMsg('直播流加载失败，正在重试…');
      });
      v.addEventListener('loadedmetadata', () => {
        if (this.mode === 'vod' && this.dm) {
          this.dm.seek(v.currentTime);
          this.dm.setTime(v.currentTime);
        }
        // 直播：把实际解码分辨率回报出去（清晰度徽章要如实显示）
        if (this.opts.onResolved) {
          try { this.opts.onResolved(v.videoWidth, v.videoHeight); } catch (e) {}
        }
      });
      // 拖动进度后重新对齐弹幕游标
      v.addEventListener('seeked', () => {
        if (this.dm) {
          this.dm.seek(v.currentTime);
          this.dm.setTime(v.currentTime);
        }
      });

      // 进度条拖动
      let dragging = false;
      const posToTime = (clientX) => {
        const r = this.progTrack.getBoundingClientRect();
        const p = Math.max(0, Math.min(1, (clientX - r.left) / r.width));
        return p * (v.duration || 0);
      };
      this.progWrap.addEventListener('pointerdown', (e) => {
        if (this.mode === 'live' || !isFinite(v.duration)) return;
        dragging = true;
        this.progWrap.setPointerCapture(e.pointerId);
        this.progKnob.style.transform = 'translate(-50%,-50%) scale(1)';
      });
      this.progWrap.addEventListener('pointermove', (e) => {
        if (!dragging) return;
        const t = posToTime(e.clientX);
        this.progPlayed.style.width = ((t / v.duration) * 100).toFixed(2) + '%';
        this.progKnob.style.left = ((t / v.duration) * 100).toFixed(2) + '%';
      });
      this.progWrap.addEventListener('pointerup', (e) => {
        if (!dragging) return;
        dragging = false;
        v.currentTime = posToTime(e.clientX);
      });

      // 自动隐藏控制条
      ['pointermove', 'pointerdown'].forEach((ev) =>
        this.host.addEventListener(ev, () => this.showUI())
      );
      this.host.addEventListener('pointerleave', () => {
        if (this.mode === 'live' && v.paused) return;
        this.host.classList.remove('show-ui');
      });

      // 键盘快捷键
      this._onKey = (e) => {
        if (!this.host.isConnected) return;
        const tag = (e.target.tagName || '').toLowerCase();
        if (tag === 'input' || tag === 'textarea' || tag === 'select') return;
        switch (e.key) {
          case ' ': case 'k': e.preventDefault(); this.toggle(); break;
          case 'ArrowRight': e.preventDefault(); v.currentTime = Math.min(v.duration || 0, v.currentTime + 10); break;
          case 'ArrowLeft': e.preventDefault(); v.currentTime = Math.max(0, v.currentTime - 10); break;
          case 'ArrowUp': e.preventDefault(); this.setVolume(0.1); break;
          case 'ArrowDown': e.preventDefault(); this.setVolume(-0.1); break;
          case 'm': this.toggleMute(); break;
          case 'f': this.fullscreen(); break;
          case 'd': this.setDanmaku(!this.dmEnabled); break;
          default: break;
        }
      };
      document.addEventListener('keydown', this._onKey);
    }

    showUI() {
      this.host.classList.add('show-ui');
      clearTimeout(this._hideTimer);
      this._hideTimer = setTimeout(() => {
        if (!this.video.paused) this.host.classList.remove('show-ui');
      }, 2600);
    }

    closeMenus() {
      $$('.menu.open', this.ctrl).forEach((m) => m.classList.remove('open'));
    }

    toggleMenu(menu) {
      const wasOpen = menu.classList.contains('open');
      this.closeMenus();
      if (!wasOpen) menu.classList.add('open');
    }

    toggle() {
      const v = this.video;
      if (v.paused) {
        const p = v.play();
        if (p && p.catch) p.catch(() => this.showMsg('浏览器阻止了自动播放，请点击画面后重试'));
      } else v.pause();
    }

    toggleMute() {
      this.video.muted = !this.video.muted;
      this.syncMuteIcon();
    }

    syncMuteIcon() {
      const v = this.video;
      this.btnMute.innerHTML = v.muted || v.volume === 0 ? ICON.mute : ICON.volume;
      if (!v.muted) this.volInput.value = String(v.volume);
    }

    /** 音量增减（键盘 ↑↓ 与菜单共用） */
    setVolume(delta) {
      const v = this.video;
      v.volume = Math.max(0, Math.min(1, v.volume + delta));
      v.muted = v.volume === 0;
      try { localStorage.setItem('lpltv_volume', String(v.volume)); } catch (e) {}
      this.syncMuteIcon();
      toast('音量 ' + Math.round(v.volume * 100) + '%');
    }

    fullscreen() {
      const elx = this.host;
      if (document.fullscreenElement) document.exitFullscreen();
      else if (elx.requestFullscreen) elx.requestFullscreen();
    }

    showMsg(txt, isErr) {
      this.msg.textContent = txt;
      this.msg.classList.toggle('err', !!isErr);
      this.msg.style.display = 'block';
    }

    /** 无信号时给一个可点的出口（例如直接跳到 B 站直播间） */
    showMsgAction(txt, label, onAction) {
      this.msg.innerHTML = '';
      this.msg.appendChild(el('span', { text: txt }));
      this.msg.appendChild(
        el('button', {
          class: 'msg-action',
          text: label,
          onclick: (e) => {
            e.stopPropagation();
            onAction();
          },
        })
      );
      this.msg.classList.add('err');
      this.msg.style.display = 'block';
    }

    hideMsg() {
      this.msg.style.display = 'none';
    }

    syncProgress() {
      const v = this.video;
      if (this.mode === 'live') {
        // 观看人数单独包一层 span：窄屏用 CSS 隐藏，控制条才不会被撑破
        this.timeEl.innerHTML =
          '直播中' + (this.opts.viewersText ? ' <span class="vcount">· ' + this.opts.viewersText + '</span>' : '');
        return;
      }
      if (!isFinite(v.duration) || v.duration <= 0) return;
      const p = v.currentTime / v.duration;
      this.progPlayed.style.width = (p * 100).toFixed(2) + '%';
      this.progKnob.style.left = (p * 100).toFixed(2) + '%';
      this.timeEl.textContent = fmtTime(v.currentTime) + ' / ' + fmtTime(v.duration);
    }

    /** 统一的逐帧循环：驱动弹幕动画 + 进度同步 */
    startLoop() {
      if (this._raf) return;
      const tick = () => {
        this._raf = requestAnimationFrame(tick);
        const v = this.video;
        if (this.dm) {
          this.dm.setTime(v.currentTime);
          this.dm.step(16);
        }
        if (this.mode !== 'live') this.syncProgress();
      };
      this._raf = requestAnimationFrame(tick);
    }

    stopLoop() {
      if (this._raf) cancelAnimationFrame(this._raf);
      this._raf = null;
    }

    syncBuffer() {
      const v = this.video;
      if (!v.buffered.length || !isFinite(v.duration) || v.duration <= 0) return;
      let end = 0;
      for (let i = 0; i < v.buffered.length; i++) {
        if (v.buffered.start(i) <= v.currentTime && v.buffered.end(i) > end) end = v.buffered.end(i);
      }
      this.progBuffer.style.width = ((end / v.duration) * 100).toFixed(2) + '%';
    }

    /* ---------- 线路（多路直播源） ---------- */
    setSources(list, currentId) {
      this.sources = list || [];
      this.sourceId = currentId || (this.sources[0] && this.sources[0].id);
      this.renderSourceMenu();
    }

    renderSourceMenu() {
      const m = this.menuSource;
      m.innerHTML = '';
      m.appendChild(el('div', { class: 'menu-title', text: '线路' }));
      if (!this.sources.length) {
        m.appendChild(el('div', { class: 'menu-item', text: '暂无可用线路' }));
        return;
      }
      this.sources.forEach((s) => {
        const item = el('button', {
          class: 'menu-item' + (s.id === this.sourceId ? ' active' : ''),
          onclick: (e) => {
            e.stopPropagation();
            this.closeMenus();
            if (s.id === this.sourceId) return;
            if (s.external) {
              window.open(s.external, '_blank', 'noopener');
              return;
            }
            this.sourceId = s.id;
            this.renderSourceMenu();
            if (this.opts.onSource) this.opts.onSource(s);
          },
        });
        item.appendChild(el('span', { class: 'tick', html: '&#10003;' }));
        item.appendChild(el('span', { text: s.name }));
        if (s.sub) item.appendChild(el('span', { class: 'sub', text: s.sub }));
        m.appendChild(item);
      });
    }

    /* ---------- 清晰度 ---------- */
    setQualities(list, currentName) {
      this.qualities = list || [];
      this.quality = currentName || (this.qualities[0] && this.qualities[0].name);
      this.renderQualityMenu();
      const label = this.btnQuality.querySelector('.label');
      if (label) label.textContent = this.quality || '清晰度';
      // 移动端看不到文字，图标要能反映当前档位
      const ico = this.btnQuality.querySelector('.ico');
      if (ico) {
        const m = String(this.quality || '').match(/(原画|2K|1080P|720P|480P|360P|超清|高清|标清)/);
        ico.textContent = m ? m[1] : 'HD';
      }
    }

    renderQualityMenu() {
      const m = this.menuQuality;
      m.innerHTML = '';
      m.appendChild(el('div', { class: 'menu-title', text: '清晰度' }));
      if (!this.qualities.length) {
        m.appendChild(el('div', { class: 'menu-item', text: '暂无可选清晰度' }));
        return;
      }
      this.qualities.forEach((q) => {
        const item = el('button', {
          class: 'menu-item' + (q.name === this.quality ? ' active' : ''),
          onclick: (e) => {
            e.stopPropagation();
            this.closeMenus();
            if (q.name === this.quality) return;
            this.quality = q.name;
            const label = this.btnQuality.querySelector('.label');
            if (label) label.textContent = q.name;
            this.renderQualityMenu();
            if (this.opts.onQuality) this.opts.onQuality(q);
          },
        });
        item.appendChild(el('span', { class: 'tick', html: '&#10003;' }));
        item.appendChild(el('span', { text: q.name }));
        if (q.sub) item.appendChild(el('span', { class: 'sub', text: q.sub }));
        m.appendChild(item);
      });
    }

    /* ---------- 倍速 ---------- */
    setSpeed(sp) {
      this.speed = sp;
      this.video.playbackRate = sp;
      const label = this.btnSpeed.querySelector('.label');
      if (label) label.textContent = sp === 1 ? '倍速' : sp + '×';
      // 移动端看不到文字，图标要显示当前倍速
      const ico = this.btnSpeed.querySelector('.ico');
      if (ico) ico.textContent = (sp === 1 ? '1×' : sp + '×');
      this.renderSpeedMenu();
    }

    /** 把用户选的倍速重新写回 video（媒体 load/重挂载会把 playbackRate 复位成 1） */
    applySpeed() {
      const v = this.video;
      if (!v || !this.speed || this.speed === 1) return;
      if (Math.abs(v.playbackRate - this.speed) > 0.01) v.playbackRate = this.speed;
    }

    renderSpeedMenu() {
      const m = this.menuSpeed;
      m.innerHTML = '';
      m.appendChild(el('div', { class: 'menu-title', text: '播放速度' }));
      SPEEDS.forEach((s) => {
        const item = el('button', {
          class: 'menu-item' + (s === this.speed ? ' active' : ''),
          onclick: (e) => {
            e.stopPropagation();
            this.closeMenus();
            this.setSpeed(s);
            if (this.opts.onSpeed) this.opts.onSpeed(s);
          },
        });
        item.appendChild(el('span', { class: 'tick', html: '&#10003;' }));
        item.appendChild(el('span', { text: s === 1 ? '正常' : s + '×' }));
        m.appendChild(item);
      });
    }

    /* ---------- 弹幕 ---------- */
    setDanmaku(on) {
      this.dmEnabled = on;
      this.btnDm.classList.toggle('on', on);
      this.btnDm.classList.toggle('off', !on);
      this.dmLayer.style.display = on ? 'block' : 'none';
      if (on && this.dm && this.dm.paused !== true && !this.video.paused) this.dm.play();
      if (this.opts.onDanmaku) this.opts.onDanmaku(on);
    }

    mountDanmaku(engine) {
      this.dm = engine;
    }

    renderDmMenu() {
      const m = this.menuDm;
      m.innerHTML = '';
      m.appendChild(el('div', { class: 'menu-title', text: '弹幕设置' }));
      if (!this.dm) {
        m.appendChild(el('div', { class: 'menu-item', text: '该视频暂无 B 站弹幕数据' }));
        return;
      }
      const o = this.dm.opts;
      const row = (label, key, min, max, step, fmt) => {
        const val = el('span', { class: 'val', text: fmt(o[key]) });
        const input = el('input', { type: 'range', min: String(min), max: String(max), step: String(step), value: String(o[key]) });
        input.addEventListener('input', () => {
          const v = parseFloat(input.value);
          this.dm.setOption(key, v);
          val.textContent = fmt(v);
        });
        const r = el('div', { class: 'menu-row' }, [el('span', { text: label }), input, val]);
        m.appendChild(r);
      };
      row('不透明度', 'opacity', 0.1, 1, 0.05, (v) => Math.round(v * 100) + '%');
      row('字号', 'fontSize', 14, 40, 1, (v) => v + 'px');
      row('速度', 'speed', 0.5, 2.5, 0.1, (v) => v.toFixed(1) + '×');
      row('显示区域', 'area', 0.2, 1, 0.1, (v) => Math.round(v * 100) + '%');

      m.appendChild(el('div', { class: 'menu-sep' }));
      const toggle = (label, key) => {
        const item = el('button', {
          class: 'menu-item' + (o[key] ? ' active' : ''),
          onclick: (e) => {
            e.stopPropagation();
            o[key] = !o[key];
            this.renderDmMenu();
          },
        });
        item.appendChild(el('span', { class: 'tick', html: o[key] ? '&#10003;' : '' }));
        item.appendChild(el('span', { text: label }));
        m.appendChild(item);
      };
      toggle('滚动弹幕', 'showScroll');
      toggle('顶部弹幕', 'showTop');
      toggle('底部弹幕', 'showBottom');
      toggle('高级弹幕', 'showCode');
    }

    /* ---------- 播放源 ---------- */
    /** HTTP-FLV 播放（flv.js）。仅当目标源只提供 .flv 时使用，HLS 优先。 */
    playFlvUrl(url, name, keepQuality) {
      this.mode = 'live';
      this.host.classList.add('is-live');
      this.destroyHls();
      if (!keepQuality) this.setQualities([{ name: name || '直播', sub: 'FLV' }], name || '直播');
      this.watchdog(this.opts.biliRoom);
      const v = this.video;
      if (!window.flvjs || !window.flvjs.isSupported()) {
        this.showMsg('当前浏览器不支持 FLV 直播播放，请切换其它线路', true);
        return;
      }
      try {
        this.flv = window.flvjs.createPlayer(
          { type: 'flv', url: url, isLive: true, cors: true },
          { enableWorker: false, enableStashBuffer: false, stashInitialSize: 128, autoCleanupSourceBuffer: true }
        );
      } catch (e) {
        this.showMsg('直播流初始化失败：' + e.message, true);
        return;
      }
      this.flv.attachMediaElement(v);
      this.flv.load();
      this.flv.on(window.flvjs.Events.ERROR, (type) => {
        if (type === window.flvjs.ErrorTypes.MEDIA_ERROR || type === window.flvjs.ErrorTypes.NETWORK_ERROR) {
          this.showMsg('直播流异常，正在重试…', true);
          try { this.flv.unload(); this.flv.load(); } catch (e) {}
        } else {
          this.showMsg('直播流出错，可切到其它线路', true);
        }
      });
      v.play().catch(() => this.showMsg('浏览器阻止了自动播放，请点击画面开始播放'));
      this.watchdog(this.opts.biliRoom);
    }

    playLive(url, qualities, name) {
      if (url && /\.flv(\?|$)/i.test(url)) return this.playFlvUrl(url, name);
      this.mode = 'live';
      this.host.classList.add('is-live');
      this.setQualities(qualities, name);
      this.destroyHls();
      this.watchdog(this.opts.biliRoom); // 立即计时：流可能压根拉不到（赛事已结束）
      const v = this.video;
      if (window.Hls && window.Hls.isSupported()) {
        this.hls = new window.Hls({
          liveSyncDurationCount: 2,
          // 关键：maxLiveSyncPlaybackRate = 1 时 hls.js 的 LiveSyncController
          // 完全不会写 media.playbackRate（源码里是 `1 !== a` 的门槛），
          // 否则它每次 timeupdate 都会把用户选的倍速钳回 [1,1.6] 或复位成 1。
          maxLiveSyncPlaybackRate: 1,
          enableWorker: true,
          lowLatencyMode: true,
          backBufferLength: 30,
          manifestLoadingMaxRetry: 2,
          manifestLoadingRetryDelay: 800,
        });
        this.hls.loadSource(url);
        this.hls.attachMedia(v);
        this.hls.on(Hls.Events.ERROR, (e, data) => {
          if (data.fatal) {
            if (data.type === Hls.ErrorTypes.NETWORK_ERROR) this.hls.startLoad();
            else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) this.hls.recoverMediaError();
            else this.showMsg('直播流出错，请切换线路或稍后再试', true);
          }        });
        this.hls.on(Hls.Events.MANIFEST_PARSED, () => {
          this.hideMsg();
          this.applySpeed();
          v.play().catch(() => {});
          this.watchdog();
        });
        this.hls.on(Hls.Events.LEVEL_SWITCHED, () => this.applySpeed());
      } else if (v.canPlayType('application/vnd.apple.mpegurl')) {
        v.src = url;
        v.play().catch(() => {});
      } else {
        // 老内核（如部分微信 X5 版本）既不支持 hls.js 也没有原生 HLS
        this.showMsg('当前浏览器不支持 HLS 直播播放，请改用浏览器打开或观看录像', true);
      }
    }

    /**
     * 播放 B 站赛事直播流。
     * 同一个 CDN 路径能同时拿到两种格式：.flv（HTTP-FLV，flv.js 解析）与
     * .m3u8（HLS，hls.js / iOS 原生）。实测两者在 CDN 侧的放行策略不同：
     * FLV 稳定可播，HLS 偶发被调度节点 403 —— 所以 FLV 优先，HLS 兜底，
     * 任一失败自动切到另一种。
     * 流地址由构建期抓取（运行时接口无 CORS 且被 Chrome ORB 拦），
     * 签名有效期约 60 分钟。
     */
    playBiliStream(stream, name, meta) {
      this.mode = 'live';
      this.host.classList.add('is-live');
      this.destroyHls();
      this.setQualities([{ name: name || '高清', sub: (meta && meta.qnName) || '' }], name || '高清');
      this.watchdog(this.opts.biliRoom);
      const flvUrl = (stream && stream.flvUrl) || '';
      const hlsUrl = (stream && (stream.url || stream.hlsUrl)) || '';
      const canFlv = flvUrl && window.flvjs && window.flvjs.isSupported();
      const canHls = hlsUrl && window.Hls && window.Hls.isSupported();

      const startFlv = () => this.playFlvUrl(flvUrl, name, true);
      const startHls = () => this.playHlsUrl(hlsUrl, name, canFlv ? startFlv : null);

      this._altTried = false;
      if (canFlv) {
        startFlv();
        // FLV 起来后若一直无画面，也试一次 HLS
        this._biliAlt = canHls ? startHls : null;
      } else if (canHls) {
        startHls();
        this._biliAlt = null;
      } else if (hlsUrl && this.video.canPlayType('application/vnd.apple.mpegurl')) {
        this.video.src = hlsUrl;
        this.video.play().catch(() => {});
        this._biliAlt = null;
      } else {
        this.showMsg('当前浏览器不支持该直播源（需 FLV 或 HLS 支持），可切换其它线路', true);
        return;
      }
      this.watchdog(this.opts.biliRoom);
    }

    /** HLS 播放（hls.js），altStart 用于在致命错误时回退到另一种格式 */
    playHlsUrl(hlsUrl, name, altStart) {
      const v = this.video;
      this.destroyHls();
      this.hls = new window.Hls({
        liveSyncDurationCount: 2,
        // 关键：maxLiveSyncPlaybackRate = 1 时 hls.js 完全不会写 media.playbackRate
        maxLiveSyncPlaybackRate: 1,
        enableWorker: true,
        lowLatencyMode: true,
        backBufferLength: 30,
        manifestLoadingMaxRetry: 1,
        manifestLoadingRetryDelay: 600,
      });
      this.hls.loadSource(hlsUrl);
      this.hls.attachMedia(v);
      this.hls.on(Hls.Events.ERROR, (e, data) => {
        if (data.fatal) {
          if (altStart) {
            this.destroyHls();
            altStart();
            return;
          }
          if (data.type === Hls.ErrorTypes.NETWORK_ERROR) this.hls.startLoad();
          else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) this.hls.recoverMediaError();
          else this.showMsg('直播流出错，请切换线路或稍后再试', true);
        }
      });
      this.hls.on(Hls.Events.MANIFEST_PARSED, () => {
        this.hideMsg();
        this.applySpeed();
        v.play().catch(() => {});
        this.watchdog();
      });
      this.hls.on(Hls.Events.LEVEL_SWITCHED, () => this.applySpeed());
    }

    playVod(url, info) {
      this.mode = 'vod';
      this.host.classList.remove('is-live');
      this.destroyHls();
      const v = this.video;
      v.src = url;
      v.load();
      v.playbackRate = this.speed;
      v.play().catch(() => {});
      this.hideMsg();
      if (info && info.duration) this.progEdge.style.display = 'none';
    }

    /** 直播信号看门狗：拉流成功但迟迟没有画面（赛事已结束/尚未开播）时给出明确提示 */
    watchdog(biliRoom) {
      clearInterval(this._wd);
      const deadline = Date.now() + 9000;
      this._wd = setInterval(() => {
        const v = this.video;
        if (v && v.videoWidth > 0) {
          clearInterval(this._wd);
          this.hideMsg();
          return;
        }
        if (Date.now() > deadline) {
          // 先尝试备用格式（FLV ↔ HLS），仍无画面再提示
          if (!this._altTried && this._biliAlt) {
            this._altTried = true;
            try { this._biliAlt(); } catch (e) {}
            this.watchdog(biliRoom);
            return;
          }
          clearInterval(this._wd);
          const txt = '当前暂无直播信号（赛事可能已结束或正在准备中）。可点「线路」切换备用源。';
          if (biliRoom) {
            this.showMsgAction(txt, '打开B站直播间看弹幕', () => {
              window.open('https://live.bilibili.com/' + biliRoom.roomid, '_blank', 'noopener');
            });
          } else {
            this.showMsg(txt, true);
          }
        }
      }, 1000);
    }

    destroyHls() {
      clearInterval(this._wd);
      if (this.hls) {
        try { this.hls.destroy(); } catch (e) {}
        this.hls = null;
      }
      if (this.flv) {
        try { this.flv.pause(); } catch (e) {}
        try { this.flv.unload(); } catch (e) {}
        try { this.flv.detachMediaElement(); } catch (e) {}
        try { this.flv.destroy(); } catch (e) {}
        this.flv = null;
      }
    }

    destroy() {
      this.destroyHls();
      this._cleanups.forEach((f) => {
        try { f(); } catch (e) {}
      });
      this._cleanups = [];
      if (this.dm) this.dm.destroy();
      document.removeEventListener('keydown', this._onKey);
    }
  }

  /* ------------------------------------------------------------------ *
   * 3. B 站直播弹幕（WebSocket，不受 CORS 限制）
   * ------------------------------------------------------------------ */
  /** 用 JSONP 取 B 站直播弹幕的握手 token
   *  getDanmuInfo 属于支持 JSONP 的接口族（需同时带 callback= 与 jsonp=jsonp），
   *  但风控（-352）发生在 JSONP 包装之前 —— 风控是按 IP 信誉判定的，
   *  所以家用宽带的用户通常能取到 token，而机房 IP 取不到。
   *  取不到时回退到匿名握手，再不行就由抽屉兜底。 */
  function fetchDanmuToken(roomId, timeout) {
    return jsonp(
      'https://api.live.bilibili.com/xlive/web-room/v1/index/getDanmuInfo',
      { id: roomId, type: 0, jsonp: 'jsonp' },
      { timeout: timeout || 6000 }
    )
      .then((d) => (d && d.data && d.data.token) || '')
      .catch(() => '');
  }

  class BiliLiveDanmaku {
    constructor(roomId, onMessage, onStatus) {
      this.roomId = roomId;
      this.onMessage = onMessage;
      this.onStatus = onStatus;
      this.ws = null;
      this.closed = false;
      this.retry = 0;
      this.strategy = 0;
      this.received = 0;
      this.token = '';
      this._guard = null;
    }

    async start() {
      if (!this.roomId) return;
      this.onStatus('connecting');
      // 先尝试拿真实 token（拿不到就走匿名握手）
      try {
        this.token = await fetchDanmuToken(this.roomId);
      } catch (e) {
        this.token = '';
      }
      if (this.closed) return;
      this.connect();
    }

    /** B 站弹幕协议包：16 字节头（总长 / 头长16 / 协议版本 / 操作码） + JSON */
    static authPacket(obj) {
      const json = JSON.stringify(obj);
      const payload = new TextEncoder().encode(json);
      const buf = new ArrayBuffer(16 + payload.length);
      const dv = new DataView(buf);
      dv.setUint32(0, 16 + payload.length, true);
      dv.setUint32(4, 16, true);
      dv.setUint32(8, 1, true);
      dv.setUint32(12, 7, true); // operation = 7 (AUTH)
      new Uint8Array(buf, 16).set(payload);
      return buf;
    }

    connect() {
      if (this.closed) return;
      try {
        this.ws = new WebSocket('wss://broadcastlv.chat.bilibili.com:443/sub');
      } catch (e) {
        this.onStatus('error');
        return;
      }
      this.ws.binaryType = 'arraybuffer';
      this.ws.onopen = () => {
        // 注意：不能在 open 时把 retry 归零 —— 握手成功但立刻被服务端关闭
        // （缺 token）的情况会因此永远重试不到 failed 状态。
        this.onStatus('open');
        const keys = this.token
          ? ['token=' + this.token, 'token=' + this.token]
          : ['token=true', ''];
        const key = keys[this.strategy % keys.length];
        this.ws.send(
          BiliLiveDanmaku.authPacket({
            uid: 0,
            roomid: this.roomId,
            protover: 3,
            platform: 'web',
            type: 2,
            key: key,
          })
        );
      };
      this.ws.onmessage = (ev) => {
        const before = this.received;
        this.handle(ev.data);
        if (this.received > before) {
          clearTimeout(this._guard);
          this._guard = null;
          if (before === 0) {
            // 只有真正收到弹幕，才算「连上了」
            this.retry = 0;
            this.onStatus('live');
          }
        }
      };
      this.ws.onerror = () => this.onStatus('error');
      this.ws.onclose = () => {
        this.onStatus('closed');
        if (this.closed) return;
        this.retry++;
        this.strategy++;
        if (this.retry <= 4) setTimeout(() => this.connect(), 1500 * this.retry);
        else this.onStatus('failed');
      };
      // 连接打开但迟迟收不到任何弹幕 → 判定为「握手被拒」，主动断开重试
      this._guard = setTimeout(() => {
        if (this.received === 0 && this.ws && this.ws.readyState === 1) {
          try { this.ws.close(); } catch (e) {}
        }
      }, 12000);
    }

    handle(data) {
      if (typeof data === 'string') {
        try { this.handle(new Uint8Array(data.split('').map((c) => c.charCodeAt(0)))); } catch (e) {}
        return;
      }
      const buf = new Uint8Array(data);
      const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
      let pos = 0;
      while (pos + 16 <= buf.length) {
        const len = dv.getUint32(pos);          // 包长
        const headerLen = dv.getUint32(pos + 4); // 头长（16）
        const protoVer = dv.getUint32(pos + 8);  // 协议版本
        const op = dv.getUint32(pos + 12);       // 操作码
        if (len < headerLen || pos + len > buf.length) break;
        if (op === 5) {
          let body = buf.subarray(pos + headerLen, pos + len);
          // protover 3 的包体前带 2 字节小头
          if (protoVer === 1 && body.length > 2 && body[0] === 0x00 && body[1] === 0x00)
            body = body.subarray(2);
          this.parse(body);
        }
        pos += len;
      }
    }

    /** 读取一个 varint，返回 [值, 新的位置] */
    static readVarint(b, p) {
      let res = 0;
      let shift = 0;
      while (p < b.length) {
        const c = b[p++];
        res += (c & 0x7f) * Math.pow(2, shift);
        if (!(c & 0x80)) return [res, p];
        shift += 7;
        if (shift > 56) break;
      }
      return [0, p];
    }

    /**
     * 从 protobuf 包体里抽取弹幕。
     * B 站弹幕有几种布局（info 文本在 field 1 或 field 7），
     * 所以这里递归遍历，命中"含可打印字符串 + mode/字号/颜色数值"的那一层即可。
     */
    static extractDanmu(b) {
      let best = null;
      const TEXTY = /^[ -~　-〿一-鿿＀-￯\s]+$/;
      const walk = (buf, depth) => {
        if (depth > 5 || !best) return;
        let p = 0;
        const strs = [];
        const nums = {};
        const nested = [];
        while (p < buf.length) {
          const r = BiliLiveDanmaku.readVarint(buf, p);
          p = r[1];
          const fid = Math.floor(r[0] / 8);
          const wire = r[0] % 8;
          if (wire === 2) {
            const l = BiliLiveDanmaku.readVarint(buf, p);
            p = l[1];
            const data = buf.subarray(p, p + l[0]);
            p += l[0];
            let s = '';
            try { s = new TextDecoder('utf-8', { fatal: false }).decode(data); } catch (e) {}
            if (s && s.length <= 300 && TEXTY.test(s) && s.trim().length) strs.push({ fid, s });
            nested.push(data);
          } else if (wire === 0) {
            const v = BiliLiveDanmaku.readVarint(buf, p);
            p = v[1];
            nums[fid] = v[0];
          } else if (wire === 5) {
            p += 4;
          } else if (wire === 1) {
            p += 8;
          } else break;
        }
        // 文本优先取 field 7（DanmakuElem.content），其次 field 1（旧版 info 文本）
        const cand = strs.find((x) => x.fid === 7) || strs.find((x) => x.fid === 1);
        if (cand && (nums[3] !== undefined || nums[4] !== undefined || nums[5] !== undefined)) {
          best = {
            text: cand.s,
            mode: nums[3] || 1,
            size: nums[4] || 25,
            color: nums[5] || 16777215,
          };
        }
        if (!best) nested.forEach((n) => walk(n, depth + 1));
      };
      walk(b, 0);
      return best;
    }

    parse(body) {
      // 旧协议（protover 0）：包体是 JSON
      if (body.length && body[0] === 0x7b) {
        try {
          const j = JSON.parse(new TextDecoder().decode(body));
          if (j.cmd && /DANMU_MSG/.test(j.cmd) && j.info) {
            this.received++;
            this.onMessage({
              text: j.info[1],
              mode: j.info[3] || 1,
              size: j.info[4] || 25,
              color: j.info[5] || 16777215,
              time: j.info[0] ? j.info[0][4] : Date.now(),
            });
          }
        } catch (e) {}
        return;
      }
      const d = BiliLiveDanmaku.extractDanmu(body);
      if (d && d.text) {
        this.received++;
        this.onMessage({ text: d.text, mode: d.mode, size: d.size, color: d.color, time: Date.now() });
      }
    }

    stop() {
      this.closed = true;
      if (this.ws) {
        try { this.ws.close(); } catch (e) {}
        this.ws = null;
      }
    }
  }

  /* ------------------------------------------------------------------ *
   * 4. 数据仓库（静态 JSON）
   * ------------------------------------------------------------------ */
  const Repo = {
    catalog: null,
    schedule: null,
    /** 赛程快照的元信息（快照时间 / 场次数 / 来源），用于展示新鲜度 */
    scheduleMeta: null,
    /** 数据实际来自本地烘焙快照还是远端数据源（用于界面如实标注） */
    origin: 'local',
    /** 「上次核对上游的时间」（来自 version.json）——界面用它显示数据有多新 */
    refreshedAt: '',
    async load() {
      if (this.catalog) return this.catalog;
      const r = await loadDataFile('catalog');
      if (!r.json) throw new Error('赛程数据加载失败');
      this.origin = r.origin;
      this.refreshedAt = (r.ver && r.ver.updatedAt) || r.json.updatedAt || '';
      this.catalog = r.json;
      return this.catalog;
    },
    /** 完整赛程（含未开赛 / 未发布的比赛），用于对阵图 */
    async loadSchedule(force) {
      if (this.schedule && !force) return this.schedule;
      const r = await loadDataFile('schedule', force);
      if (r.json && Array.isArray(r.json.matches)) {
        this.schedule = r.json.matches;
        this.scheduleMeta = {
          updatedAt: r.json.updatedAt || '',
          // 「刷新时间」= 上次从上游核对的时间（version.json），
          // 用它判断新鲜度；内容没变时它照样是新的（数据确实刚核对过）。
          refreshedAt: (r.ver && r.ver.updatedAt) || r.json.updatedAt || '',
          total: r.json.total || r.json.matches.length,
          source: r.json.source || '',
          origin: r.origin,
        };
        return this.schedule;
      }
      /* 回退到 catalog */
      const cat = await this.load();
      this.schedule = cat.matches || [];
      this.scheduleMeta = { updatedAt: cat.updatedAt || '', total: this.schedule.length, source: 'catalog' };
      return this.schedule;
    },
  };

  /* ------------------------------------------------------------------ *
   * 5. 视图
   * ------------------------------------------------------------------ */
  const view = $('#view');

  /**
   * 渲染代次守卫。
   *
   * 远端数据到位会触发「自动重绘」，用户也可能连点切页 —— 这时会有两个渲染同时在跑。
   * 渲染的过程是「先 view.innerHTML = '' 清空，再逐块回填」，中间只要有 await，
   * 两个渲染就会交错：旧渲染晚到就会在页面上多留一份重复内容
   * （实测踩过：赛程页出现两份赛程 —— 一份新数据、一份旧数据）。
   *
   * 所以每次渲染领一个号；只有最新一代允许改 DOM，过期的那一代直接放弃。
   */
  let renderSeq = 0;
  const beginRender = () => ++renderSeq;
  const isStaleRender = (seq) => seq !== renderSeq;

  function setNav(key) {
    $$('.nav a').forEach((a) => a.classList.toggle('active', a.dataset.nav === key));
  }

  function loading(text) {
    view.innerHTML = '';
    view.appendChild(
      el('div', { class: 'state', html: `<div class="spinner"></div><p>${text || '加载中…'}</p>` })
    );
  }

  function errorState(title, desc, retry) {
    view.innerHTML = '';
    const s = el('div', { class: 'state' });
    s.appendChild(el('h3', { text: title }));
    s.appendChild(el('p', { text: desc || '' }));
    if (retry) s.appendChild(el('p', { style: { marginTop: '14px' } }, el('button', { class: 'ctrl-btn', text: '重试', onclick: retry })));
    view.appendChild(s);
  }

  /* ---------------- 直播页 ---------------- */
  /* ------------------------------------------------------------------ *
   * 直播页
   *
   * 线路构成（实测结论）：
   *  - 腾讯官方锚点是「常驻房间」，接口一直返回它，但里面挂的是几年前的
   *    失效流（m3u8 302 → 调度节点 404）。所以腾讯源只有在它真的在播
   *    （观看人数 > 0 或能对应到对阵）时才值得用。
   *  - 真正在播的赛事直播在 B 站（赛事直播间 / 二路直播间）。B 站只给
   *    HTTP-FLV（无 HLS 字段），需要 flv.js 解析；其 CDN 响应带
   *    Access-Control-Allow-Origin: *，浏览器可直连。
   *  - 但 B 站的 playUrl 接口没有 ACAO 头、JSONP 又是 application/json
   *    （被 Chrome ORB 拦），所以流地址只能构建期抓，有效期约 60 分钟。
   * ------------------------------------------------------------------ */

  /** 平台名 → 配色 class（斗鱼橙 / 虎牙黄 / B站粉 / 腾讯蓝） */
  function platClass(platform) {
    const p = String(platform || '');
    if (p.indexOf('哔哩') >= 0 || p.indexOf('B站') >= 0) return 'plat-bili';
    if (p.indexOf('斗鱼') >= 0) return 'plat-douyu';
    if (p.indexOf('虎牙') >= 0) return 'plat-huya';
    if (p.indexOf('腾讯') >= 0) return 'plat-tencent';
    return '';
  }

  /**
   * 格式化人气值。
   * B 站 get_info 的 online 是「累计人气」而非同时在线（同一房间会从 200 万
   * 一路涨到 1 亿），当成「N 人在看」会明显失真，所以统一按「人气值」表述。
   */
  function fmtPopularity(n) {
    const v = Number(n) || 0;
    if (v >= 100000000) return (v / 100000000).toFixed(2) + ' 亿';
    if (v >= 10000) return (v / 10000).toFixed(1) + ' 万';
    return v.toLocaleString();
  }

  /** B 站 qn 档位 → 实际分辨率（B站转码档位与推流码率的对应关系） */
  function qnToRes(qn) {
    switch (Number(qn)) {
      case 15000: return '2K';
      case 10000: return '原画';
      case 400: return '1080P';
      case 250: return '720P';
      case 150: return '480P';
      case 80: return '360P';
      default: return '';
    }
  }

  /** B 站直播流地址是否已过期（构建期抓取，签名有效期约 60 分钟） */
  function streamExpired(room, marginSec) {
    if (!room || !room.stream) return true;
    const e = room.stream.expires || 0;
    if (!e) return false;
    return e - Math.floor(Date.now() / 1000) < (marginSec || 90);
  }

  /** B 站房间的实际授权清晰度（qn：150=480P、250=720P、10000=原画，未登录会被降级） */
  function biliQn(room) {
    return (room && room.stream && Number(room.stream.qn)) || 0;
  }

  /** B 站流的实际码率（从签名 URL 的 suffix 读，形如 ..._2500.m3u8 → 2.5 Mbps） */
  function biliBitrate(room) {
    const u = (room && room.stream && (room.stream.url || room.stream.flvUrl)) || '';
    const m = u.match(/_(\d{3,5})\.(?:m3u8|flv)/);
    if (!m) return 0;
    const kbps = Number(m[1]);
    return kbps > 100 ? Math.round(kbps / 100) / 10 : 0; // Mbps，保留一位小数
  }

  /** B 站线路的清晰度标签：档位名 + 实际分辨率 + 实际码率（如实展示，不夸大） */
  function biliQualityLabel(room) {
    if (!room || !room.stream) return '源未就绪';
    const res = qnToRes(biliQn(room));
    const br = biliBitrate(room);
    const nm = room.stream.qnName || '';
    return [nm, res, br ? br + ' Mbps' : ''].filter(Boolean).join(' · ');
  }

  /**
   * 这个 B 站房间是不是英雄联盟赛事正片。
   * 之前把「金铲铲之战」分区的房间也当成了赛事线路（用户反馈「其余线路不清晰」，
   * 其实一半是别的游戏），这里按分区与标题过滤掉。
   */
  function isLolEsportsRoom(r) {
    const t = (r && r.title ? r.title : '') + ' ' + (r && r.area ? r.area : '');
    if (/金铲铲|云顶|无畏契约|valorant|地下城|DNF|王者荣耀|和平精英|原神|永劫无间/i.test(t)) return false;
    if (/赛事|英雄联盟|LPL|全球总决赛|世界赛|S1[0-9]|MSI|季中冠军赛/i.test(t)) return true;
    return false;
  }

  /** 下一场比赛（赛程里未来最近、双方队伍已确定的一场） */
  async function nextFixture() {
    let list = [];
    try {
      list = await Repo.loadSchedule();
    } catch (e) {
      return null;
    }
    const now = Date.now();
    const cands = list
      .filter((m) => m.date && m.teamA && m.teamB && !/^D\d/i.test(m.teamA))
      .map((m) => ({ m, ts: new Date(String(m.date).replace(/-/g, '/')).getTime() }))
      .filter((x) => x.ts > now - 60 * 60000)
      .sort((a, b) => a.ts - b.ts);
    return cands.length ? cands[0].m : null;
  }

  function fmtCountdown(ts) {
    let diff = ts - Date.now();
    if (diff < 0) diff = 0;
    const d = Math.floor(diff / 86400000);
    const h = Math.floor((diff % 86400000) / 3600000);
    const m = Math.floor((diff % 3600000) / 60000);
    const s = Math.floor((diff % 60000) / 1000);
    if (d > 0) return d + ' 天 ' + h + ' 小时 ' + m + ' 分';
    if (h > 0) return h + ' 小时 ' + m + ' 分 ' + s + ' 秒';
    if (m > 0) return m + ' 分 ' + s + ' 秒';
    return s + ' 秒';
  }

  /** 取点播播放地址：失败自动重试一次（腾讯生成 vkey 偶尔超时） */
  async function fetchVodWithRetry(vid, defn, attempt) {
    const n = attempt || 0;
    try {
      return await API.vod(vid, defn);
    } catch (e) {
      if (n >= 1) throw e;
      await new Promise((r) => setTimeout(r, 1200));
      return fetchVodWithRetry(vid, defn, n + 1);
    }
  }

  /**
   * 赛事横幅：显示赛事 + 对阵 + 比分 + 队徽。
   * 优先用当前线路的官方对阵信息（腾讯 match），没有再退回赛程里最近的一场，
   * 否则会出现「横幅和右侧卡片说的不是同一场比赛」的矛盾。
   */
  async function buildEventBanner() {
    let list = [];
    try {
      list = await Repo.loadSchedule();
    } catch (e) {
      return null;
    }
    await ensureTeamLogos();
    const now = Date.now();
    const played = list
      .filter(
        (m) =>
          m.date &&
          m.teamA &&
          m.teamB &&
          !/^D\d/.test(m.teamA) &&
          m.score &&
          m.score !== '0:0' &&
          !/^(总决赛|半决赛|季军赛)/.test(m.teamA)
      )
      .map((m) => ({ m, ts: new Date(String(m.date).replace(/-/g, '/')).getTime() }))
      .filter((x) => isFinite(x.ts))
      .sort((a, b) => b.ts - a.ts);
    const cur = played.find((x) => now - x.ts < 6 * 3600000 && now - x.ts > -3 * 3600000) || played[0];
    if (!cur) return null;
    return renderBanner(cur.m);
  }

  /** 用一条比赛信息填充横幅内容 */
  function renderBanner(m) {
    const a = teamByTeamId(m.teamIdA, m.teamA);
    const b = teamByTeamId(m.teamIdB, m.teamB);
    const box = el('div', { class: 'event-banner' });
    box.appendChild(
      el('div', {}, [
        el('div', { class: 'eb-game', text: m.game || '赛事' }),
        el('div', {
          class: 'eb-phase',
          text: [m.phase, m.mode, String(m.date || '').slice(0, 10)].filter(Boolean).join(' · '),
        }),
      ])
    );
    const teams = el('div', { class: 'eb-teams' });
    const side = (info) => {
      const s = el('div', { class: 'eb-side' });
      if (info.logo) s.appendChild(el('img', { src: info.logo, alt: info.name, loading: 'lazy' }));
      s.appendChild(el('span', { text: info.name || '—' }));
      return s;
    };
    teams.appendChild(side(a));
    teams.appendChild(el('span', { class: 'eb-score', text: m.score || '0 : 0' }));
    teams.appendChild(side(b));
    box.appendChild(teams);
    return box;
  }

  async function renderLive() {
    const seq = beginRender();
    setNav('live');
    loading('正在连接直播源…');

    // ① B 站直播间（构建期预取了直播流地址）
    let rooms = [];
    try {
      rooms = await ensureBiliRooms();
    } catch (e) {
      /* 忽略 */
    }

    // 后台探测到更新的远端数据（CI 重建后）时自动重绘整个直播页。
    // B 站流地址约 60 分钟就过期，这一跳决定了「腾讯不开播时有没有 B 站线路」。
    const offRemote = onRemoteUpgrade(async () => {
      // 强制重拉一次（此时远端版本已在会话缓存里，会直接取更新的那份），
      // 再整体重绘 —— 否则 ensureBiliRooms 的缓存会让新数据用不上。
      try {
        await ensureBiliRooms(true);
      } catch (e) {
        /* 忽略 */
      }
      renderLive();
    });

    // ② 腾讯官方直播（运行时直连 JSONP）
    let txLive = [];
    let bmatch = null;
    let lgames = null;
    try {
      const [raw, bm, lg] = await Promise.all([
        API.live(),
        loadGlobalScript(LIVE_BMATCH_JS, 'LiveBMatchList').catch(() => null),
        loadGlobalScript(LIVING_GAMES_JS, 'LivingGames').catch(() => null),
      ]);
      txLive = normalizeLive(raw);
      bmatch = bm && bm.msg ? bm.msg : null;
      lgames = lg && lg.msg ? lg.msg : null;
    } catch (e) {
      /* 腾讯源不可用不致命：B 站源仍可播 */
    }

    // anchor ↔ 赛事对阵
    const anchorToGame = {};
    if (lgames && lgames.Title) {
      String(lgames.Title).split('#').forEach((chunk) => {
        const p = chunk.split('-');
        if (p.length >= 3 && p[0] && p[2]) anchorToGame[String(p[2])] = String(p[0]);
      });
    }
    const gamesById = {};
    const byAnchor = {};
    if (bmatch && typeof bmatch === 'object') {
      Object.keys(bmatch).forEach((gid) => {
        const v = bmatch[gid];
        if (Array.isArray(v) && v.length) gamesById[gid] = v[0];
      });
      Object.keys(gamesById).forEach((gid) => {
        const g = gamesById[gid];
        if (g && g.Video3 && g.Video3 !== '0') byAnchor[String(g.Video3)] = g;
      });
    }
    txLive.forEach((l) => {
      const gid = anchorToGame[l.anchorId];
      l.match = (gid && gamesById[gid]) || byAnchor[l.anchorId] || null;
    });

    // 线路表：B 站各房间（不同房间 = 不同码率 = 不同清晰度）+ 腾讯官方源 + 其它平台官方直播间
    const sources = [];
    const biliRooms = rooms
      .filter((r) => r.live && isLolEsportsRoom(r))
      .sort((a, b) => {
        // 先看真实清晰度：B 站未登录时每个房间的授权档位不同（480P / 720P…），
        // 码率高的房间才是真正能看更清楚的线路，房间名里的「4K」并不可信。
        const qa = biliQn(a);
        const qb = biliQn(b);
        if (qa !== qb) return qb - qa;
        // 其次赛事分区优先（"游戏赛事" 才是正片，"英雄联盟" 分区多是散户复盘/二路闲聊）
        const ea = /赛事/.test(a.area || '') ? 1 : 0;
        const eb = /赛事/.test(b.area || '') ? 1 : 0;
        if (ea !== eb) return eb - ea;
        // 同为赛事分区：在线人数多的当主线路（内容与官方主直播间一致）
        return (b.online || 0) - (a.online || 0);
      });
    biliRooms.forEach((r) => {
      sources.push({
        id: 'bili-' + r.roomid,
        kind: 'bili',
        // 名称用房间自己的真实标题（不同房间转播不同场次，文案不能一样）
        name: (r.title || 'B站直播间').slice(0, 28),
        sub: r.roomid + ' · ' + biliQualityLabel(r),
        platform: '哔哩哔哩',
        cover: r.cover || '',
        room: r,
        expired: streamExpired(r),
        // 过期的流地址不算「可播」——主线路会自动跳过它，避免选到黑屏源
        playable: !!r.stream && !streamExpired(r),
        viewers: r.online || 0,
      });
    });
    txLive.forEach((l, i) => {
      if (!l.streams.length) return;
      const healthy = (l.viewers || 0) > 0 || !!l.match;
      sources.push({
        id: 'tx-' + l.anchorId,
        kind: 'tx',
        name: healthy ? '腾讯官方源' : '腾讯官方源（当前未开播）',
        sub: healthy ? l.streams[0].name : '无信号 · 已置底',
        platform: '腾讯',
        cover: (txCovers && txCovers[String(l.anchorId)]) || '',
        live: l,
        streams: l.streams,
        // 腾讯常驻房没信号时不当作可播，否则主线路会选中它、永远进不了兜底分支
        playable: healthy,
        healthy,
        viewers: l.viewers || 0,
      });
    });
    // 腾讯赛事进行时的实时直播地址（LiveBMatchList 是跨域可读的 var 赋值）
    const lbStreams = extractStreamsFromLiveBMatch(bmatch);
    if (lbStreams.length) {
      const items = lbStreams.map((s) => ({
        name: /超清|3000|2500|2000/.test(s.url) ? '超清' : /1500/.test(s.url) ? '高清' : '标清',
        hls: s.hls,
        flv: s.flv,
        url: s.url,
        bitrate: 0,
      }));
      sources.push({
        id: 'tx-live',
        kind: 'tx',
        name: '腾讯赛事直播（实时）',
        sub: items.length + ' 档',
        platform: '腾讯',
        live: { viewers: 0, match: null, streams: items },
        streams: items,
        playable: true,
        healthy: true,
        viewers: 0,
      });
    }
    // 其它平台：运行时无法跨域读取其流地址（接口不给 ACAO、JSONP 被 ORB 拦、
    // 官方播放器也拒绝被 iframe 内嵌），因此提供「站内直达入口」跳官方直播间，
    // 由平台自己的播放器提供清晰度与音量调节。
    (externalRooms || []).forEach((r) => {
      sources.push({
        id: 'ext-' + r.platform + '-' + r.roomid,
        kind: 'ext',
        name: r.platform + ' · ' + r.name,
        sub: r.note || '新标签打开',
        platform: r.platform,
        external: r.url,
        playable: false,
        viewers: 0,
      });
    });
    // 未开播的腾讯源排到最后（用户反馈：腾讯线路连画面都没有）
    sources.sort((a, b) => (a.healthy === false ? 1 : 0) - (b.healthy === false ? 1 : 0));

    // 主线路：优先「腾讯真在播」（1080P 三档），其次未过期的 B 站房间。
    // 都没有 → main 为 null，走兜底分支（页面直接摆出平台官方直播间按钮）。
    const playable = sources.filter((s) => s.playable);
    const main =
      playable.find((s) => s.kind === 'tx' && s.healthy) ||
      playable.find((s) => s.kind === 'bili') ||
      null;

    // ⚠️ 直播页只改 view 的两个点：清空 与 最终挂载。
    // 中间的 await 都在离屏的 left/hero 上做，不会污染页面 —— 所以不必把 await 全前移
    // （那会让首屏被 nextFixture 之类的慢调用阻塞，实测会导致直播页迟迟出不来）。
    // 防重复渲染靠代次守卫：过期渲染既不许清空、也不许挂载。
    if (isStaleRender(seq)) return;
    view.innerHTML = '';
    const hero = el('div', { class: 'hero' });
    const left = el('div');
    // 赛事横幅：队徽 + 对阵 + 比分（给页面一个「赛事感」的视觉锚点）
    let bannerBox = await buildEventBanner();
    if (bannerBox) left.appendChild(bannerBox);
    // 画质条：如实显示当前实际分辨率 + 一键切到更高画质档位
    const qBar = el('div', { class: 'quality-bar' });
    left.appendChild(qBar);
    const playerHost = el('div', { class: 'player-16-9' });
    left.appendChild(playerHost);

    const p = new Player(playerHost, { mode: 'live' });
    activePlayer = p;
    // 离开直播页时注销「远端升级 → 自动重绘」的回调
    p._cleanups.push(offRemote);
    p.setSpeed(1);
    p.renderSpeedMenu();
    p.renderDmMenu();

    // 先把主区挂进 hero，再渲染侧栏 —— 顺序反了会让侧栏占掉左列、
    // 把播放器挤到右列（布局整体左右颠倒）
    hero.appendChild(left);

  /** 当前线路的展示信息 */
    const srcInfo = (s) => {
      if (!s) return { title: '暂无直播信号', meta: '', viewers: '' };
      if (s.kind === 'bili') {
        const exp = s.room.stream ? s.room.stream.expires : 0;
        const leftMin = exp ? Math.max(0, Math.round((exp - Date.now() / 1000) / 60)) : 0;
        return {
          title: s.room.title || 'B站赛事直播间',
          meta: [
            s.room.area || '赛事',
            fmtPopularity(s.room.online) + ' 人气值',
            s.expired ? '流地址已过期' : '站内直连 · ' + biliQualityLabel(s.room),
            !s.expired && leftMin ? '地址约 ' + leftMin + ' 分钟后刷新' : '',
          ]
            .filter(Boolean)
            .join(' · '),
          viewers: (s.room.online || 0) ? fmtPopularity(s.room.online) + ' 人气' : '',
        };
      }
      if (s.kind === 'ext') {
        return {
          title: s.name,
          meta: [s.platform, s.sub, '点击后在新标签打开官方直播间（清晰度与音量由平台播放器提供）']
            .filter(Boolean)
            .join(' · '),
          viewers: '',
        };
      }
      const gm = s.live.match;
      return {
        title: gm ? (gm.GameName || '') + ' · ' + (gm.bMatchName || s.sub) : s.sub || s.name,
        meta: gm
          ? [gm.GameProcName, gm.GameModeName, gm.MatchDate].filter(Boolean).join(' · ')
          : '当前无信号（腾讯常驻房间未在播）',
        viewers: (s.live.viewers || 0) ? (s.live.viewers || 0).toLocaleString() + ' 人观看' : '',
      };
    };

    /**
     * 清晰度档位：
     *  - 腾讯源：超清 / 高清 / 标清（hls.js 直接切流）
     *  - B 站源：不同房间 = 不同码率 = 不同清晰度（B 站未登录单房间只有一档，
     *    所以用「切到码率更高的房间」来实现真正的多档清晰度）
     */
    const qualityListFor = (s) => {
      if (!s) return [];
      if (s.kind === 'tx') {
        return s.streams.map((x) => ({ name: x.name, sub: x.bitrate + 'k', stream: x, kind: 'tx' }));
      }
      if (s.kind === 'bili') {
        // 清晰度档位 = 各房间的实际码率（不同房间转播不同场次，菜单里写清楚）
        return biliRooms
          .filter((r) => r.live && r.stream)
          .sort((a, b) => ((b.stream.qn || 0) - (a.stream.qn || 0)))
          .map((r) => ({
            name:
              (r.stream.qnName || '高清') +
              ' ' +
              qnToRes(r.stream.qn) +
              ' · ' +
              (r.title || r.roomid).slice(0, 12),
            sub: '房间 ' + r.roomid + ' · ' + fmtPopularity(r.online) + ' 人气',
            room: r,
            kind: 'bili',
          }));
      }
      return [];
    };

    /** 画质条：显示当前实际分辨率，并在有更高档位时给一键切换 */
    let currentRes = { w: 0, h: 0 };
    let currentSource = null;
    const renderQualityBar = () => {
      qBar.innerHTML = '';
      if (!currentSource) return;
      const biliRooms2 = biliRooms.filter((r) => r.live && r.stream);
      // 按推流档位（suffix）排序找最高档
      const best = biliRooms2.slice().sort((a, b) => ((b.stream.qn || 0) - (a.stream.qn || 0)))[0];
      const cur = currentSource.kind === 'bili' ? currentSource.room : null;
      const curLabel = cur ? (cur.stream.qnName || '高清') : currentSource.platform || '';
      qBar.appendChild(
        el('span', {
          class: 'qb-label',
          text: currentRes.h
            ? '当前画质 ' + currentRes.w + '×' + currentRes.h + '（' + curLabel + '）'
            : '正在解析画质…',
        })
      );
      if (cur && best && best.roomid !== cur.roomid && (best.stream.qn || 0) > (cur.stream.qn || 0)) {
        qBar.appendChild(
          el('button', {
            class: 'qb-switch',
            text: '切到更高画质 ' + (best.stream.qnName || '高清') + ' · ' + (best.title || '').slice(0, 12),
            onclick: () => {
              const target = sources.find((x) => x.kind === 'bili' && x.room.roomid === best.roomid);
              if (target) {
                applySource(target);
                p.setSources(
                  sources.map((x) => ({
                    id: x.id,
                    name: x.name,
                    sub: x.sub,
                    source: x,
                    external: x.kind === 'ext' ? x.external : x.kind === 'bili' && x.expired ? x.room.biliUrl : null,
                  })),
                  target.id
                );
              }
            },
          })
        );
        qBar.appendChild(el('span', { class: 'qb-note', text: '（不同房间可能转播不同场次）' }));
      }
    };

    /** 播放器下方的标题块：跟随当前线路更新（须在 applySource 之前定义） */
    const titleBox = el('div', { style: { marginTop: '14px' } });
    left.appendChild(titleBox);

    /* 「刷新直播源」——
     * B 站的流地址是服务端签发的，有效期约 60 分钟，页面开久了地址就会过期。
     * 这个按钮让用户能立刻换一份新签发的地址，而不必刷新整个页面（不丢播放进度）。
     * 数据源就绪后（远端数据源 / CI 自动更新），这里的刷新拿到的就是最新快照。 */
    const refreshLiveBtn = el('button', {
      class: 'qb-switch',
      text: '刷新直播源',
      onclick: async () => {
        const oldText = refreshLiveBtn.textContent;
        refreshLiveBtn.disabled = true;
        refreshLiveBtn.textContent = '正在刷新…';
        try {
          const before = liveRoomsUpdatedAt;
          await ensureBiliRooms(true);
          if (!liveRoomsUpdatedAt || liveRoomsUpdatedAt === before) {
            toast('直播源已是最新');
            return;
          }
          // 用新房间重建 B 站线路（保持当前选中的线路不变）
          let changed = 0;
          sources.forEach((s) => {
            if (s.kind !== 'bili') return;
            const r = biliRooms.find((x) => String(x.roomid) === String(s.room.roomid));
            if (!r) return;
            s.room = r;
            s.name = (r.title || 'B站直播间').slice(0, 28);
            s.sub = r.roomid + ' · ' + biliQualityLabel(r);
            s.expired = streamExpired(r);
            s.playable = !!r.stream && !s.expired;
            s.viewers = r.online || 0;
            changed++;
          });
          if (!changed) {
            toast('直播源已是最新');
            return;
          }
          p.setSources(
            sources.map((x) => ({
              id: x.id,
              name: x.name,
              sub: x.sub,
              source: x,
              external: x.kind === 'ext' ? x.external : x.kind === 'bili' && x.expired ? x.room.biliUrl : null,
            })),
            currentSource ? currentSource.id : undefined
          );
          if (currentSource) updateTitle(currentSource);
          toast('直播源已更新到 ' + fmtSnapshotTime(liveRoomsUpdatedAt));
        } catch (err) {
          toast('刷新失败：' + ((err && err.message) || '未知错误'));
        } finally {
          refreshLiveBtn.disabled = false;
          refreshLiveBtn.textContent = oldText;
        }
      },
    });
    const liveTools = el('div', { style: { marginTop: '10px' } }, [
      refreshLiveBtn,
      el('span', { class: 'qb-note', text: '（B 站流地址约 60 分钟有效，页面开久了点一下换新的）' }),
    ]);
    left.appendChild(liveTools);

    // 腾讯官方对阵信息 → 统一的横幅结构
    const fromTxMatch = (gm) => ({
      game: gm.GameName || '',
      phase: gm.GameProcName || '',
      mode: gm.GameModeName || '',
      date: gm.MatchDate || '',
      teamA: gm.TeamShortNameA || '',
      teamIdA: gm.TeamA || '',
      teamB: gm.TeamShortNameB || '',
      teamIdB: gm.TeamB || '',
      score: (gm.ScoreA != null ? gm.ScoreA : 0) + ' : ' + (gm.ScoreB != null ? gm.ScoreB : 0),
    });
    const updateTitle = (s) => {
      const inf = srcInfo(s);
      titleBox.innerHTML = '';
      titleBox.appendChild(
        el('h2', {
          style: { margin: '0 0 6px', fontSize: '18px' },
          text: inf.title,
        })
      );
      titleBox.appendChild(
        el('div', {
          style: { color: 'var(--text-faint)', fontSize: '13px' },
          text: inf.meta,
        })
      );
      // 横幅跟着当前线路走：腾讯源有官方对阵信息时优先用它，
      // 免得横幅显示的是另一场比赛，和右侧卡片自相矛盾
      if (s && s.live && s.live.match && bannerBox && bannerBox.parentNode) {
        const nb = renderBanner(fromTxMatch(s.live.match));
        bannerBox.parentNode.replaceChild(nb, bannerBox);
        bannerBox = nb;
      }
    };

    /** 切换到某条线路 */
    const applySource = (s, quiet) => {
      if (!s) return;
      const inf = srcInfo(s);
      p.opts.viewersText = inf.viewers;
      if (s.kind === 'bili') {
        p.opts.biliRoom = s.room;
        if (s.expired || !s.room.stream) {
          // 流地址过期（B 站签名约 60 分钟）→ 自动切到还活着的线路，
          // 而不是给用户留一块黑屏
          const alt =
            sources.find((x) => x.kind === 'tx' && x.healthy && x.playable) ||
            sources.find((x) => x.kind === 'bili' && x.playable && !x.expired);
          if (alt && alt.id !== s.id) {
            p.showMsg('该路直播地址已过期，正在切换到 ' + alt.name);
            applySource(alt, true);
            return;
          }
          p.showMsgAction(
            '该直播源地址已过期或尚未生成；可点下方按钮直接去 B 站直播间观看。',
            '打开B站直播间',
            () => {
              window.open(s.room.biliUrl || 'https://live.bilibili.com/' + s.room.roomid, '_blank', 'noopener');
            }
          );
        } else {
          p.playBiliStream(s.room.stream, s.room.stream.qnName || '高清', s.room.stream);
        }
      } else if (s.kind === 'ext') {
        const w = window.open(s.external, '_blank', 'noopener');
        if (!w) toast('浏览器拦截了新标签，请允许弹窗后重试');
        toast('已在新标签打开 ' + s.platform + ' 官方直播间');
        return;
      } else {
        const st = s.streams[0];
        p.opts.biliRoom = findBiliRoom(s.sub || '', s.live.match ? s.live.match.GameName : '');
        p.playLive(st.hls || st.url || st.flv, s.streams, st.name);
      }
      // 清晰度菜单跟随当前线路
      const ql = qualityListFor(s);
      p.setQualities(
        ql.map((q) => ({ name: q.name, sub: q.sub })),
        s.kind === 'bili' && s.room.stream ? (s.room.stream.qnName || '高清') + ' · ' + (s.room.title || '').slice(0, 14) : s.kind === 'tx' ? s.streams[0].name : ''
      );
      p.opts.onQuality = (q) => {
        const item = ql.find((x) => x.name === q.name);
        if (!item) return;
        if (item.kind === 'tx') {
          p.playLive(item.stream.hls || item.stream.url || item.stream.flv, s.streams, item.stream.name);
          toast('已切换到 ' + item.stream.name);
        } else if (item.kind === 'bili') {
          const target = sources.find((x) => x.kind === 'bili' && x.room.roomid === item.room.roomid);
          if (target) {
            applySource(target);
            toast('已切换到 ' + item.room.title);
          }
        }
      };
      // 徽章如实反映当前线路
      p.tags.innerHTML = '';
      p.tags.appendChild(el('span', { class: 'badge badge-live', text: '● 直播中' }));
      p.tags.appendChild(el('span', { class: 'badge badge-soft', text: s.platform || (s.kind === 'bili' ? '哔哩哔哩' : '腾讯') }));
      if (s.kind === 'bili') {
        p.tags.appendChild(
          el('span', { class: 'badge badge-hd', text: s.room.stream ? s.room.stream.qnName || '高清' : '源未就绪' })
        );
      } else {
        p.tags.appendChild(el('span', { class: 'badge badge-hd', text: '多档清晰度' }));
      }
      p.tags.appendChild(el('span', { class: 'badge badge-dm', text: '弹幕见B站直播间' }));
      // 实际解码分辨率回报后，把清晰度徽章改成「档位 + 实际分辨率」
      p.opts.onResolved = (w, h) => {
        if (!w || !h) return;
        const badge = p.tags.querySelector('.badge-hd');
        if (badge) {
          const base = s.kind === 'bili' ? (s.room.stream ? s.room.stream.qnName || '高清' : '直播') : '多档清晰度';
          badge.textContent = base + ' ' + h + 'P';
        }
        currentRes = { w, h };
        renderQualityBar();
      };
      // 侧栏跟随切换
      $$('.side-panel').forEach((sp) => sp.remove());
      hero.appendChild(liveSourcePanel(s, inf));
      currentSource = s;
      currentRes = { w: 0, h: 0 };
      renderQualityBar();
      if (updateTitle) updateTitle(s);
      if (!quiet) toast('已切换到 ' + s.name);
    };

    if (main) {
      applySource(main, true);
      p.setSources(
        sources.map((s) => ({
          id: s.id,
          name: s.name,
          sub: s.sub,
          source: s,
          external: s.kind === 'ext' ? s.external : s.kind === 'bili' && s.expired ? s.room.biliUrl : null,
        })),
        main.id
      );
      p.opts.onSource = (item) => {
        const s = item.source;
        if (!s) return;
        if (s.kind === 'ext') {
          const w = window.open(s.external, '_blank', 'noopener');
          if (!w) toast('浏览器拦截了新标签，请允许弹窗后重试');
          return;
        }
        if (item.external) {
          window.open(item.external, '_blank', 'noopener');
          return;
        }
        applySource(s);
      };
    } else {
      // 站内没有可用信号时（休赛期或地址已过期），不要让用户自己去菜单里翻：
      // 直接在播放器区摆出各平台官方直播间的大按钮（那些是永远实时的，
      // 清晰度/音量由平台自己的播放器提供）。
      p.showMsgAction(
        '当前没有可用的站内直播信号（赛事休赛或地址已过期）。下面是各平台官方直播间，清晰度与音量可在平台播放器里调整。',
        '打开斗鱼 LPL 官方直播间',
        () => {
          const ext = sources.find((x) => x.kind === 'ext');
          if (ext) window.open(ext.external, '_blank', 'noopener');
        }
      );
      const fallback = el('div', { class: 'live-fallback' });
      fallback.appendChild(el('div', { class: 'lf-title', text: '去这些直播间看（永远实时）' }));
      const grid = el('div', { class: 'lf-grid' });
      (externalRooms || []).forEach((r) => {
        grid.appendChild(
          el('button', {
            class: 'lf-btn ' + platClass(r.platform),
            onclick: () => {
              const w = window.open(r.url, '_blank', 'noopener');
              if (!w) toast('浏览器拦截了新标签，请允许弹窗后重试');
            },
          }, [
            el('span', { class: 'lf-plat', text: r.platform }),
            el('span', { class: 'lf-name', text: r.name }),
            el('span', { class: 'lf-note', text: r.note || '' }),
          ])
        );
      });
      fallback.appendChild(grid);
      left.appendChild(fallback);
      if (sources.length) {
        p.setSources(
          sources.map((s) => ({
            id: s.id,
            name: s.name,
            sub: s.sub,
            source: s,
            external: s.kind === 'ext' ? s.external : s.kind === 'bili' ? s.room.biliUrl : null,
          })),
          sources[0].id
        );
        p.opts.onSource = (item) => {
          const s = item.source;
          if (!s) return;
          if (s.kind === 'ext' || item.external) {
            const w = window.open(item.external || s.external, '_blank', 'noopener');
            if (!w) toast('浏览器拦截了新标签，请允许弹窗后重试');
            return;
          }
          applySource(s);
        };
      }
    }

    // 注意：left 已在创建 Player 之后挂进 hero，这里再 append 会把它移到末尾、
    // 导致左右两列颠倒。

    // 没有可用直播时：给出下一场倒计时，别只丢一句「暂无直播」
    if (!main) {
      const next = await nextFixture();
      if (next) {
        const ts = new Date(String(next.date).replace(/-/g, '/')).getTime();
        const cd = el('div', { class: 'next-fixture' });
        cd.appendChild(el('div', { class: 'nf-label', text: '下一场比赛' }));
        cd.appendChild(
          el('div', { class: 'nf-teams' }, [
            el('span', { class: 'nf-team', text: next.teamA }),
            el('span', { class: 'nf-vs', text: 'vs' }),
            el('span', { class: 'nf-team', text: next.teamB }),
          ])
        );
        cd.appendChild(
          el('div', { class: 'nf-meta', text: [next.game, next.phase, next.mode, next.date].filter(Boolean).join(' · ') })
        );
        const cdText = el('div', { class: 'nf-countdown' });
        cd.appendChild(cdText);
        const tick = () => {
          cdText.textContent = '距开赛 ' + fmtCountdown(ts);
        };
        tick();
        const timer = setInterval(tick, 1000);
        p._cleanups.push(() => clearInterval(timer));
        left.appendChild(cd);
      }
    }

    // B 站直播间入口（直播弹幕只能在 B 站自己的页面里看）
    const biliRoom = main && main.kind === 'bili' ? main.room : findBiliRoom('', '');
    if (biliRoom) {
      left.appendChild(
        el('div', { style: { marginTop: '12px' } }, [
          el('button', {
            class: 'ctrl-btn',
            style: {
              padding: '9px 16px',
              border: '1px solid var(--border)',
              background: 'var(--surface)',
              color: 'var(--text)',
            },
            html: ICON.danmaku + '<span>在新标签打开B站直播间看实时弹幕</span>',
            onclick: () => {
              const w = window.open(biliRoom.biliUrl || 'https://live.bilibili.com/' + biliRoom.roomid, '_blank', 'noopener');
              if (!w) toast('浏览器拦截了新标签，请允许弹窗后重试');
            },
          }),
        ])
      );
    }

    // 注意：侧栏已在 applySource() 内渲染过一次，这里不要重复追加
    // （重复追加会让「比赛信息卡片」在页面上出现两组完全相同的内容）
    if (isStaleRender(seq)) return; // 过期渲染不许挂载，否则会盖掉新渲染的内容
    view.appendChild(hero);

    // 线路卡片：分两组 —— 本站直连 / 平台官方直播间（更高画质）
    const inlineSources = sources.filter((s) => s.kind !== 'ext');
    const extSources = sources.filter((s) => s.kind === 'ext');
    const syncSources = (curId) =>
      p.setSources(
        sources.map((x) => ({
          id: x.id,
          name: x.name,
          sub: x.sub,
          source: x,
          external: x.kind === 'ext' ? x.external : x.kind === 'bili' && x.expired ? x.room.biliUrl : null,
        })),
        curId
      );
    const mkCard = (s) =>
      el('div', {
        class: 'card' + (s.id === (main && main.id) ? ' on' : ''),
        'data-kind': s.kind,
        onclick: () => {
          if (s.kind === 'ext') {
            const w = window.open(s.external, '_blank', 'noopener');
            if (!w) toast('浏览器拦截了新标签，请允许弹窗后重试');
            return;
          }
          applySource(s);
          syncSources(s.id);
        },
      }, [
        el('div', { class: 'card-cover' + (s.cover ? ' has-shot' : '') }, [
          s.cover
            ? el('img', {
                class: 'shot',
                src: s.cover,
                alt: '',
                loading: 'lazy',
                onerror: (e) => {
                  e.target.style.display = 'none';
                },
              })
            : el('div', { class: 'shot-fallback', text: (s.platform || '直播') + ' 直播间' }),
          el('span', { class: 'card-hd ' + platClass(s.platform), text: s.kind === 'bili' ? (s.room.stream ? qnToRes(s.room.stream.qn) : s.platform) : s.platform }),
        ]),
        el('div', { class: 'card-body' }, [
          el('div', { class: 'card-title', text: s.name }),
          el('div', { class: 'card-meta' }, [
            el('span', { text: s.sub || '—' }),
            el('span', { text: s.kind === 'ext' ? '新标签打开' : fmtPopularity(s.viewers) + ' 人气' }),
          ]),
          // B 站站内直连的清晰度受「未登录」限制（每房间 480P/720P 不等），
          // 官方播放器在登录态下能给原画/蓝光 —— 所以给每条 B 站线路都留一个官方出口。
          s.kind === 'bili' && s.room
            ? el('button', {
                class: 'card-jump',
                text: '官方原画 ↗',
                title: '在新标签打开 B 站官方直播间（登录后可选原画/蓝光）',
                onclick: (e) => {
                  e.stopPropagation();
                  const w = window.open(s.room.biliUrl || 'https://live.bilibili.com/' + s.room.roomid, '_blank', 'noopener');
                  if (!w) toast('浏览器拦截了新标签，请允许弹窗后重试');
                },
              })
            : null,
        ]),
      ]);

    if (inlineSources.length > 1) {
      view.appendChild(
        el('div', { class: 'section-head' }, [
          el('h2', { text: '本站直连直播线路' }),
          el('span', { text: '画面在本页播放，清晰度/倍速/音量由本站播放器控制' }),
        ])
      );
      const grid = el('div', { class: 'grid' });
      inlineSources.forEach((s) => grid.appendChild(mkCard(s)));
      view.appendChild(grid);
    }
    if (extSources.length) {
      view.appendChild(
        el('div', { class: 'section-head' }, [
          el('h2', { text: '平台官方直播间（更高画质）' }),
          el('span', { text: '原画 1080P / 蓝光 / 4K 档位，由平台播放器提供' }),
        ])
      );
      const grid2 = el('div', { class: 'grid' });
      extSources.forEach((s) => grid2.appendChild(mkCard(s)));
      view.appendChild(grid2);
    }

    renderLiveStrip(sources);
  }

  /** 直播页右侧信息面板 */
  function liveSourcePanel(source, inf) {
    const side = el('div', { class: 'side side-panel' });
    side.appendChild(el('div', { class: 'side-title', text: inf.title }));
    const rows = el('div', { class: 'side-rows' });
    const addRow = (k, v) =>
      rows.appendChild(el('div', { class: 'side-row' }, [el('span', { class: 'k', text: k }), el('span', { class: 'v', text: v })]));
    if (source && source.kind === 'bili') {
      addRow('平台', '哔哩哔哩（站内直连）');
      addRow('房间号', String(source.room.roomid));
      addRow('房间人气', fmtPopularity(source.room.online) + (source.room.attention ? '（关注 ' + fmtPopularity(source.room.attention) + '）' : ''));
      addRow('清晰度', source.room.stream ? source.room.stream.qnName || '高清' : '源未就绪');
      addRow(
        '流地址',
        source.expired
          ? '已过期（需重新获取）'
          : '有效 · 约 ' + Math.max(0, Math.round(((source.room.stream.expires || 0) - Date.now() / 1000) / 60)) + ' 分钟后更新'
      );
      addRow('弹幕', 'B 站直播间（新标签打开）');
      side.appendChild(
        el('div', {
          class: 'notice',
          text:
            '「清晰度」菜单里是各路直播间的实际码率档位：B 站对未登录访客按房间授权不同码率，' +
            '主直播间常见 480P，二路/赛事直播间可达 720P。切换档位会切到另一个房间，' +
            '不同房间可能转播不同场次（菜单里标了房间号与标题）。',
        })
      );
    } else if (source && source.kind === 'ext') {
      addRow('平台', source.platform);
      addRow('入口', source.sub);
      addRow('说明', '点击后在新标签打开官方直播间');
      addRow('清晰度/音量', '由平台官方播放器提供');
    } else if (source) {
      const m = source.live.match;
      addRow('平台', '腾讯 LPL 官方地址');
      if (m) {
        addRow('赛事', m.GameName || '—');
        addRow('阶段', m.GameProcName || '—');
        addRow('赛制', m.GameModeName || '—');
      }
      addRow('观看人数', (source.live.viewers || 0).toLocaleString());
      addRow('可用清晰度', source.streams.map((s) => s.name).join(' / '));
      addRow('状态', source.healthy ? '直播中' : '当前未开播（常驻房间无信号）');
      addRow('弹幕', 'B 站直播间（新标签打开）');
    } else {
      addRow('来源', '暂无');
      addRow('说明', '赛事休赛期间，可到录像库观看往期比赛');
    }
    side.appendChild(rows);
    side.appendChild(
      el('div', {
        class: 'notice',
        text:
          '直播画面由哔哩哔哩赛事直播间（HLS 直连）与腾讯 LPL 官方公开地址直连播放，均在本页内播放，' +
          '清晰度、倍速、音量由本站播放器控制。' +
          '斗鱼 / 虎牙等平台的流地址接口不开放跨域（且官方播放器不允许被第三方页面内嵌，实测 iframe 内不拉流），' +
          '因此以「新标签打开官方直播间」的方式提供，其清晰度与音量由平台自己的播放器提供。' +
          '直播弹幕只在 B 站自己的播放器里可见；录像弹幕则完整叠加在本站播放器上。',
      })
    );
    return side;
  }
  function renderLiveStrip(sources) {
    const strip = $('#live-strip');
    if (!strip) return;
    if (!sources || !sources.length) {
      strip.hidden = true;
      return;
    }
    strip.hidden = false;
    strip.innerHTML = '';
    const inner = el('div', { class: 'live-strip-inner' });
    // 只有真正有信号的源才算「正在直播」
    // 腾讯常驻僵尸房（healthy=false）虽然有 streams，但实际无信号，不能进通知条
    const liveSources = sources.filter(
      (s) => s.kind !== 'ext' && s.playable && !(s.kind === 'tx' && !s.healthy)
    );
    inner.appendChild(
      el('span', { class: 'strip-label' }, [
        el('span', { class: 'dot-live' }),
        liveSources.length ? '正在直播' : '暂无直播信号',
      ])
    );
    liveSources.forEach((s) => {
      const q =
        s.kind === 'bili'
          ? s.room && s.room.stream
            ? (s.room.stream.qnName || '高清') + ' ' + qnToRes(s.room.stream.qn)
            : '源未就绪'
          : s.streams && s.streams[0]
          ? s.streams[0].name
          : '';
      // 只给「平台 + 清晰度」这种短信息，完整房间标题放 title 里 hover 看。
      // 之前把长标题塞进通知条，结果既溢出又被裁成半截。
      inner.appendChild(
        el('a', {
          class: 'strip-item',
          href: '#/live',
          text: (s.platform || '') + ' · ' + q,
          title: (s.name || '') + '（房间 ' + (s.room ? s.room.roomid : '-') + '）',
        })
      );
    });
    strip.appendChild(inner);
  }

  /** 直播弹幕房间映射 + 其它平台官方直播间入口（构建期烘焙） */
  let biliRooms = [];
  let externalRooms = [];
  let txCovers = {};
  /** 直播源快照的更新时间（用于判断「刷新直播源」有没有拿到新数据） */
  let liveRoomsUpdatedAt = '';
  async function ensureBiliRooms(force) {
    if (biliRooms.length && !force) return biliRooms;
    const r = await loadDataFile('liverooms', force);
    const j = r.json;
    if (j) {
      // 兼容两种格式：旧版是数组，新版是 {rooms:[...], currentMatch, externalRooms, txCovers}
      biliRooms = Array.isArray(j) ? j : (j.rooms || []);
      externalRooms = Array.isArray(j) ? [] : (j.externalRooms || []);
      txCovers = Array.isArray(j) ? {} : (j.txCovers || {});
      liveRoomsUpdatedAt = j.updatedAt || '';
    } else {
      biliRooms = [];
    }
    return biliRooms;
  }

  /** 从 "BLG : MKOI" / "【直播】BLG vs MKOI" 中提取标准化队伍组合 */
  function teamKey(s) {
    const m = String(s || '')
      .toUpperCase()
      .match(/([A-Z][A-Z0-9]{1,7})\s*(?:VS|V\.S\.|[:：]|–)\s*([A-Z][A-Z0-9]{1,7})/);
    if (!m) return null;
    return [m[1], m[2]].sort().join('-');
  }

  /** 赛事关键词：用于匹配没有队伍名的二路 / 4K 直播间 */
  function eventKey(s) {
    const t = String(s || '');
    if (/全球总决赛|世界赛/i.test(t)) return 'worlds';
    if (/德玛西亚杯/i.test(t)) return 'demacia';
    if (/职业联赛|LPL/i.test(t)) return 'lpl';
    return null;
  }

  function findBiliRoom(text, eventHint) {
    // 正在直播的房间优先
    const sorted = biliRooms.slice().sort((a, b) => (b.live ? 1 : 0) - (a.live ? 1 : 0));
    // 赛事分区优先（正片 > 散户复盘）
    const byArea = sorted.slice().sort((a, b) => {
      const ea = /赛事/.test(a.area || '') ? 1 : 0;
      const eb = /赛事/.test(b.area || '') ? 1 : 0;
      if (ea !== eb) return eb - ea;
      return 0;
    });
    const key = teamKey(text);
    if (key) {
      const exact = sorted.find((r) => teamKey(r.title) === key);
      if (exact) return exact;
    }
    // 退而求其次：同赛事的二路 / 4K 直播间
    const ev = eventKey(text) || eventKey(eventHint);
    if (ev) {
      const alt =
        sorted.find((r) => eventKey(r.title) === ev && /二路|4K|多路|副/i.test(r.title)) ||
        sorted.find((r) => eventKey(r.title) === ev);
      if (alt) return alt;
    }
    // 再退一步：只要有正在直播的赛事房间就用它
    const anyLive = byArea.find((r) => r.live) || sorted.find((r) => r.live) || byArea[0] || sorted[0];
    return anyLive || null;
  }

  /* ---------------- 录像库 ---------------- */
  const vodState = { season: '', team: '', q: '', page: 1, per: 24 };

  async function renderVod() {
    const seq = beginRender();
    setNav('vod');
    loading('正在加载录像库…');
    // 后台探测到更新的远端数据时自动重绘（录像目录也会随 CI 更新）
    onRemoteUpgrade(() => {
      if (location.hash.indexOf('#/vod') !== 0) return; // 已经离开录像库
      Repo.catalog = null; // 丢掉本地缓存，让下一次 load 取更新的那份
      renderVod();
    });
    let cat;
    try {
      cat = await Repo.load();
    } catch (e) {
      errorState('录像库加载失败', e.message, () => renderVod());
      return;
    }

    const seasons = Array.from(new Set(cat.matches.map((m) => m.game).filter(Boolean)));
    const teams = Array.from(new Set(cat.matches.map((m) => m.teamA).concat(cat.matches.map((m) => m.teamB)).filter(Boolean)));
    teams.sort();

    if (vodState.season && !seasons.includes(vodState.season)) vodState.season = '';

    // 合并「官方最新发布」—— 运行时直连腾讯官方内容接口，
    // 让主列表本身就是最新的（而不是另开一个板块）。
    const feed = await ensureOfficialFeed();
    const feedItems = feed.map((f) => ({
      id: f.id,
      title: f.title,
      game: '官方发布',
      phase: '',
      mode: '',
      date: f.date,
      duration: f.duration,
      cover: f.cover,
      teamA: '',
      teamB: '',
      score: '',
      place: '',
      comments: 0,
      bvid: null,
      cid: null,
      dmCount: 0,
      official: true,
      author: f.author,
    }));

    const all = feedItems.concat(cat.matches);
    const filtered = all.filter((m) => {
      if (vodState.season && m.game !== vodState.season) return false;
      if (vodState.team && m.teamA !== vodState.team && m.teamB !== vodState.team) return false;
      if (vodState.q) {
        const q = vodState.q.toLowerCase();
        const hay = (m.title + ' ' + m.game + ' ' + m.teamA + ' ' + m.teamB).toLowerCase();
        if (hay.indexOf(q) === -1) return false;
      }
      return true;
    });
    // 按时间倒序：官方最新发布的条目自然排在最前
    filtered.sort((a, b) => ((b.date || '') > (a.date || '') ? 1 : (b.date || '') < (a.date || '') ? -1 : 0));

    if (isStaleRender(seq)) return;
    view.innerHTML = '';
    const head = el('div', { class: 'section-head' }, [
      el('h2', { text: '录像库' }),
      el('span', { text: '官方最新内容为运行时直连（实时）· 比赛回放目录随赛程快照更新' }),
      el('span', {
        class: 'updated-at',
        // 用「上次核对上游的时间」（version.json），不用目录自身的 updatedAt ——
        // 目录内容没变时它不会动，但数据其实刚核对过。
        text: '回放快照 ' + fmtSnapshotTime(Repo.refreshedAt || cat.updatedAt),
      }),
    ]);
    view.appendChild(head);

    const filters = el('div', { class: 'filters' });
    const selSeason = el('select', {
      onchange: (e) => {
        vodState.season = e.target.value;
        vodState.page = 1;
        renderVod();
      },
    });
    selSeason.appendChild(el('option', { value: '', text: '全部赛事' }));
    seasons.forEach((s) => selSeason.appendChild(el('option', { value: s, text: s, selected: s === vodState.season })));
    filters.appendChild(el('label', { text: '赛事' }));
    filters.appendChild(selSeason);

    const selTeam = el('select', {
      onchange: (e) => {
        vodState.team = e.target.value;
        vodState.page = 1;
        renderVod();
      },
    });
    selTeam.appendChild(el('option', { value: '', text: '全部战队' }));
    teams.forEach((t) => selTeam.appendChild(el('option', { value: t, text: t, selected: t === vodState.team })));
    filters.appendChild(el('label', { text: '战队' }));
    filters.appendChild(selTeam);

    const inp = el('input', {
      type: 'search',
      placeholder: '搜索标题 / 战队',
      value: vodState.q,
      style: { width: '190px' },
      oninput: (e) => {
        vodState.q = e.target.value;
        vodState.page = 1;
        clearTimeout(vodState._t);
        vodState._t = setTimeout(renderVod, 320);
      },
    });
    filters.appendChild(inp);
    filters.appendChild(el('span', { class: 'count', text: '共 ' + filtered.length + ' 场 · 数据更新于 ' + (Repo.refreshedAt || cat.updatedAt || '—') }));
    view.appendChild(filters);

    const grid = el('div', { class: 'grid' });
    const pageItems = filtered.slice(0, vodState.page * vodState.per);
    pageItems.forEach((m) => grid.appendChild(vodCard(m)));
    view.appendChild(grid);

    if (filtered.length > pageItems.length) {
      view.appendChild(
        el('div', { style: { textAlign: 'center', marginTop: '24px' } },
          el('button', {
            class: 'ctrl-btn',
            style: { padding: '10px 26px', border: '1px solid var(--border)', background: 'var(--surface)' },
            text: '加载更多（还有 ' + (filtered.length - pageItems.length) + ' 场）',
            onclick: () => {
              vodState.page++;
              renderVod();
            },
          })
        )
      );
    }
  }

  function vodCard(m) {
    const cover = m.cover ? m.cover.replace(/^http:/, 'https:') : '';
    const kids = [];
    if (cover) kids.push(el('img', { src: cover, alt: m.title, loading: 'lazy' }));
    kids.push(el('div', { class: 'ovl' }));
    if (m.hd) kids.push(el('span', { class: 'card-hd', text: m.hd }));
    if (m.official) kids.push(el('span', { class: 'card-dm', text: '官方' }));
    else if (m.dmCount > 0) kids.push(el('span', { class: 'card-dm', text: '弹幕 ' + m.dmCount }));
    if (m.duration) kids.push(el('span', { class: 'card-dur', text: fmtDur(m.duration) }));
    return el('div', {
      class: 'card',
      'data-id': m.id,
      'data-cid': m.cid || '',
      'data-dm': String(m.dmCount || 0),
      onclick: () => (location.hash = '#/watch/' + m.id),
    }, [
      el('div', { class: 'card-cover' }, kids),
      el('div', { class: 'card-body' }, [
        el('div', { class: 'card-title', text: m.title }),
        el('div', { class: 'card-teams' }, [
          m.teamA ? el('span', { class: 'chip', text: m.teamA }) : null,
          m.teamB ? el('span', { class: 'chip', text: m.teamB }) : null,
          m.game ? el('span', { style: { color: 'var(--text-faint)' }, text: m.game }) : null,
        ]),
        el('div', { class: 'card-meta' }, [
          el('span', { text: m.date || '' }),
          m.phase ? el('span', { text: m.phase }) : null,
          // 来源标注：主播放源是腾讯点播（官方、多档清晰度），
          // B 站是同一场的同源录像（本站叠弹幕），点播/宣传片则来自官方内容流。
          m.official
            ? el('span', { class: 'src-tag tx', text: '官方发布' })
            : el('span', { class: 'src-tag tx', text: '腾讯点播' }),
          m.bvid ? el('span', { class: 'src-tag bili', text: 'B站同源' }) : null,
        ]),
      ]),
    ]);
  }

  /* ---------------- 播放页 ---------------- */
  async function renderWatch(id) {
    const seq = beginRender();
    setNav('vod');
    loading('正在获取播放地址…');
    let cat;
    try {
      cat = await Repo.load();
    } catch (e) {
      errorState('加载失败', e.message, () => renderWatch(id));
      return;
    }
    let m = cat.matches.find((x) => x.id === id);
    if (!m) {
      // 官方最新发布里的视频不在烘焙目录中，运行时补一个条目
      const feed = await ensureOfficialFeed();
      const f = feed.find((x) => x.id === id);
      if (!f) {
        errorState('未找到该录像', '它可能不在当前数据集中，请返回录像库浏览。');
        return;
      }
      m = {
        id: f.id,
        title: f.title,
        cover: f.cover,
        duration: f.duration,
        date: f.date,
        game: '官方发布',
        phase: '',
        teamA: '',
        teamB: '',
        score: '',
        cid: null,
        dmCount: 0,
      };
    }

    if (isStaleRender(seq)) return;
    view.innerHTML = '';
    const wrap = el('div', { class: 'watch' });
    const left = el('div');
    left.appendChild(el('a', { class: 'backlink', href: '#/vod', html: ICON.back + ' 返回录像库' }));
    const playerHost = el('div', { class: 'player-16-9' });
    left.appendChild(playerHost);
    const p = new Player(playerHost, { mode: 'vod' });
    activePlayer = p;
    p.setSpeed(1);
    p.renderSpeedMenu();
    p.renderDmMenu();

    const tags = el('div', { class: 'tags' });
    tags.appendChild(el('span', { class: 'badge badge-vod', text: '录像' }));
    tags.appendChild(el('span', { class: 'badge badge-hd', text: '多档清晰度' }));
    if (m.cid) tags.appendChild(el('span', { class: 'badge badge-dm', text: 'B站弹幕' }));
    p.tags.appendChild(tags);

    // 弹幕引擎
    const dm = new DanmakuEngine(p.dmLayer, {});
    p.mountDanmaku(dm);
    p.renderDmMenu();

    left.appendChild(el('div', { style: { marginTop: '12px' } }, [
      el('h1', { class: 'watch-title', text: m.title }),
      el('div', { class: 'watch-meta' }, [
        el('span', { text: m.date || '' }),
        m.game ? el('span', { text: m.game }) : null,
        m.phase ? el('span', { text: m.phase }) : null,
        m.bvid ? el('span', { text: 'B站源：' + m.bvid }) : null,
      ]),
    ]));

    // 备用源：同一场的 B 站同源录像（可能清晰度更高、弹幕更热闹）；
    // 没有同源时给一个 B 站搜索入口 —— 任何一场录像都能找到去处。
    const pairKw = [m.teamA, m.teamB].filter(Boolean).join(' ');
    const biliAltUrl = m.bvid
      ? 'https://www.bilibili.com/video/' + m.bvid + (m.biliPage > 1 ? '?p=' + m.biliPage : '')
      : 'https://search.bilibili.com/all?keyword=' +
        encodeURIComponent((pairKw || m.title || '').trim());
    left.appendChild(
      el('div', { class: 'watch-alt' }, [
        el('button', {
          class: 'ctrl-btn',
          text: m.bvid ? 'B站同源录像 ↗' : '在 B 站搜索这场 ↗',
          onclick: () => {
            const w = window.open(biliAltUrl, '_blank', 'noopener');
            if (!w) toast('浏览器拦截了新标签，请允许弹窗后重试');
          },
        }),
        el('span', {
          class: 'wa-note',
          text: m.bvid ? '同一场比赛的 B 站录像（清晰度/弹幕以 B 站为准）' : '本站暂无 B 站同源，可到 B 站搜同名录像',
        }),
      ])
    );

    wrap.appendChild(left);

    const side = el('div', { class: 'watch-side' });
    const panel = el('div', { class: 'panel' });
    panel.appendChild(el('h3', { text: '播放信息' }));
    const kv = el('div', { class: 'kv' });
    const addKv = (k, v) => kv.appendChild(el('div', { class: 'kv-row' }, [el('span', { class: 'k', text: k }), el('span', { class: 'v', text: v })]));
    addKv('赛事', m.game || '—');
    addKv('战队', [m.teamA, m.teamB].filter(Boolean).join(' vs ') || '—');
    addKv('阶段', m.phase || '—');
    addKv('时长', m.duration ? fmtDur(m.duration) : '—');
    addKv('弹幕', m.dmCount > 0 ? '已加载 ' + m.dmCount + ' 条' : '暂无 B 站弹幕');
    panel.appendChild(kv);
    side.appendChild(panel);

    const tip = el('div', { class: 'panel' });
    tip.appendChild(el('h3', { text: '快捷键' }));
    const kv2 = el('div', { class: 'kv' });
    [['空格 / K', '播放 / 暂停'], ['← →', '快退 / 快进 10 秒'], ['↑ ↓', '音量'], ['M', '静音'], ['F', '全屏'], ['D', '弹幕开关']].forEach(([k, v]) =>
      kv2.appendChild(el('div', { class: 'kv-row' }, [el('span', { class: 'k', text: k }), el('span', { class: 'v', text: v })]))
    );
    tip.appendChild(kv2);
    side.appendChild(tip);
    wrap.appendChild(side);
    if (isStaleRender(seq)) return; // 过期渲染不许挂载（否则会盖掉新渲染的播放页）
    view.appendChild(wrap);

    // 取播放地址（腾讯生成 vkey 偶尔超时，重试一次再放弃）
    const defn = 'shd';
    let info;
    try {
      info = normalizeVod(await fetchVodWithRetry(m.id, defn), defn);
    } catch (e) {
      p.showMsg('无法获取播放地址：' + e.message + '，请点击重试', true);
      return;
    }
    p.playVod(info.url, info);
    p.setQualities(
      [
        { name: '高清 720P', sub: '720P', defn: 'shd' },
        { name: '标清 480P', sub: '480P', defn: 'hd' },
      ],
      '高清 720P'
    );
    p.opts.onQuality = async (q) => {
      toast('正在切换到 ' + q.name + '…');
      try {
        const inf = normalizeVod(await API.vod(m.id, q.defn), q.defn);
        const t = p.video.currentTime;
        p.playVod(inf.url, inf);
        p.video.addEventListener('loadedmetadata', function once() {
          p.video.removeEventListener('loadedmetadata', once);
          if (isFinite(t)) p.video.currentTime = t;
        });
        toast('已切换到 ' + q.name);
      } catch (err) {
        toast('切换失败：' + err.message);
      }
    };

    // 加载弹幕
    if (m.cid) {
      let dj = null;
      try {
        const res = await fetch('data/dm/' + m.cid + '.json', { cache: 'no-cache' });
        if (res.ok) dj = await res.json();
      } catch (e) {
        /* 本地无弹幕数据，继续试远端 */
      }
      // 远端数据源里可能带着更新的弹幕（新比赛在 CI 重建后才抓到）
      if (!dj && REMOTE_DATA_BASE) dj = await fetchJson(REMOTE_DATA_BASE + '/dm/' + m.cid + '.json', 6000);
      if (dj) {
        try {
          dm.load(dj.items || []);
          dm.seek(p.video.currentTime || 0);
          p.setDanmaku(true);
          p.renderDmMenu();
          window.__dm = dm; // 调试钩子
        } catch (e) {
          /* 无弹幕数据，忽略 */
        }
      }
    }
  }

  /* ---------------- 赛程页（官方卡片风格） ---------------- */
  const schedState = { game: '', status: '' };

  function dayKeyOf(dateStr) {
    return (dateStr || '').slice(0, 10);
  }
  function dayLabel(dateStr) {
    const d = dayKeyOf(dateStr);
    if (!d) return { md: '—', wd: '' };
    const dt = new Date(d.replace(/-/g, '/'));
    const wd = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][dt.getDay()];
    return { md: dt.getMonth() + 1 + '月' + dt.getDate() + '日', wd: wd, y: dt.getFullYear() };
  }
  function timeOf(dateStr) {
    const s = dateStr || '';
    const m = s.match(/(\d{1,2}):(\d{2})/);
    return m ? m[1].padStart(2, '0') + ':' + m[2] : '';
  }

  /**
   * 用腾讯的实时直播列表覆盖赛程里的比分与状态。
   *
   * 为什么需要它：完整的赛程快照（含已结束比赛的比分）来自腾讯的
   * BMATCH_LIST.json —— 那是裸 JSON 且没有 CORS 头，浏览器读不到，
   * 只能构建期抓。而 `LOL_MATCH2_LIVE_BMATCH_LIST.js` 是
   * `var LiveBMatchList = {...}` 形式，可以跨域 <script> 加载，
   * 赛事进行时会给出**当前这场的对阵与实时比分**。
   * 所以它能保证「正在打的那场」比分是实时的，而不是构建期快照。
   */
  function overlayLiveMatches(list, liveMap) {
    const flat = [];
    Object.keys(liveMap || {}).forEach((k) => {
      const v = liveMap[k];
      if (Array.isArray(v)) v.forEach((x) => flat.push(x));
    });
    if (!flat.length) return 0;
    const norm = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    let n = 0;
    list.forEach((m) => {
      const hit = flat.find((x) => {
        const xd = String(x.MatchDate || '').slice(0, 10);
        const md = dayKeyOf(m.date);
        if (xd && md && xd !== md) return false;
        const a = norm(x.TeamNameA || x.TeamShortNameA);
        const b = norm(x.TeamNameB || x.TeamShortNameB);
        const ma = norm(m.teamA);
        const mb = norm(m.teamB);
        if (!a || !b || !ma || !mb) return false;
        const hitA = a === ma || a.includes(ma) || ma.includes(a);
        const hitB = b === mb || b.includes(mb) || mb.includes(b);
        return hitA && hitB;
      });
      if (!hit) return;
      m.live = true;
      m.score = (hit.ScoreA != null ? hit.ScoreA : 0) + ' : ' + (hit.ScoreB != null ? hit.ScoreB : 0);
      if (hit.MatchDate) m.date = hit.MatchDate;
      if (hit.GameProcName) m.phase = hit.GameProcName;
      n++;
    });
    return n;
  }

  async function renderSchedule() {
    const seq = beginRender();
    setNav('schedule');
    loading('正在加载赛程…');
    // 后台探测到更新的远端数据时自动重绘（赛程是「自动更新」的主角）
    onRemoteUpgrade(() => {
      if (location.hash.indexOf('#/schedule') !== 0) return; // 已经离开赛程页
      Repo.schedule = null; // 丢掉本地缓存，让下一次 load 取更新的那份
      renderSchedule();
    });
    let cat;
    let list;
    try {
      cat = await Repo.load();
      list = await Repo.loadSchedule();
    } catch (e) {
      errorState('赛程加载失败', e.message, () => renderSchedule());
      return;
    }
    if (isStaleRender(seq)) return;
    await ensureTeamLogos();
    if (isStaleRender(seq)) return;
    const now = Date.now();

    // 实时覆盖：正在进行的比赛用腾讯实时数据刷新比分（跨域可读，零构建期依赖）
    let liveOverlaid = 0;
    try {
      const lbm = await loadGlobalScript(LIVE_BMATCH_JS, 'LiveBMatchList').catch(() => null);
      if (lbm && lbm.msg) liveOverlaid = overlayLiveMatches(list, lbm.msg);
    } catch (e) {
      /* 覆盖失败就用构建期快照 */
    }
    if (isStaleRender(seq)) return;

    const filtered = list.filter((m) => {
      if (schedState.game && m.game !== schedState.game) return false;
      return true;
    });

    // 赛事列表按「该赛事的最新一场日期」倒序，默认展示最近的那个赛事
    const evMaxDate = new Map();
    list.forEach((m) => {
      if (!m.game) return;
      if (!evMaxDate.has(m.game) || (m.date || '') > (evMaxDate.get(m.game) || ''))
        evMaxDate.set(m.game, m.date || '');
    });
    const games = Array.from(evMaxDate.keys());
    games.sort((a, b) => ((evMaxDate.get(b) || '') > (evMaxDate.get(a) || '') ? 1 : -1));

    // ⚠️ 所有 await 必须在「清空 + 回填」之前完成 —— 否则并发渲染会交错，页面会留下重复内容
    const evInfos = await ensureEventInfo();
    if (isStaleRender(seq)) return;
    const curEvent = pickCurrentEvent(evInfos, list);
    const fresh = scheduleFreshness(Repo.scheduleMeta, list);

    view.innerHTML = '';
    const head = el('div', { class: 'section-head' }, [
      el('h2', { text: '赛事赛程' }),
      el('span', { text: '共 ' + list.length + ' 场 · 对阵图对齐腾讯 LPL 官方「赛事进度」' }),
      liveOverlaid ? el('span', { class: 'badge badge-live', text: '● ' + liveOverlaid + ' 场比分实时' }) : null,
      el('span', {
        class: 'updated-at' + (fresh.stale ? ' stale' : ''),
        text:
          '赛程快照 ' +
          fmtSnapshotTime(fresh.updatedAt) +
          '（' +
          fresh.ageLabel +
          '）' +
          (Repo.scheduleMeta && Repo.scheduleMeta.origin === 'remote' ? ' · 远端实时数据' : ''),
      }),
    ].filter(Boolean));
    view.appendChild(head);

    // 快照陈旧时必须说清楚：后续轮次的对阵可能已经变了（淘汰队伍还挂在赛程里就是这么来的）
    if (fresh.stale) {
      view.appendChild(
        el('div', { class: 'sched-stale' }, [
          el('span', { class: 'ss-icon', text: '!' }),
          el('div', { class: 'ss-text' }, [
            el('b', {
              text: fresh.missed
                ? '赛程快照落后于最新赛果（' + fresh.missed + ' 场已开打但快照里没有比分）'
                : '赛程快照已滞后 ' + fresh.ageLabel,
            }),
            el('p', {
              text:
                '腾讯的全量对阵表是裸 JSON 且没有跨域头，浏览器运行时读不到，只能构建期抓取快照。' +
                '因此未开打场次的对阵可能已经变化（被淘汰的队伍会从后续赛程里消失），下面这些场次已标为「待确认」。',
            }),
          ]),
          el('a', {
            class: 'ss-link',
            href: OFFICIAL_SCHEDULE_URL,
            target: '_blank',
            rel: 'noopener',
            text: '看腾讯官方对阵图 ↗',
          }),
        ])
      );
    }

    // 当前赛事（赛事名与起止日期来自腾讯的赛事元信息接口，运行时可读）
    if (curEvent) {
      view.appendChild(
        el('div', { class: 'sched-event-meta' }, [
          curEvent.logo
            ? el('img', { class: 'sem-logo', src: curEvent.logo, alt: curEvent.name, loading: 'lazy' })
            : null,
          el('span', { class: 'sem-name', text: curEvent.name }),
          el('span', { class: 'sem-range', text: (curEvent.start || '') + ' — ' + (curEvent.end || '') }),
        ].filter(Boolean))
      );
    }

    // 赛事选择（官方那种下拉）
    const picker = el('div', { class: 'sched-picker' });
    const sel = el('button', { class: 'select-btn', text: schedState.game || '全部赛事' });
    const list_ = el('ul', { class: 'select-list' });
    const closeList = () => list_.classList.remove('open');
    sel.addEventListener('click', (e) => {
      e.stopPropagation();
      list_.classList.toggle('open');
    });
    list_.appendChild(
      el('li', {
        class: schedState.game ? '' : 'active',
        text: '全部赛事',
        onclick: () => {
          schedState.game = '';
          closeList();
          renderSchedule();
        },
      })
    );
    games.forEach((g) =>
      list_.appendChild(
        el('li', {
          class: schedState.game === g ? 'active' : '',
          text: g,
          onclick: () => {
            schedState.game = g;
            closeList();
            renderSchedule();
          },
        })
      )
    );
    picker.appendChild(sel);
    picker.appendChild(list_);
    document.addEventListener('click', closeList, { once: true });
    view.appendChild(picker);

    // 「今天起」速览：对阵图是按轮次排的，用户最先想知道的其实是「今天有哪几场」。
    // 比分已经被腾讯实时数据覆盖过，这里直接按时间顺序铺开。
    const todayStr = (() => {
      const d = new Date();
      return (
        d.getFullYear() +
        '-' +
        String(d.getMonth() + 1).padStart(2, '0') +
        '-' +
        String(d.getDate()).padStart(2, '0')
      );
    })();
    const soonList = list
      .filter((m) => m.date && m.teamA && m.teamB && !/^D\d/i.test(m.teamA))
      .filter((m) => dayKeyOf(m.date) >= todayStr)
      .sort((a, b) => (a.date || '').localeCompare(b.date || ''))
      .slice(0, 10);
    if (soonList.length) {
      const box = el('div', { class: 'sched-soon' });
      box.appendChild(el('h3', { class: 'ss-title', text: '今天起的赛程' }));
      const ul = el('ul', { class: 'soon-list' });
      soonList.forEach((m) => {
        const li = el('li', { class: 'soon-row' + (m.live ? ' is-live' : '') });
        const d = dayLabel(m.date);
        li.appendChild(el('span', { class: 'soon-day', text: d.md + (d.wd ? ' ' + d.wd : '') }));
        li.appendChild(el('span', { class: 'soon-time', text: timeOf(m.date) }));
        const a = teamByTeamId(m.teamIdA, m.teamA);
        const b = teamByTeamId(m.teamIdB, m.teamB);
        li.appendChild(el('span', { class: 'soon-team', text: a.name || m.teamA }));
        li.appendChild(el('span', { class: 'soon-score', text: m.score || '0 : 0' }));
        li.appendChild(el('span', { class: 'soon-team b', text: b.name || m.teamB }));
        if (m.live) {
          li.appendChild(el('span', { class: 'soon-live', text: '直播中' }));
        } else if (m.id) {
          li.appendChild(el('button', {
            class: 'soon-play',
            text: '▶ 录播',
            onclick: (e) => {
              e.stopPropagation();
              location.hash = '#/watch/' + m.id;
            },
          }));
        } else if (m.bvid) {
          li.appendChild(el('button', {
            class: 'soon-play bili',
            text: 'B站录播',
            onclick: (e) => {
              e.stopPropagation();
              const pg = m.biliPage > 1 ? '?p=' + m.biliPage : '';
              window.open('https://www.bilibili.com/video/' + m.bvid + pg, '_blank', 'noopener');
            },
          }));
        }
        ul.appendChild(li);
      });
      box.appendChild(ul);
      view.appendChild(box);
    }

    // 赛事进度（对齐官方 event.html?tabId=progress）：轮次分列 + 对阵行
    const seriesMap = new Map();
    let tbdIdx = 0;
    list.forEach((m) => {
      const hasTeams = !!(m.teamA && m.teamB && !/^D\d/i.test(m.teamA));
      const key = hasTeams
        ? m.game + '|' + [m.teamA, m.teamB].sort().join('-')
        : m.game + '|' + (m.phase || '') + '|TBD' + tbdIdx++;
      if (!seriesMap.has(key)) {
        seriesMap.set(key, {
          game: m.game,
          teamA: hasTeams ? m.teamA : '',
          teamB: hasTeams ? m.teamB : '',
          teamIdA: m.teamIdA || '',
          teamIdB: m.teamIdB || '',
          score: m.score || '0:0',
          mode: m.mode || '',
          phase: m.phase || '',
          date: m.date || '',
          id: m.id || '',
          bvid: m.bvid || '',
          biliPage: m.biliPage || 0,
          live: !!m.live,
          games: 0,
        });
      }
      const s2 = seriesMap.get(key);
      s2.games++;
      if (m.live) s2.live = true;
      const cur = String(s2.score || '0:0').split(':').map(Number);
      const alt = String(m.score || '0:0').split(':').map(Number);
      if ((alt[0] || 0) + (alt[1] || 0) > (cur[0] || 0) + (cur[1] || 0)) s2.score = m.score;
      if (!s2.id && m.id) s2.id = m.id;
      if (!s2.bvid && m.bvid) {
        s2.bvid = m.bvid;
        s2.biliPage = m.biliPage || 0;
      }
    });

    const ROUND_NAME = {
      第一天: '第1轮', 第二天: '第2轮', 第三天: '第3轮', 第四天: '第4轮',
      第五天: '第5轮', 第六天: '第6轮', 第七天: '第7轮', 第八天: '第8轮',
      四分之一决赛: '晋级', 半决赛: '半决赛', 决赛: '决赛',
    };
    const ROUND_ORDER = ['第1轮', '第2轮', '第3轮', '第4轮', '第5轮', '第6轮', '第7轮', '第8轮', '晋级', '半决赛', '决赛'];

    const bracket = el('div', { class: 'bracket' });
    const showEvents = schedState.game ? [schedState.game] : games.slice(0, 1);

    showEvents.forEach((ev) => {
      const rows = Array.from(seriesMap.values()).filter((s) => s.game === ev);
      if (!rows.length) return;
      const byRound = new Map();
      rows.forEach((s) => {
        const rn = ROUND_NAME[s.phase] || '第1轮';
        if (!byRound.has(rn)) byRound.set(rn, []);
        byRound.get(rn).push(s);
      });
      const cols = ROUND_ORDER.filter((r) => byRound.has(r)).map((r) => [r, byRound.get(r)]);
      // 未知阶段按日期顺序补在最后
      Object.keys(byRound).forEach((r) => {
        if (!ROUND_ORDER.includes(r)) cols.push([r, byRound.get(r)]);
      });

      const evBox = el('section', { class: 'bracket-event' });
      evBox.appendChild(
        el('h3', { class: 'bracket-event-title' }, [
          el('span', { text: ev }),
          el('small', { text: rows.length + ' 个系列赛' }),
        ])
      );
      const colsWrap = el('div', { class: 'bracket-cols' });
      cols.forEach(([rn, items]) => {
        const col = el('div', { class: 'bracket-col' });
        const done = items.filter((s) => s.score && s.score !== '0:0').length;
        col.appendChild(
          el('div', { class: 'bracket-round' }, [
            el('span', { class: 'round-name', text: rn }),
            el('span', { class: 'round-dots' }, items.map((s) => {
              const [a, b] = String(s.score || '0:0').split(':');
              const n = (Number(a) || 0) + (Number(b) || 0);
              return el('i', { class: 'dot' + (n > 0 ? ' on' : '') });
            })),
            el('span', { class: 'round-bo', text: items[0].mode || '' }),
          ])
        );
        const listEl = el('ul', { class: 'bracket-list' });
        items.forEach((s) => {
          const [sa, sb] = String(s.score || '0:0').split(':');
          const aWin = Number(sa) > Number(sb);
          const bWin = Number(sb) > Number(sa);
          const done2 = !!s.score && s.score !== '0:0';
          // 快照陈旧时，未开打场次的对阵可能已经变了（淘汰队伍还挂在赛程里就是这么来的）
          // —— 这种场次不再显示队名，标为「待确认」，宁可空着也不给错信息。
          const st = s.date ? new Date(String(s.date).replace(/-/g, '/')).getTime() : 0;
          const unconfirmed = fresh.stale && !done2 && !s.live && st > now - 2 * 3600000;
          const li = el('li', {
            class:
              'bracket-row' +
              (done2 ? ' done' : ' todo') +
              (s.live ? ' is-live' : '') +
              (unconfirmed ? ' unconfirmed' : ''),
          });
          if (s.live) li.title = '正在直播（比分实时更新）';
          const mkSide = (name, id, score, win) => {
            const side = el('span', { class: 'bside' + (win ? ' win' : '') });
            if (unconfirmed) {
              side.appendChild(el('span', { class: 'blogo ph', text: '?' }));
              side.appendChild(el('span', { class: 'babbr pending', text: '待确认' }));
              return side;
            }
            const info = teamByTeamId(id, name);
            const lg = info.logo;
            side.appendChild(lg
              ? el('img', { class: 'blogo', src: lg, alt: info.name, loading: 'lazy' })
              : el('span', { class: 'blogo ph', text: info.name ? '?' : '?' }));
            side.appendChild(el('span', { class: 'babbr', text: info.name || 'TBD' }));
            return side;
          };
          li.appendChild(mkSide(s.teamA, s.teamIdA, sa, aWin));
          li.appendChild(el('span', { class: 'bscore', text: done2 ? sa + ' : ' + sb : '0 : 0' }));
          li.appendChild(mkSide(s.teamB, s.teamIdB, sb, bWin));
          if (unconfirmed) {
            li.title = (s.date || '') + ' · 赛程快照已滞后，对阵待官方确认（点击官方对阵图核对）';
          }
          // 可看录播：腾讯有录像 → 站内播放页；只有 B 站源 → 新标签打开 B 站
          if (s.id) {
            li.classList.add('has-vod');
            li.appendChild(el('span', { class: 'bplay tx', text: '▶ 录播' }));
            li.addEventListener('click', () => (location.hash = '#/watch/' + s.id));
            li.title = (s.date || '') + ' · 点击看录播' + (s.games > 1 ? '（共 ' + s.games + ' 局）' : '');
          } else if (s.bvid) {
            li.classList.add('has-vod', 'bili-only');
            li.appendChild(el('span', { class: 'bplay bili', text: 'B站录播' }));
            li.addEventListener('click', () => {
              const pg = s.biliPage > 1 ? '?p=' + s.biliPage : '';
              window.open('https://www.bilibili.com/video/' + s.bvid + pg, '_blank', 'noopener');
            });
            li.title = (s.date || '') + ' · 腾讯录像尚未发布，点击到 B 站观看';
          } else {
            li.classList.add('no-vod');
            li.title = (s.date || '') + ' · 录像尚未发布';
          }
          listEl.appendChild(li);
        });
        col.appendChild(listEl);
        colsWrap.appendChild(col);
      });
      evBox.appendChild(colsWrap);

      // 赛事详情
      const dates = rows.map((s) => s.date).filter(Boolean).sort();
      const modes = {};
      rows.forEach((s) => { if (s.mode) modes[s.mode] = (modes[s.mode] || 0) + 1; });
      const detail = el('div', { class: 'bracket-detail' }, [
        el('div', { class: 'bd-box' }, [
          el('b', { text: ev }),
          el('span', { text: (dates[0] || '').slice(0, 10) + ' — ' + (dates[dates.length - 1] || '').slice(0, 10) }),
          el('span', { text: rows.length + ' 个系列赛 / ' + rows.reduce((a, s) => a + s.games, 0) + ' 局' }),
          el('span', { text: '赛制 ' + Object.keys(modes).map((k) => k + '×' + modes[k]).join(' ') }),
        ]),
      ]);
      evBox.appendChild(detail);
      bracket.appendChild(evBox);
    });
    view.appendChild(bracket);

    // 记录签名并开启轮询（比分实时刷新 + 定期重拉线上快照）
    lastSchedSig = schedSignature(list, liveOverlaid);
    startSchedulePoll();
  }

  /* ------------------------------------------------------------------ *
   * 运行时数据刷新：能由浏览器直连的一律在页面内直取，不依赖外部构建
   * ------------------------------------------------------------------ */
  let livePollTimer = null;

  /** 强制重新拉取所有运行时数据（直播 / 官方最新内容 / 队徽 / 直播间） */
  async function refreshRuntimeData(silent) {
    Repo.catalog = null;
    Repo.schedule = null;
    Repo.scheduleMeta = null;
    biliRooms = [];
    teamLogos = null;
    teamById = null;
    officialFeed = null;
    const btn = $('#refresh-btn');
    if (btn) btn.classList.add('spinning');
    try {
      await Promise.all([ensureOfficialFeed(), ensureTeamLogos(), ensureBiliRooms()]);
      if (!silent) toast('已重新拉取最新数据');
    } catch (e) {
      if (!silent) toast('刷新失败：' + e.message);
    } finally {
      if (btn) setTimeout(() => btn.classList.remove('spinning'), 600);
    }
  }

  /** 直播页自动轮询：线路与观看人数保持新鲜（不打断播放） */
  function startLivePoll(onUpdate) {
    stopLivePoll();
    livePollTimer = setInterval(async () => {
      if (document.hidden) return;
      try {
        const raw = await API.live();
        const list = normalizeLive(raw);
        if (list.length) onUpdate(list);
      } catch (e) {
        /* 网络抖动忽略 */
      }
    }, 45000);
  }

  function stopLivePoll() {
    if (livePollTimer) clearInterval(livePollTimer);
    livePollTimer = null;
  }

  /* ---------------- 赛程页自动刷新 ---------------- */
  let schedPollTimer = null;
  let lastSchedSig = '';

  /** 赛程页的内容签名：只有真的变了才重绘，避免打断用户滚动 */
  function schedSignature(list, overlaid) {
    const rows = (list || [])
      .map((m) => (m.date || '') + '|' + (m.teamA || '') + '|' + (m.teamB || '') + '|' + (m.score || ''))
      .join(';');
    return rows.length + '#' + rows.length + '#' + (overlaid || 0) + '#' + rows.slice(0, 400) + '#' + rows.slice(-400);
  }

  /**
   * 赛程页轮询：轻量实时比分（腾讯 LiveBMatchList，约 750 字节）每 30 秒拉一次；
   * 线上快照（schedule.json，约 390KB，部署端 Cache-Control: no-store 不可缓存）
   * 每 5 分钟才重拉一次。有变化才重绘，并保留滚动位置。
   * 这样赛程页也能像录像页一样「自己会更新」，又不会把带宽打满。
   */
  function startSchedulePoll() {
    stopSchedulePoll();
    let tick = 0;
    schedPollTimer = setInterval(async () => {
      if (document.hidden) return;
      tick++;
      const heavy = tick === 1 || tick % 10 === 0; // 进页后 30 秒先重拉一次，之后每 5 分钟
      try {
        const list = heavy ? await Repo.loadSchedule(true) : Repo.schedule || (await Repo.loadSchedule());
        let overlaid = 0;
        try {
          const lbm = await loadGlobalScript(LIVE_BMATCH_JS, 'LiveBMatchList', true).catch(() => null);
          if (lbm && lbm.msg) overlaid = overlayLiveMatches(list, lbm.msg);
        } catch (e) {
          /* 实时源失败不影响快照部分 */
        }
        const sig = schedSignature(list, overlaid);
        if (sig === lastSchedSig) return;
        lastSchedSig = sig;
        const y = window.scrollY;
        await renderSchedule();
        window.scrollTo(0, y);
      } catch (e) {
        /* 网络抖动忽略 */
      }
    }, 30000);
  }

  function stopSchedulePoll() {
    if (schedPollTimer) clearInterval(schedPollTimer);
    schedPollTimer = null;
  }

  /* ------------------------------------------------------------------ *
   * 6. 路由
   * ------------------------------------------------------------------ */
  function route() {
    const hash = location.hash || '#/live';
    const parts = hash.replace(/^#\/?/, '').split('/');
    const page = parts[0] || 'live';
    if (activePlayer) {
      try { activePlayer.destroy(); } catch (e) {}
      activePlayer = null;
    }
    stopLivePoll();
    stopSchedulePoll();
    ensureBiliRooms();
    if (page === 'vod') renderVod();
    else if (page === 'watch') renderWatch(parts[1]);
    else if (page === 'schedule') renderSchedule();
    else renderLive();
    window.scrollTo({ top: 0, behavior: 'instant' in window ? 'instant' : 'auto' });
  }

  window.addEventListener('hashchange', route);

  // 头部「刷新数据」：重新拉取所有运行时数据并重绘当前页
  $('#refresh-btn').addEventListener('click', async () => {
    await refreshRuntimeData(true);
    route();
    toast('已刷新：腾讯直播源 / 官方最新内容 / 队伍与赛程（录像与弹幕为构建期快照）');
  });

  // 回到顶部（页面较长，直播页尤其明显）
  const toTop = el('button', { class: 'to-top', 'aria-label': '回到顶部', title: '回到顶部', html: '↑' });
  document.body.appendChild(toTop);
  window.addEventListener(
    'scroll',
    () => {
      toTop.classList.toggle('show', window.scrollY > 600);
    },
    { passive: true }
  );
  toTop.addEventListener('click', () => window.scrollTo({ top: 0, behavior: 'smooth' }));

  // 顶部搜索：跳到录像库并带上关键词
  $('#search-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const q = $('#search-input').value.trim();
    vodState.q = q;
    vodState.season = '';
    vodState.page = 1;
    location.hash = '#/vod';
    if (location.hash === '#/vod') route();
  });

  $('#nav-toggle').addEventListener('click', () => {
    const nav = $('.nav');
    nav.style.display = nav.style.display === 'flex' ? 'none' : 'flex';
  });

  // 微信内置浏览器提示（微信会限制第三方页面能力，提示用户用系统浏览器）
  (function wxTip() {
    const ua = navigator.userAgent || '';
    if (!/MicroMessenger/i.test(ua)) return;
    const tip = $('#wx-tip');
    if (tip) tip.hidden = false;
    const close = $('#wx-close');
    if (close) {
      close.addEventListener('click', () => {
        tip.hidden = true;
        try {
          sessionStorage.setItem('lpltv_wx_tip', '1');
        } catch (e) {}
      });
    }
    try {
      if (sessionStorage.getItem('lpltv_wx_tip') === '1' && tip) tip.hidden = true;
    } catch (e) {}
  })();

  // 首屏
  route();
})();
