/* =====================================================================
 * probe-browser-sources.mjs — 浏览器侧数据源实测（无头）
 *
 * 为什么必须单独测：浏览器**不继承系统代理**，hosts 把 github/raw 指到
 * 127.0.0.1（Steam++/Watt Toolkit）→ Node 能通不代表浏览器能通。
 * 这个坑踩过：raw.githubusercontent.com 在 Chrome 里 fetch 立刻失败，
 * 而走系统代理的 PowerShell 却能通。
 *
 * 实测清单：
 *   1. 腾讯 LiveBMatchList（<script> 注入全局变量）
 *   2. 腾讯 LivingGames（同上）
 *   3. 腾讯 getMatchScheduleList JSONP → hlsUrl 三档
 *   4. 四个镜像站 fetch（gh-proxy / gcore / cdn.jsdelivr / raw.gh）
 *   5. B 站弹幕握手 token（JSONP）+ WebSocket 实收弹幕
 *   6. B 站直播间信息（标题/描述）
 *   7. 腾讯弹幕候选接口
 *
 * 用法：node tools/probe-browser-sources.mjs        （无头，默认）
 *       HEADED=1 node tools/probe-browser-sources.mjs（有头，仅调试）
 * ===================================================================== */
import http from 'node:http';
import { resolvePlaywright } from './resolve-playwright.mjs';

const { chromium } = resolvePlaywright().pw;
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';

function startServer() {
  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end('<!doctype html><html><head><meta charset="utf-8"><title>probe</title></head><body>probe</body></html>');
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }));
  });
}

const results = [];
function record(name, pass, detail) {
  results.push({ name, pass, detail });
  console.log(`  ${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
}

(async () => {
  const { server, port } = await startServer();
  const base = `http://127.0.0.1:${port}/`;
  console.log('探测页:', base, '\n');

  const browser = await chromium.launch({
    headless: process.env.HEADED !== '1',
    executablePath: CHROME,
    args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required', '--mute-audio'],
  });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  const netErrors = [];
  page.on('requestfailed', (r) => {
    netErrors.push(`${r.url().slice(0, 110)} :: ${(r.failure() || {}).errorText}`);
  });
  await page.goto(base, { waitUntil: 'domcontentloaded' });

  /* ---------- 1&2. 腾讯全局 JS（script 标签注入） ---------- */
  console.log('[1/2] 腾讯全局 JS（<script> 注入）');
  const globals = await page.evaluate(async () => {
    const load = (src, name) =>
      new Promise((resolve) => {
        const s = document.createElement('script');
        s.async = true;
        s.src = src + '?_=' + Date.now();
        s.onload = () => resolve(!!window[name]);
        s.onerror = () => resolve(false);
        document.head.appendChild(s);
      });
    const okLbm = await load('https://lpl.qq.com/web201612/data/LOL_MATCH2_LIVE_BMATCH_LIST.js', 'LiveBMatchList');
    const okLg = await load(
      'https://lpl.qq.com/web201612/data/LOL_NEWMATCH_LIVE_PAGE_LIVING_GAMES.js',
      'LivingGames'
    );
    const lbm = window.LiveBMatchList;
    const lg = window.LivingGames;
    const rows = lbm && lbm.msg ? Object.values(lbm.msg).filter((x) => typeof x === 'string' && x) : [];
    const fin = rows
      .map((r) => { try { return JSON.parse(r); } catch { return null; } })
      .filter(Boolean)
      .filter((r) => /GEN|BLG/i.test(JSON.stringify(r)));
    return {
      okLbm,
      okLg,
      lbmLastUp: lbm && lbm.lastUpTime,
      lbmRows: rows.length,
      final: fin[0] ? { a: fin[0].TeamNameA, sa: fin[0].ScoreA, b: fin[0].TeamNameB, sb: fin[0].ScoreB } : null,
      lgLast: lg && lg.msg && lg.msg.lastUpdateTime,
      lgTitleHead: lg && lg.msg && lg.msg.Title ? lg.msg.Title.split('#')[0] : '',
    };
  });
  console.log('   ', JSON.stringify(globals));
  record('浏览器可加载腾讯 LiveBMatchList 全局 JS', globals.okLbm, 'lastUpTime=' + globals.lbmLastUp);
  record('腾讯实时表含 GEN/BLG 决赛行', !!globals.final, JSON.stringify(globals.final));
  record('浏览器可加载腾讯 LivingGames', globals.okLg, 'lastUpdateTime=' + globals.lgLast);

  /* ---------- 3. 腾讯 JSONP：直播源三档 ---------- */
  console.log('\n[3] 腾讯 getMatchScheduleList JSONP');
  const tx = await page.evaluate(async () => {
    const jsonp = (url, params, timeout = 15000) =>
      new Promise((resolve, reject) => {
        const cb = '__probe_' + Date.now().toString(36);
        const merged = Object.assign({}, params, { callback: cb });
        const qs = Object.keys(merged).map((k) => encodeURIComponent(k) + '=' + encodeURIComponent(merged[k])).join('&');
        let done = false;
        const t = setTimeout(() => { if (!done) { done = true; reject(new Error('超时')); } }, timeout);
        window[cb] = (d) => { if (done) return; done = true; clearTimeout(t); resolve(d); };
        const s = document.createElement('script');
        s.async = true;
        s.onerror = () => { if (!done) { done = true; clearTimeout(t); reject(new Error('脚本加载失败')); } };
        s.src = url + '?' + qs;
        document.head.appendChild(s);
      });
    try {
      const p = await jsonp('https://lol.sw.game.qq.com/lol/commact/', {
        proj: 'a20200415livelink',
        c: 'a20200415livelink',
        a: 'getMatchScheduleList',
      });
      const list = (p && p.data && p.data.anchorList) || [];
      const out = list.map((a) => {
        const ei = a.extInfo || {};
        let gp = {};
        try { gp = JSON.parse(ei.gameProgram || '{}'); } catch (e) {}
        const si = (a.playInfo && a.playInfo.streamInfo) || [];
        return {
          anchorId: a.anchorInfo && a.anchorInfo.anchorId,
          subTitle: gp.subTitle,
          barrageSwitch: gp.barrageSwitch,
          streamSrc: gp.streamSrc,
          qualities: si.map((x) => ({ bitrate: x.bitrate, desc: x.desc, hls: (x.hlsUrl || '').slice(0, 60) })),
        };
      });
      return { ok: true, count: out.length, anchors: out };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });
  console.log('   ', JSON.stringify(tx).slice(0, 900));
  record('浏览器可取腾讯赛程 JSONP', tx.ok, tx.error || tx.count + ' 个锚点');
  const finalAnchor = (tx.anchors || []).find((a) => /GEN|BLG/i.test(a.subTitle || ''));
  record('腾讯 JSONP 含 GEN vs BLG 锚点', !!finalAnchor, finalAnchor ? finalAnchor.subTitle + ' 档位=' + finalAnchor.qualities.length : '');
  record('腾讯源提供多档清晰度 hlsUrl', !!finalAnchor && finalAnchor.qualities.length >= 2, (finalAnchor ? finalAnchor.qualities.map((q) => q.desc).join('/') : ''));

  /* ---------- 4. 镜像 fetch ---------- */
  console.log('\n[4] 镜像数据源（浏览器 fetch，注意浏览器不继承代理）');
  const mirrors = await page.evaluate(async () => {
    const bases = [
      ['gh-proxy', 'https://gh-proxy.com/https://raw.githubusercontent.com/fjt272033067/lpl-tv/main/site/data'],
      ['gcore', 'https://gcore.jsdelivr.net/gh/fjt272033067/lpl-tv@main/site/data'],
      ['cdn.jsdelivr', 'https://cdn.jsdelivr.net/gh/fjt272033067/lpl-tv@main/site/data'],
      ['raw.gh', 'https://raw.githubusercontent.com/fjt272033067/lpl-tv/main/site/data'],
    ];
    const out = [];
    for (const [name, base] of bases) {
      for (const file of ['schedule.json', 'liverooms.json']) {
        const t0 = performance.now();
        try {
          const res = await fetch(base + '/' + file, { cache: 'no-store' });
          const txt = await res.text();
          let info = '';
          try {
            const j = JSON.parse(txt);
            info = 'updatedAt=' + (j.updatedAt || '') + ' n=' + ((j.matches || j.rooms || []).length);
          } catch (e) { info = '非JSON len=' + txt.length; }
          out.push({ name, file, ok: res.ok, ms: Math.round(performance.now() - t0), status: res.status, info });
        } catch (e) {
          out.push({ name, file, ok: false, ms: Math.round(performance.now() - t0), error: e.message });
        }
      }
    }
    return out;
  });
  for (const m of mirrors) console.log(`   ${m.ok ? 'OK  ' : 'FAIL'} ${m.name}/${m.file} ${m.status || ''} ${m.ms}ms ${m.info || m.error || ''}`);
  const ghProxyOk = mirrors.filter((m) => m.name === 'gh-proxy' && m.ok).length;
  record('浏览器可 fetch 镜像（gh-proxy 至少 2 份）', ghProxyOk >= 2, ghProxyOk + '/2');
  record('浏览器至少 1 个镜像能取 liverooms.json', mirrors.some((m) => m.file === 'liverooms.json' && m.ok), mirrors.filter((m) => m.file === 'liverooms.json' && m.ok).map((m) => m.name).join(',') || '无');

  /* ---------- 5. B 站弹幕：握手 token + WebSocket 实收 ---------- */
  console.log('\n[5] B 站直播弹幕（JSONP token + WebSocket）');
  const bili = await page.evaluate(async () => {
    const roomId = 7734200;
    const jsonp = (url, params, timeout = 8000) =>
      new Promise((resolve, reject) => {
        const cb = '__probe_bili_' + Date.now().toString(36);
        const merged = Object.assign({}, params, { callback: cb, jsonp: 'jsonp' });
        const qs = Object.keys(merged).map((k) => encodeURIComponent(k) + '=' + encodeURIComponent(merged[k])).join('&');
        let done = false;
        const t = setTimeout(() => { if (!done) { done = true; reject(new Error('超时')); } }, timeout);
        window[cb] = (d) => { if (done) return; done = true; clearTimeout(t); resolve(d); };
        const s = document.createElement('script');
        s.async = true;
        s.onerror = () => { if (!done) { done = true; clearTimeout(t); reject(new Error('脚本失败')); } };
        s.src = url + '?' + qs;
        document.head.appendChild(s);
      });
    let tokenInfo = { ok: false };
    try {
      const d = await jsonp('https://api.live.bilibili.com/xlive/web-room/v1/index/getDanmuInfo', { id: roomId, type: 0 });
      tokenInfo = { ok: true, code: d && d.code, hasToken: !!(d && d.data && d.data.token) };
    } catch (e) {
      tokenInfo = { ok: false, error: e.message };
    }

    // WebSocket 实收（匿名握手兜底）
    const msgs = [];
    const ws = new WebSocket('wss://broadcastlv.chat.bilibili.com:443/sub');
    ws.binaryType = 'arraybuffer';
    const status = await new Promise((resolve) => {
      let settled = false;
      const finish = (v) => { if (!settled) { settled = true; resolve(v); } };
      ws.onopen = () => {
        const payload = new TextEncoder().encode(JSON.stringify({
          uid: 0, roomid: roomId, protover: 3, platform: 'web', type: 2, key: 'token=true',
        }));
        const buf = new ArrayBuffer(16 + payload.length);
        const dv = new DataView(buf);
        dv.setUint32(0, 16 + payload.length, true);
        dv.setUint32(4, 16, true);
        dv.setUint32(8, 1, true);
        dv.setUint32(12, 7, true);
        new Uint8Array(buf, 16).set(payload);
        ws.send(buf);
      };
      ws.onmessage = (ev) => {
        try {
          const buf = new Uint8Array(ev.data);
          const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
          let pos = 0;
          while (pos + 16 <= buf.length) {
            const len = dv.getUint32(pos);
            const op = dv.getUint32(pos + 12);
            if (op === 5) {
              const json = new TextDecoder().decode(buf.subarray(pos + 16, pos + len));
              try {
                const j = JSON.parse(json);
                if (j.cmd && String(j.cmd).startsWith('DANU')) {
                  const info = (j.info || [])[0] || {};
                  msgs.push(String(info.text || '').slice(0, 60));
                }
              } catch (e) {}
            }
            if (len <= 0) break;
            pos += len;
          }
        } catch (e) {}
        if (msgs.length >= 3) finish('live');
      };
      ws.onerror = () => finish('error');
      ws.onclose = () => finish(msgs.length ? 'live' : 'closed');
      setTimeout(() => finish(msgs.length ? 'live' : 'timeout'), 25000);
    });
    try { ws.close(); } catch (e) {}
    return { tokenInfo, status, count: msgs.length, samples: msgs.slice(0, 6) };
  });
  console.log('   token:', JSON.stringify(bili.tokenInfo), ' ws:', bili.status, ' 收到', bili.count, '条');
  console.log('   样例:', JSON.stringify(bili.samples));
  record('B 站弹幕握手可用（拿到 token 或 WS 收到弹幕）', bili.tokenInfo.hasToken || bili.count > 0,
    'token=' + (bili.tokenInfo.hasToken ? '有' : '无') + ' ws=' + bili.status + ' 条数=' + bili.count);

  /* ---------- 6. B 站直播间信息 ---------- */
  console.log('\n[6] B 站直播间信息（标题/描述是否带比分）');
  const info = await page.evaluate(async () => {
    const out = [];
    for (const rid of [7734200, 1722160589]) {
      try {
        const res = await fetch('https://api.live.bilibili.com/xlive/web-room/v1/index/getInfoByRoom?room_id=' + rid, {
          credentials: 'include',
        });
        const j = await res.json();
        const ri = j.data && j.data.room_info;
        out.push({ rid, code: j.code, live: j.data && j.data.live_status, title: ri && ri.title, desc: (ri && ri.description || '').slice(0, 100) });
      } catch (e) {
        out.push({ rid, error: e.message });
      }
    }
    return out;
  });
  for (const i of info) console.log('   ', JSON.stringify(i));
  record('B 站直播间信息可读（code=0）', info.some((i) => i.code === 0), info.map((i) => i.rid + ':' + i.code).join(' '));

  /* ---------- 7. 腾讯弹幕候选 ---------- */
  console.log('\n[7] 腾讯弹幕候选接口');
  const txDanmu = await page.evaluate(async () => {
    const cands = [
      ['ams-style', 'https://barrage.garena.com/'],
      ['qq open', 'https://live-open.qq.com/'],
      ['qq barrage', 'https://barrage-proxy.qq.com/'],
      ['qd', 'https://qd.qq.com/'],
    ];
    const out = [];
    for (const [n, u] of cands) {
      try {
        const res = await fetch(u, { method: 'GET', mode: 'no-cors' });
        out.push({ n, status: res.status, type: res.type });
      } catch (e) {
        out.push({ n, error: e.message });
      }
    }
    return out;
  });
  for (const t of txDanmu) console.log('   ', JSON.stringify(t));

  console.log('\n=== 请求失败清单（网络层） ===');
  for (const e of netErrors.slice(0, 25)) console.log('   ', e);

  const pass = results.filter((r) => r.pass).length;
  console.log(`\n=== 浏览器侧源可用性：${pass}/${results.length} 通过 ===`);
  for (const r of results) console.log(`  ${r.pass ? 'PASS' : 'FAIL'}  ${r.name} — ${r.detail}`);

  await browser.close();
  server.close();
})();
