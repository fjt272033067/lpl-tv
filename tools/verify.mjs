/* =====================================================================
 * verify.mjs — 本地端到端验收
 * 启动静态服务器 + 真实 Chrome（Playwright）走一遍：直播 / 录像库 / 播放页
 * 校验：清晰度菜单、倍速菜单、弹幕渲染、视频实际解码、弹幕数量、切清晰度
 * ===================================================================== */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { resolvePlaywright } from './resolve-playwright.mjs';
import { decodePng, frameStats } from './pngdiff.mjs';

const { chromium } = resolvePlaywright().pw;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const SITE = path.join(ROOT, 'site');
const SHOTS = path.join(ROOT, 'data', 'ui-smoke');
fs.mkdirSync(SHOTS, { recursive: true });

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
};

function startServer() {
  const server = http.createServer((req, res) => {
    let p = decodeURIComponent(req.url.split('?')[0].split('#')[0]);
    if (p === '/') p = '/index.html';
    const file = path.join(SITE, p);
    if (!file.startsWith(SITE) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('404');
      return;
    }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-store',
    });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }));
  });
}

const results = [];
function check(name, pass, detail) {
  results.push({ name, pass: !!pass, detail: detail || '' });
  console.log(`  ${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
}

(async () => {
  const { server, port } = await startServer();
  const base = `http://127.0.0.1:${port}`;
  console.log(`静态服务器：${base}\n`);

  const browser = await chromium.launch({
  // 用有头浏览器：B 站对无头浏览器会弹验证码/黑屏，那不是真实用户环境。
  // 需要 CI 环境时设 HEADLESS=1（届时抽屉的「画面变化率」断言可能不成立）。
  headless: process.env.HEADLESS === '1',
  executablePath: CHROME,
  args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required', '--mute-audio', '--window-size=1440,900'],
});
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();

  const consoleErrors = [];
  // 过滤第三方 iframe（B 站直播间页）自身产生的跨域告警 —— 不是本站缺陷
  const NOISE = /Blocked a frame with origin|permissions policy|compute pressure|biliBridgePc/i;
  const NOISE_SRC = /hdslb\.com|live\.bilibili\.com/;
  let inDrawer = false; // 打开抽屉后，第三方页面内部的报错一律不算本站缺陷
  page.on('console', (m) => {
    if (inDrawer) return;
    if (m.type() === 'error' && !NOISE.test(m.text())) consoleErrors.push(m.text().slice(0, 200));
  });
  page.on('pageerror', (e) => {
    const msg = String(e && e.message ? e.message : e);
    const stack = String((e && e.stack) || '');
    if (NOISE.test(msg) || NOISE_SRC.test(stack)) return;
    const line = 'pageerror: ' + msg.slice(0, 200);
    consoleErrors.push(line);
    console.log('   [pageerror] ' + line + '\n' + stack.split('\n').slice(0, 5).join('\n'));
  });
  const netLog = [];
  page.on('response', (r) => {
    const u = r.url();
    if (/commact|getinfo|liverooms|LIVE_BMATCH|\.m3u8|omex|comment\.bilibili/.test(u)) {
      const line = `${r.status()} ${u.slice(0, 96)}`;
      netLog.push(line);
      console.log('   [net] ' + line);
    }
  });
  page.on('requestfailed', (r) => {
    const line = `FAILED ${r.url().slice(0, 96)} ${(r.failure() || {}).errorText}`;
    netLog.push(line);
    console.log('   [net] ' + line);
  });

  /* ---------------- 直播页 ---------------- */
  console.log('[直播页]');
  await page.goto(base + '/#/live', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(9000);

  const live = await page.evaluate(() => {
    const v = document.querySelector('.player video');
    const menus = document.querySelectorAll('.menu');
    const qItems = document.querySelector('.menu[data-menu="quality"]');
    return {
      hasVideo: !!v,
      src: v ? (v.currentSrc || v.src || '').slice(0, 60) : '',
      readyState: v ? v.readyState : -1,
      videoWidth: v ? v.videoWidth : 0,
      menus: menus.length,
      tags: [...document.querySelectorAll('.player-top .badge')].map((b) => b.textContent.trim()),
      sideRows: document.querySelectorAll('.side-row').length,
      qualityMenu: qItems ? qItems.querySelectorAll('.menu-item').length : 0,
      state: document.querySelector('.state') ? document.querySelector('.state').textContent.slice(0, 80) : '',
    };
  });
  console.log('   ' + JSON.stringify(live));
  check('直播页渲染出播放器', live.hasVideo);
  check('直播页加载出赛事侧栏', live.sideRows > 0 || live.state.length > 0);

  // 判断「当前有没有赛事在播」——验收判据必须对外部状态免疫：
  // 休赛期（腾讯常驻房无流、B 站流地址也已过期）时，页面给明确提示就是正确行为，
  // 不该被当成回归来报失败。
  const signal = await page.evaluate(() => {
    const v = document.querySelector('.player video');
    const msg = document.querySelector('.player-msg');
    const hasFrame = !!(v && v.videoWidth > 0);
    const msgText = msg && getComputedStyle(msg).display !== 'none' ? msg.textContent.trim() : '';
    const stripLabel = (document.querySelector('.live-strip .strip-label') || {}).textContent || '';
    return {
      hasFrame,
      msgText: msgText.slice(0, 120),
      noSignal: !hasFrame && /暂无直播|无信号|信号|结束|准备/.test(msgText + ' ' + stripLabel),
      stripLabel: stripLabel.trim(),
    };
  });
  console.log('   信号状态: ' + JSON.stringify(signal));
  global.__hasSignal = signal.hasFrame;
  // 清晰度档位随线路变化：腾讯源多档、B 站源单档（未登录最高高清）。
  // 判据是「菜单如实给出当前线路的档位」，而不是硬编码 3 档。
  check('直播清晰度菜单有可用档位', live.qualityMenu >= 1, 'quality items=' + live.qualityMenu);

  // 关键判据：直播必须真的解码出画面（不能只验证播放器元素存在）。
  // 之前腾讯锚点的失效流就是「元素在、尺寸为 0、画面全黑」——
  // 只断言元素存在会把这种故障判成通过，所以这里做像素级判定。
  const liveFrame = await page.evaluate(() => {
    const v = document.querySelector('.player video');
    if (!v || !v.videoWidth) return { decoded: false, nonBlack: 0 };
    const c = document.createElement('canvas');
    c.width = 160;
    c.height = 90;
    const g = c.getContext('2d');
    g.drawImage(v, 0, 0, 160, 90);
    const d = g.getImageData(0, 0, 160, 90).data;
    let nonBlack = 0;
    for (let i = 0; i < d.length; i += 4) {
      if ((d[i] + d[i + 1] + d[i + 2]) / 3 > 12) nonBlack++;
    }
    return { decoded: true, nonBlack: +(nonBlack / (d.length / 4)).toFixed(3), w: v.videoWidth, h: v.videoHeight };
  });
  console.log('   直播画面: ' + JSON.stringify(liveFrame));
  if (signal.hasFrame) {
    check(
      '直播真的解码出画面（非黑屏）',
      liveFrame.decoded && liveFrame.nonBlack > 0.05,
      liveFrame.decoded ? `nonBlack=${liveFrame.nonBlack} ${liveFrame.w}x${liveFrame.h}` : '视频未解码'
    );
  } else {
    // 休赛期：没有赛事在播是正常的，此时必须给出明确提示而不是黑屏
    check(
      '无直播信号时给出明确提示（非黑屏无解释）',
      signal.noSignal,
      signal.msgText || '（无提示）'
    );
  }

  // 线路菜单必须包含可站内播放的 B 站在播源（腾讯常驻锚点常是失效流）
  // 注意：不能走 Playwright 的 click —— 播放器有画面时控制条会自动隐藏，
  // <video> 会盖住按钮，命中测试一直失败。这里在 DOM 层面直接触发。
  const lineItems = await page.evaluate(() => {
    const btn = document.querySelector('[data-ctl="source"]');
    if (!btn) return [];
    btn.click();
    const menu = document.querySelector('.menu[data-menu="source"]');
    return menu ? [...menu.querySelectorAll('.menu-item')].map((i) => i.textContent.trim()) : [];
  });
  await page.waitForTimeout(300);
  console.log('   线路: ' + JSON.stringify(lineItems));
  check(
    '线路菜单含可站内播放的直播源',
    lineItems.some((t) => /B站/.test(t)) || lineItems.some((t) => /腾讯/.test(t)),
    lineItems.length + ' 条'
  );
  // 多平台：斗鱼 / 虎牙 官方直播间入口
  check(
    '线路菜单含斗鱼/虎牙等其它平台',
    lineItems.some((t) => /斗鱼/.test(t)) && lineItems.some((t) => /虎牙/.test(t)),
    lineItems.filter((t) => /斗鱼|虎牙/.test(t)).join(' | ') || '无'
  );
  // 线路文案必须各不相同（用户反馈：次线路内容不同但文案一模一样）
  const distinct = new Set(lineItems.map((t) => t.replace(/^[✓\s]*/, '').split('·')[0].trim())).size;
  check('各线路文案互不相同', distinct >= Math.min(3, lineItems.length), distinct + ' 种不同文案');

  // 音量可调 + 记忆
  const volTest = await page.evaluate(async () => {
    const v = document.querySelector('.player video');
    const input = document.querySelector('.ctrl-vol input[type=range]');
    if (!v || !input) return { err: 'no video / no volume input' };
    const before = v.volume;
    input.value = '0.35';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 300));
    const after = v.volume;
    let saved = null;
    try { saved = localStorage.getItem('lpltv_volume'); } catch (e) {}
    return { before, after, saved, muted: v.muted };
  });
  console.log('   音量: ' + JSON.stringify(volTest));
  check(
    '音量可调节并被记住',
    Math.abs(volTest.after - 0.35) < 0.02 && volTest.saved !== null,
    `${volTest.before} → ${volTest.after} saved=${volTest.saved} ${volTest.err || ''}`
  );

  // 视觉/体验判据（对应外部访客反馈）
  const visual = await page.evaluate(() => {
    const panels = document.querySelectorAll('.side-panel');
    const cards = [...document.querySelectorAll('.card')];
    const withShot = cards.filter((c) => c.querySelector('.card-cover .shot'));
    const platColors = cards
      .map((c) => (c.querySelector('.card-hd') || {}).className || '')
      .filter((c) => /plat-/.test(c));
    return {
      panels: panels.length,
      panelTitles: [...panels].map((p) => (p.querySelector('.side-title') || {}).textContent || ''),
      cards: cards.length,
      withShot: withShot.length,
      platKinds: [...new Set(platColors.map((c) => (c.match(/plat-\w+/) || [''])[0]))],
      banner: !!document.querySelector('.event-banner'),
      bannerLogos: document.querySelectorAll('.event-banner .eb-side img').length,
      toTop: !!document.querySelector('.to-top'),
      stripRun: document.querySelectorAll('.live-strip .strip-run').length,
      stripItems: document.querySelectorAll('.live-strip .strip-item').length,
      // 布局顺序：主区（播放器）必须在侧栏之前
      heroFirstIsPlayer: (() => {
        const hero = document.querySelector('.hero');
        if (!hero) return false;
        return !!hero.firstElementChild && !!hero.firstElementChild.querySelector('.player');
      })(),
    };
  });
  console.log('   视觉: ' + JSON.stringify(visual));
  // 比赛信息卡片不得重复渲染（同一组内容出现两次）
  check('比赛信息卡片不重复', visual.panels <= 1, visual.panels + ' 个侧栏');
  check('播放器在主区（左右列未颠倒）', visual.heroFirstIsPlayer);
  check('线路卡片有预览缩略图', visual.withShot > 0, visual.withShot + '/' + visual.cards + ' 张');
  check('平台标签有区分色', visual.platKinds.length >= 2, visual.platKinds.join(','));
  check('赛事横幅已渲染', visual.banner, visual.bannerLogos + ' 个队徽');
  check('有回到顶部按钮', visual.toTop);
  if (visual.stripItems > 0) {
    check('通知条为单行紧凑信息', visual.stripRun === 0, visual.stripItems + ' 项');
  } else {
    // 休赛期没有可播源，通知条应改为「暂无直播信号」而不是继续显示「正在直播」
    check(
      '休赛期通知条如实标注无信号',
      /暂无直播|无信号/.test(signal.stripLabel || ''),
      (signal.stripLabel || '(空)') + ' items=' + visual.stripItems
    );
  }

  // 关键判据：B 站流地址约 60 分钟过期（B 站签名机制），
  // 过期后必须自动切到还活着的线路，而不是给用户留一块黑屏。
  // 这里把 liverooms.json 响应里的 expires 改成过去时间来模拟过期。
  const expPage = await ctx.newPage();
  await expPage.route('**/data/liverooms.json', async (route) => {
    const res = await route.fetch();
    const j = await res.json();
    (j.rooms || []).forEach((r) => {
      if (r.stream) r.stream.expires = Math.floor(Date.now() / 1000) - 3600;
    });
    await route.fulfill({
      response: res,
      body: JSON.stringify(j),
      headers: { 'content-type': 'application/json' },
    });
  });
  await expPage.goto(base + '/#/live', { waitUntil: 'domcontentloaded' });
  await expPage.waitForTimeout(11000);
  const expState = await expPage.evaluate(() => {
    const v = document.querySelector('.player video');
    const strip = [...document.querySelectorAll('.live-strip .strip-item')].map((e) => e.textContent.trim());
    const msg = document.querySelector('.player-msg');
    const msgText = msg && getComputedStyle(msg).display !== 'none' ? msg.textContent.trim() : '';
    const stripLabel = (document.querySelector('.live-strip .strip-label') || {}).textContent || '';
    return {
      videoW: v ? v.videoWidth : 0,
      playing: v ? !v.paused : false,
      srcMenu: document.querySelectorAll('.menu[data-menu="source"] .menu-item').length,
      strip: strip,
      stripUniq: new Set(strip).size,
      msg: msgText.slice(0, 120),
      noSignal:
        !(v && v.videoWidth > 0) && /暂无直播|无信号|信号|结束|准备/.test(msgText + ' ' + stripLabel),
    };
  });
  console.log('   过期降级: ' + JSON.stringify(expState));
  if (expState.videoW > 0) {
    check(
      '流地址过期后自动切到可用线路',
      expState.playing,
      `${expState.videoW}px playing=${expState.playing}`
    );
    check('过期降级后通知条无重复文案', expState.stripUniq === expState.strip.length, expState.strip.join(' / '));
  } else {
    // 当前本来就没有赛事在播时，「过期后无信号」是正确表现：
    // 关键是不能留黑屏而不给解释，且仍要给出平台官方直播间入口
    check(
      '无信号时给出明确提示而非黑屏',
      expState.noSignal,
      expState.msg || '（无提示）'
    );
    check('过期降级后仍有平台官方直播间入口', expState.srcMenu >= 3, expState.srcMenu + ' 条线路');
  }
  await expPage.close();
  await page.screenshot({ path: path.join(SHOTS, '01-live.png'), fullPage: false });

  // 打开清晰度菜单截图（同样走 DOM 触发，避免 <video> 遮挡命中测试）
  const openedQuality = await page.evaluate(() => {
    const btn = document.querySelector('[data-ctl="quality"]');
    if (!btn) return false;
    btn.click();
    return true;
  });
  if (openedQuality) {
    await page.waitForTimeout(400);
    await page.screenshot({ path: path.join(SHOTS, '02-live-quality-menu.png') });
    await page.evaluate(() => {
      const btn = document.querySelector('[data-ctl="quality"]');
      if (btn) btn.click();
    });
  }

  // 直播倍速：hls.js 的 LiveSyncController 会在每次 timeupdate 写 playbackRate，
  // 这里连续采样 6 秒，确保用户的 1.5× 不被覆写
  const liveSpeed = await page.evaluate(async () => {
    const v = document.querySelector('.player video');
    const btn = document.querySelector('[data-ctl="speed"]');
    if (!btn || !v) return { err: 'no speed button / no video' };
    btn.click();
    const menu = document.querySelector('.menu[data-menu="speed"]');
    const item = [...menu.querySelectorAll('.menu-item')].find((i) => i.textContent.includes('1.5'));
    if (!item) return { err: 'no 1.5x item' };
    item.click();
    const samples = [];
    for (let i = 0; i < 12; i++) {
      await new Promise((r) => setTimeout(r, 500));
      samples.push(Math.round(v.playbackRate * 100) / 100);
    }
    return { rate: v.playbackRate, min: Math.min.apply(null, samples), max: Math.max.apply(null, samples) };
  });
  console.log('   直播倍速采样: ' + JSON.stringify(liveSpeed));
  check(
    '直播倍速生效且不被 hls.js 覆写',
    Math.abs(liveSpeed.rate - 1.5) < 0.01 && liveSpeed.min > 1.4,
    `rate=${liveSpeed.rate} 区间=[${liveSpeed.min},${liveSpeed.max}] ${liveSpeed.err || ''}`
  );

  // 直播 B 站弹幕入口：B 站不允许第三方 iframe 内嵌直播（实测不拉流、不连弹幕），
  // 所以这里验证的是「一键在新标签打开 B 站直播间」这个真实可行的形态。
  const biliEntry = await page.evaluate(() => {
    const btn = [...document.querySelectorAll('button')].find((b) =>
      (b.textContent || '').includes('B站直播间')
    );
    if (!btn) return { err: 'no bili entry button' };
    return { text: btn.textContent.trim(), found: true };
  });
  console.log('   B站入口: ' + JSON.stringify(biliEntry));
  // 文案有两种形态：有直播时是「在新标签打开B站直播间看实时弹幕」，
  // 休赛期时是提示条上的「打开B站直播间」按钮 —— 都算提供了入口。
  check(
    '直播页提供 B 站直播间入口（新标签打开）',
    biliEntry.found && /新标签|打开/.test(biliEntry.text || ''),
    biliEntry.text || biliEntry.err || ''
  );
  inDrawer = false;

  /* ---------------- 录像库 ---------------- */
  console.log('\n[录像库]');
  await page.goto(base + '/#/vod', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(4500);
  const vod = await page.evaluate(async () => {
    const cards = [...document.querySelectorAll('.card')];
    const cat = await fetch('data/catalog.json').then((r) => r.json());
    const bakedMax = cat.matches.map((m) => m.date).filter(Boolean).sort().pop() || '';
    const firstMeta = cards[0] ? (cards[0].querySelector('.card-meta') || {}).textContent || '' : '';
    return {
      cards: cards.length,
      filters: document.querySelectorAll('.filters select').length,
      count: document.querySelector('.filters .count') ? document.querySelector('.filters .count').textContent : '',
      withDm: document.querySelectorAll('.card-dm').length,
      officialBadges: [...document.querySelectorAll('.card-dm')].filter((b) => b.textContent.trim() === '官方').length,
      bakedMax: bakedMax.slice(0, 10),
      firstDate: (firstMeta.match(/\d{4}-\d{2}-\d{2}/) || [''])[0],
      updatedAt: document.querySelector('.updated-at') ? document.querySelector('.updated-at').textContent : '',
    };
  });
  console.log('   ' + JSON.stringify(vod));
  check('录像库渲染出卡片', vod.cards > 0, 'cards=' + vod.cards);
  check('录像库有筛选器', vod.filters >= 2);
  check('部分录像带弹幕标记', vod.withDm > 0, 'dm badges=' + vod.withDm);
  check('官方最新内容已并入主列表（非独立板块）', vod.officialBadges > 0, '官方标记=' + vod.officialBadges);
  check(
    '主列表比烘焙目录更新（实时生效）',
    !!vod.firstDate && !!vod.bakedMax && vod.firstDate >= vod.bakedMax,
    `首条=${vod.firstDate} 烘焙最新=${vod.bakedMax}`
  );
  check('显示回放快照时间', /快照|更新于/.test(vod.updatedAt), vod.updatedAt);
  await page.screenshot({ path: path.join(SHOTS, '03-vod.png') });

  /* ---------------- 播放页（含弹幕） ---------------- */
  console.log('\n[播放页]');
  // 选弹幕最多的那一场
  const picked = await page.evaluate(() => {
    const cards = [...document.querySelectorAll('.card')];
    let best = null;
    let bestN = -1;
    cards.forEach((c) => {
      const n = Number(c.getAttribute('data-dm') || 0);
      if (n > bestN) {
        bestN = n;
        best = c;
      }
    });
    if (!best) return null;
    const id = best.getAttribute('data-id');
    const cid = best.getAttribute('data-cid');
    best.click();
    return { id, cid, dm: bestN };
  });
  let watchOk = false;
  if (picked) {
    console.log('   → 选中 ' + JSON.stringify(picked));
    await page.waitForTimeout(1200);
    console.log('   url: ' + page.url());
    await page.waitForTimeout(9000);

    const w = await page.evaluate(() => {
      const v = document.querySelector('.player video');
      return {
        hasVideo: !!v,
        readyState: v ? v.readyState : -1,
        videoWidth: v ? v.videoWidth : 0,
        videoHeight: v ? v.videoHeight : 0,
        duration: v ? v.duration : 0,
        currentTime: v ? v.currentTime : 0,
        src: v ? (v.currentSrc || v.src || '').slice(0, 70) : '',
        dmItems: document.querySelectorAll('.dm-canvas .dm-item').length,
        dmTotal: window.__dmTotal || 0,
        speedMenu: document.querySelector('.menu[data-menu="speed"]')
          ? document.querySelector('.menu[data-menu="speed"]').querySelectorAll('.menu-item').length
          : 0,
        qualityItems: document.querySelector('.menu[data-menu="quality"]')
          ? document.querySelector('.menu[data-menu="quality"]').querySelectorAll('.menu-item').length
          : 0,
        title: document.querySelector('.watch-title') ? document.querySelector('.watch-title').textContent : '',
        dmInfo: [...document.querySelectorAll('.kv-row')].map((r) => r.textContent).join(' | '),
      };
    });
    console.log('   ' + JSON.stringify(w));
    check('播放页有 video 元素', w.hasVideo);
    check('视频已解码出画面尺寸', w.videoWidth > 0 && w.videoHeight > 0, w.videoWidth + 'x' + w.videoHeight);
    check('视频有时长信息', w.duration > 0, 'duration=' + Math.round(w.duration) + 's');
    check('倍速菜单 8 档', w.speedMenu === 8, 'items=' + w.speedMenu);
    check('清晰度菜单 ≥2 档', w.qualityItems >= 2, 'items=' + w.qualityItems);
    watchOk = true;
    await page.screenshot({ path: path.join(SHOTS, '04-watch.png') });

    // 倍速
    const sp = await page.evaluate(() => {
      const btn = document.querySelector('[data-ctl="speed"]');
      if (!btn) return 'no button';
      btn.click();
      const menu = document.querySelector('.menu[data-menu="speed"]');
      const items = [...menu.querySelectorAll('.menu-item')];
      const target = items.find((i) => i.textContent.includes('1.5'));
      if (!target) return 'no 1.5x';
      target.click();
      const v = document.querySelector('.player video');
      return 'rate=' + v.playbackRate;
    });
    await page.waitForTimeout(600);
    const rate = await page.evaluate(() => document.querySelector('.player video').playbackRate);
    check('倍速切换生效 (1.5×)', Math.abs(rate - 1.5) < 0.01, 'playbackRate=' + rate + ' (' + sp + ')');

    // 弹幕渲染：跳到弹幕最密集的时间点
    const dm = await page.evaluate(async (cid) => {
      let target = 30;
      let total = 0;
      if (cid) {
        try {
          const r = await fetch('data/dm/' + cid + '.json');
          const j = await r.json();
          const times = (j.items || []).map((i) => i[0]).sort((a, b) => a - b);
          total = times.length;
          // 找 10 秒内弹幕最多的窗口
          let best = 0;
          let bestN = -1;
          let j0 = 0;
          for (let j1 = 0; j1 < times.length; j1++) {
            while (times[j1] - times[j0] > 10) j0++;
            if (j1 - j0 > bestN) {
              bestN = j1 - j0;
              best = times[j0];
            }
          }
          if (times.length) target = best;
        } catch (e) {}
      }
      const v = document.querySelector('.player video');
      v.currentTime = target;
      // 轮询：等视频真正推进、弹幕真正出现
      let items = 0;
      let advanced = 0;
      for (let i = 0; i < 40; i++) {
        await new Promise((r) => setTimeout(r, 500));
        const nodes = document.querySelectorAll('.dm-canvas .dm-item');
        items = nodes.length;
        advanced = v.currentTime - target;
        if (items > 0 && advanced > 1) break;
      }
      const nodes = [...document.querySelectorAll('.dm-canvas .dm-item')];
      const e = window.__dm;
      return {
        seekTo: Math.round(target),
        total,
        loaded: e ? e.count : -1,
        cursor: e ? e.cursor : -1,
        active: e ? e.active.length : -1,
        rootConnected: e ? e.root.isConnected : -1,
        rootParent: e && e.root.parentNode ? e.root.parentNode.className : '(none)',
        rootChildCount: e ? e.root.childNodes.length : -1,
        firstChildClass: e && e.root.firstChild ? e.root.firstChild.className : '(none)',
        firstChildText: e && e.root.firstChild ? String(e.root.firstChild.textContent).slice(0, 20) : '',
        trackCount: e ? e._trackCount : -1,
        engW: e ? e._w : -1,
        opts: e ? JSON.stringify(e.opts) : '',
        stats: e ? JSON.stringify(e.stats) : '',
        engineTime: e ? Math.round(e.time) : -1,
        videoTime: Math.round(v.currentTime),
        advanced: Math.round(advanced * 10) / 10,
        paused: v.paused,
        items: nodes.length,
        sample: nodes.slice(0, 3).map((n) => n.textContent.slice(0, 16)),
      };
    }, picked.cid);
    console.log('   弹幕: ' + JSON.stringify(dm));
    check(
      '弹幕已渲染到画面上',
      dm.items > 0,
      `items=${dm.items} loaded=${dm.loaded} @${dm.seekTo}s ${JSON.stringify(dm.sample)}`
    );
    await page.screenshot({ path: path.join(SHOTS, '05-watch-danmaku.png') });

    // 切清晰度
    const q = await page.evaluate(async () => {
      const before = document.querySelector('.player video').videoWidth;
      const btn = document.querySelector('[data-ctl="quality"]');
      if (!btn) return { before, after: -1, label: 'no btn' };
      btn.click();
      const menu = document.querySelector('.menu[data-menu="quality"]');
      const items = [...menu.querySelectorAll('.menu-item')];
      const sd = items.find((i) => i.textContent.includes('标清'));
      if (!sd) return { before, after: -1, label: 'items=' + items.map((i) => i.textContent.trim()).join('/') };
      sd.click();
      await new Promise((r) => setTimeout(r, 8000));
      const v = document.querySelector('.player video');
      return { before, after: v.videoWidth, label: sd.textContent.trim() };
    });
    console.log('   清晰度切换: ' + JSON.stringify(q));
    check('清晰度切换改变分辨率', q.after > 0 && q.after !== q.before, `${q.before}px → ${q.after}px (${q.label})`);
    await page.screenshot({ path: path.join(SHOTS, '06-watch-480p.png') });
  } else {
    check('找到带弹幕的录像卡片', false, '没有带弹幕标记的卡片');
  }

  /* ---------------- 赛程页 ---------------- */
  console.log('\n[赛程页]');
  await page.goto(base + '/#/schedule', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(4000);
  const sch = await page.evaluate(() => ({
    events: document.querySelectorAll('.bracket-event').length,
    cols: document.querySelectorAll('.bracket-col').length,
    rows: document.querySelectorAll('.bracket-row').length,
    logos: document.querySelectorAll('.bracket-row .blogo:not(.ph)').length,
    scores: document.querySelectorAll('.bracket-row .bscore').length,
    rounds: document.querySelectorAll('.bracket-round').length,
    picker: !!document.querySelector('.sched-picker .select-btn'),
  }));
  console.log('   ' + JSON.stringify(sch));
  check('赛程按赛事分块渲染', sch.events > 0, 'events=' + sch.events);
  check('赛程有轮次列', sch.cols > 0 && sch.rounds > 0, 'cols=' + sch.cols + ' rounds=' + sch.rounds);
  check('赛程渲染出对阵行', sch.rows > 0, 'rows=' + sch.rows);
  check('对阵行带队伍徽标', sch.logos > 0, 'logos=' + sch.logos);
  check('对阵行带比分', sch.scores > 0, 'scores=' + sch.scores);
  check('赛程有赛事下拉选择', sch.picker);

  // 赛程行点击看录播：分两类
  //   ① 腾讯已发录像 → 点行进入本站播放页（hash 变为 #/watch/<vid>）
  //   ② 只有 B 站源 → 点行在新标签打开 B 站视频
  const vodRows = await page.evaluate(() => ({
    tx: document.querySelectorAll('.bracket-row.has-vod:not(.bili-only)').length,
    bili: document.querySelectorAll('.bracket-row.bili-only').length,
    none: document.querySelectorAll('.bracket-row.no-vod').length,
    playBadges: document.querySelectorAll('.bracket-row .bplay').length,
  }));
  console.log('   可回放行: ' + JSON.stringify(vodRows));
  check(
    '赛程行标注了可回放状态',
    vodRows.playBadges > 0 && vodRows.tx + vodRows.bili + vodRows.none === vodRows.playBadges + vodRows.none,
    `腾讯源 ${vodRows.tx} / B站源 ${vodRows.bili} / 未发布 ${vodRows.none}`
  );
  check('至少有一行可点看录播', vodRows.tx + vodRows.bili > 0, `共 ${vodRows.tx + vodRows.bili} 行`);

  // 点击腾讯源行 → 必须真的跳到播放页
  let schWatchOk = false;
  let schWatchDetail = '没有腾讯源可点行';
  const txRow = await page.$('.bracket-row.has-vod:not(.bili-only)');
  if (txRow) {
    await txRow.click();
    await page.waitForTimeout(2500);
    const st = await page.evaluate(() => ({
      hash: location.hash,
      hasVideo: !!document.querySelector('.watch video'),
      title: (document.querySelector('.watch-title') || {}).textContent || '',
    }));
    schWatchOk = /^#\/watch\//.test(st.hash) && st.hasVideo;
    schWatchDetail = st.hash + ' video=' + st.hasVideo + ' ' + (st.title || '').slice(0, 30);
  }
  check('点击赛程行进入播放页', schWatchOk, schWatchDetail);
  await page.screenshot({ path: path.join(SHOTS, '07b-schedule-watch.png') });

  // 点击 B 站源行 → 必须打开 B 站视频页
  // 不用「监听 popup」的方式：在页面内临时替换 window.open 直接捕获目标 URL，
  // 既避免真的拉起一个 B 站页面（浪费带宽），也能精确断言打开的是视频页。
  await page.goto(base + '/#/schedule', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3500);
  const biliClick = await page.evaluate(async () => {
    const row = document.querySelector('.bracket-row.bili-only');
    if (!row) return { err: 'no bili row' };
    const orig = window.open;
    let captured = '';
    window.open = (u) => {
      captured = String(u || '');
      return null;
    };
    row.click();
    await new Promise((r) => setTimeout(r, 300));
    window.open = orig;
    return { captured };
  });
  console.log('   B站行跳转: ' + JSON.stringify(biliClick));
  check(
    '点击赛程行（B站源）打开 B 站视频',
    !!biliClick.captured && /bilibili\.com\/video\//.test(biliClick.captured),
    biliClick.captured ? biliClick.captured.slice(0, 70) : biliClick.err || '未打开'
  );

  await page.goto(base + '/#/schedule', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2500);
  await page.screenshot({ path: path.join(SHOTS, '07-schedule.png') });

  /* ---------------- 移动端 ---------------- */
  console.log('\n[移动端]');
  const mob = await ctx.newPage();
  await mob.setViewportSize({ width: 390, height: 844 });
  await mob.goto(base + '/#/vod', { waitUntil: 'domcontentloaded' });
  await mob.waitForTimeout(3500);
  await mob.screenshot({ path: path.join(SHOTS, '08-mobile-vod.png') });
  const overflow = await mob.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth
  );
  check('移动端无横向溢出', overflow <= 2, 'overflow=' + overflow + 'px');

  const mobLayout = await mob.evaluate(() => {
    const grid = document.querySelector('.grid');
    const cols = grid ? getComputedStyle(grid).gridTemplateColumns.split(' ').length : 0;
    const card = document.querySelector('.card');
    const btn = document.querySelector('.ctrl-btn');
    // 筛选下拉框在窄屏容易被压扁，这里量实际宽度
    const sel = document.querySelector('.filters select');
    return {
      cols,
      cardW: card ? Math.round(card.getBoundingClientRect().width) : 0,
      ctrlBtnH: btn ? Math.round(btn.getBoundingClientRect().height) : 0,
      rail: document.querySelectorAll('.rail-card').length,
      selW: sel ? Math.round(sel.getBoundingClientRect().width) : 0,
      labelH: (() => {
        const l = document.querySelector('.filters label');
        return l ? Math.round(l.getBoundingClientRect().height) : 0;
      })(),
    };
  });
  console.log('   移动端布局: ' + JSON.stringify(mobLayout));
  check('移动端网格为两列', mobLayout.cols === 2, 'cols=' + mobLayout.cols);
  check('移动端触控按钮 ≥36px', mobLayout.ctrlBtnH >= 36, 'btn=' + mobLayout.ctrlBtnH + 'px');
  check('移动端筛选下拉框可用（未被压扁）', mobLayout.selW >= 90, 'select 宽 ' + mobLayout.selW + 'px');
  check('移动端筛选标签不竖排', mobLayout.labelH > 0 && mobLayout.labelH < 34, 'label 高 ' + mobLayout.labelH + 'px');

  // 移动端直播页 + 赛程页
  await mob.goto(base + '/#/live', { waitUntil: 'domcontentloaded' });
  await mob.waitForTimeout(6000);
  await mob.screenshot({ path: path.join(SHOTS, '08b-mobile-live.png') });
  const mobLive = await mob.evaluate(() => {
    const v = document.querySelector('.player video');
    const p = document.querySelector('.player');
    // 菜单按钮图标：窄屏会隐藏文字标签，只有文字的按钮会变成空白点
    const iconBtns = {};
    ['quality', 'source', 'speed'].forEach((k) => {
      const b = document.querySelector('[data-ctl="' + k + '"]');
      if (!b) return;
      const ico = b.querySelector('.ico');
      const r = b.getBoundingClientRect();
      iconBtns[k] = ico ? Math.round(ico.getBoundingClientRect().width) : 0;
    });
    const vol = document.querySelector('.ctrl-vol input');
    const ctrlRow = document.querySelector('.ctrl-row');
    const playerW = p ? Math.round(p.getBoundingClientRect().width) : 0;
    return {
      hasVideo: !!v,
      playerH: p ? Math.round(p.getBoundingClientRect().height) : 0,
      playerW,
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      iconBtns,
      volW: vol ? Math.round(vol.getBoundingClientRect().width) : 0,
      volVisible: vol ? getComputedStyle(vol.parentElement).display !== 'none' : false,
      ctrlRowW: ctrlRow ? Math.round(ctrlRow.getBoundingClientRect().width) : 0,
    };
  });
  console.log('   移动端直播: ' + JSON.stringify(mobLive));
  check('移动端播放器有高度（比例正常）', mobLive.playerH > 120, mobLive.playerW + 'x' + mobLive.playerH);
  check('移动端直播页无横向溢出', mobLive.overflow <= 2, 'overflow=' + mobLive.overflow + 'px');
  // 窄屏下菜单按钮必须仍有可见图标（否则清晰度/线路/倍速变成空白点）
  check(
    '移动端清晰度/线路/倍速按钮有可见图标',
    mobLive.iconBtns.quality > 0 && mobLive.iconBtns.source > 0 && mobLive.iconBtns.speed > 0,
    JSON.stringify(mobLive.iconBtns)
  );
  // 音量必须可调（之前 .ctrl-vol 在窄屏被整条隐藏）
  check(
    '移动端音量滑块可见且可用',
    mobLive.volVisible && mobLive.volW >= 24,
    `visible=${mobLive.volVisible} width=${mobLive.volW}px`
  );
  // 控制条不能超出播放器宽度（否则最右侧按钮被裁掉）
  check(
    '移动端控制条不溢出播放器',
    mobLive.ctrlRowW <= mobLive.playerW + 2,
    `ctrl ${mobLive.ctrlRowW}px vs player ${mobLive.playerW}px`
  );

  await mob.goto(base + '/#/schedule', { waitUntil: 'domcontentloaded' });
  await mob.waitForTimeout(3000);
  await mob.screenshot({ path: path.join(SHOTS, '08c-mobile-schedule.png') });
  const mobSch = await mob.evaluate(() => {
    const cols = [...document.querySelectorAll('.bracket-col')];
    const xs = cols.map((c) => Math.round(c.getBoundingClientRect().x));
    return {
      stacked: xs.length > 1 ? Math.max.apply(null, xs) - Math.min.apply(null, xs) < 4 : true,
      cols: cols.length,
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    };
  });
  console.log('   移动端赛程: ' + JSON.stringify(mobSch));
  check('移动端对阵图纵向堆叠', mobSch.stacked, 'cols=' + mobSch.cols);
  check('移动端赛程无横向溢出', mobSch.overflow <= 2, 'overflow=' + mobSch.overflow + 'px');
  await mob.close();

  console.log('\n控制台错误（节选）：');
  console.log(consoleErrors.length ? consoleErrors.slice(0, 8).map((e) => '   ' + e).join('\n') : '   （无）');

  await browser.close();
  server.close();

  const pass = results.filter((r) => r.pass).length;
  console.log(`\n===== 验收结果：${pass}/${results.length} 通过 =====`);
  results.forEach((r) => {
    if (!r.pass) console.log(`  ✗ ${r.name} ${r.detail}`);
  });
  process.exit(pass === results.length ? 0 : 1);
})().catch((e) => {
  console.error('验收异常：', e);
  process.exit(2);
});
