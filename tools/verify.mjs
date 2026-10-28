/* =====================================================================
 * verify.mjs — 本地端到端验收
 * 启动静态服务器 + 真实 Chrome（Playwright）走一遍：直播 / 录像库 / 播放页
 * 校验：清晰度菜单、倍速菜单、弹幕渲染、视频实际解码、弹幕数量、切清晰度
 * ===================================================================== */
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { resolvePlaywright } from './resolve-playwright.mjs';
import { decodePng, frameStats } from './pngdiff.mjs';
import { upstreamKeys, localKeys, todayKey } from './schedule-keys.mjs';

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

  // 「刷新直播源」：B 站流地址约 60 分钟有效，页面开久了地址会过期，
  // 必须给用户一个能立刻换新地址的出口（不必刷新整个页面、丢播放进度）。
  const hasRefreshBtn = await page.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find((x) => /刷新直播源/.test(x.textContent || ''));
    if (!b) return false;
    b.click();
    return true;
  });
  await page.waitForTimeout(3000);
  const refreshState = await page.evaluate(() => ({
    toast: (document.querySelector('#toast') || {}).textContent || '',
    btn: (([...document.querySelectorAll('button')].find((x) => /刷新直播源|正在刷新/.test(x.textContent || '')) || {})
      .textContent ||
      '')
      .trim(),
  }));
  check(
    '直播页提供「刷新直播源」（B站地址过期可手动换新）',
    hasRefreshBtn && /已是最新|已更新/.test(refreshState.toast),
    'toast=' + (refreshState.toast || '(无)') + ' btn=' + refreshState.btn
  );

  // B 站线路的清晰度必须按实际档位排序，且不得混入别的游戏分区
  // （用户反馈「其余线路不清晰」—— 其实一半线路是别的游戏在播）
  const biliLines = await page.evaluate(() => {
    const cards = [...document.querySelectorAll('.card[data-kind="bili"]')];
    return cards.map((c) => ({
      res: (c.querySelector('.card-hd') || {}).textContent || '',
      sub: (c.querySelector('.card-meta span') || {}).textContent || '',
      title: (c.querySelector('.card-title') || {}).textContent || '',
      jump: !!c.querySelector('.card-jump'),
    }));
  });
  console.log('   B站线路: ' + JSON.stringify(biliLines));
  const resRank = { 原画: 5, '2K': 4, '1080P': 3, '720P': 2, '480P': 1, '360P': 0 };
  const ranks = biliLines.map((l) => resRank[l.res] ?? -1).filter((r) => r >= 0);
  check(
    'B 站线路按实际清晰度从高到低排列',
    ranks.length <= 1 || ranks.every((r, i) => i === 0 || ranks[i - 1] >= r),
    ranks.join('>')
  );
  check(
    'B 站线路不含其它游戏分区（金铲铲等）',
    biliLines.every((l) => !/金铲铲|云顶|无畏契约|王者/.test(l.title + l.sub)),
    biliLines.map((l) => l.title).join(' | ')
  );
  check('B 站线路提供官方原画出口', biliLines.length === 0 || biliLines.every((l) => l.jump), biliLines.length + ' 条');

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
      fallbackBtns: document.querySelectorAll('.live-fallback .lf-btn').length,
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
    // 兜底大按钮：站内没信号时，官方直播间要直接摆在页面上（别让用户翻菜单）
    check(
      '无信号时页面直接给出官方直播间按钮组',
      expState.fallbackBtns >= 3,
      expState.fallbackBtns + ' 个按钮'
    );
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
  const vodSrc = await page.evaluate(() => ({
    tags: document.querySelectorAll('.src-tag').length,
    biliTags: document.querySelectorAll('.src-tag.bili').length,
    txTags: document.querySelectorAll('.src-tag.tx').length,
  }));
  console.log('   来源标注: ' + JSON.stringify(vodSrc));
  check('录像卡片标注来源（腾讯点播 / B站同源）', vodSrc.txTags > 0 && vodSrc.biliTags > 0, JSON.stringify(vodSrc));
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
        altBtn: (document.querySelector('.watch-alt button') || {}).textContent || '',
        altNote: (document.querySelector('.watch-alt .wa-note') || {}).textContent || '',
      };
    });
    console.log('   ' + JSON.stringify(w));
    check('播放页有 video 元素', w.hasVideo);
    check('视频已解码出画面尺寸', w.videoWidth > 0 && w.videoHeight > 0, w.videoWidth + 'x' + w.videoHeight);
    check('视频有时长信息', w.duration > 0, 'duration=' + Math.round(w.duration) + 's');
    check('倍速菜单 8 档', w.speedMenu === 8, 'items=' + w.speedMenu);
    check('清晰度菜单 ≥2 档', w.qualityItems >= 2, 'items=' + w.qualityItems);
    check('播放页提供备用源出口（B站同源/搜索）', /B站/.test(w.altBtn), w.altBtn);
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
  const schFresh = await page.evaluate(() => ({
    label: (document.querySelector('.updated-at') || {}).textContent || '',
    eventMeta: (document.querySelector('.sched-event-meta') || {}).textContent || '',
    staleBanner: !!document.querySelector('.sched-stale'),
    staleTag: !!document.querySelector('.updated-at.stale'),
    unconfirmed: document.querySelectorAll('.bracket-row.unconfirmed').length,
  }));
  console.log('   赛程新鲜度: ' + JSON.stringify(schFresh));
  check('赛程页显示快照时间与滞后时长', /赛程快照/.test(schFresh.label), schFresh.label);
  check('赛程页显示当前赛事信息（运行时直连）', /全球总决赛|赛事/.test(schFresh.eventMeta), schFresh.eventMeta);
  // 新鲜快照绝不能被自己的「未来赛程」判成陈旧：快照里一定还有 0:0 的未开打场次
  // （含「总决赛」「D8G1」这类未定对阵的占位行），若把它们算成「漏赛果」，
  // 页面会对着刚烘焙的快照报滞后 —— 这条判据就是防那个方向写反的 bug。
  check(
    '新鲜快照不被误判为陈旧（未来 0:0 场次不计入漏赛果）',
    !schFresh.staleBanner && !schFresh.staleTag && schFresh.unconfirmed === 0,
    'banner=' + schFresh.staleBanner + ' tag=' + schFresh.staleTag + ' unconfirmed=' + schFresh.unconfirmed
  );

  // 「今天起的赛程」速览：用户最先要知道的是今天有哪几场，而不是先读对阵图
  const soon = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('.soon-row')];
    return {
      n: rows.length,
      sample: rows.slice(0, 3).map((r) => r.textContent.replace(/\s+/g, ' ').trim()),
      live: document.querySelectorAll('.soon-row.is-live').length,
      play: document.querySelectorAll('.soon-play').length,
    };
  });
  console.log('   今天起的赛程: ' + JSON.stringify(soon));
  check('赛程页有「今天起的赛程」速览', soon.n > 0, soon.n + ' 行 ' + JSON.stringify(soon.sample));
  check('速览里的场次可直接点录播', soon.play > 0, 'play=' + soon.play);

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

  // 赛程的「实时比分覆盖」：
  // 腾讯 LiveBMatchList 是跨域可读的 var 文件，赛事进行时会给出当前这场的对阵与比分。
  // 这里注入一条假的实时数据，验证赛程页确实会用它覆盖构建期快照。
  const livePage = await ctx.newPage();
  await livePage.route('**/LOL_MATCH2_LIVE_BMATCH_LIST.js*', async (route) => {
    const body = [
      'var LiveBMatchList={"status":"0","lastUpTime":"2026-10-25 05:00:00","msg":{"246":[{',
      '"GameId":"246","GameName":"2026全球总决赛","bMatchId":"13633","bMatchName":"TES vs AL",',
      '"TeamNameA":"TES","TeamShortNameA":"TES","ScoreA":"1","TeamNameB":"AL","TeamShortNameB":"AL",',
      '"ScoreB":"1","MatchDate":"2026-10-25 01:00:00","GameMode":"1","GameProcName":"第二天",',
      '"Video3":"764502578","is_anchor":"1"}]}};',
    ].join('');
    await route.fulfill({
      status: 200,
      contentType: 'application/javascript; charset=utf-8',
      body,
    });
  });
  await livePage.goto(base + '/#/schedule', { waitUntil: 'domcontentloaded' });
  await livePage.waitForTimeout(4500);
  const liveOverlay = await livePage.evaluate(() => {
    const rows = [...document.querySelectorAll('.bracket-row')];
    const live = rows.filter((r) => r.classList.contains('is-live'));
    const head = [...document.querySelectorAll('.section-head .badge-live')].map((e) => e.textContent.trim());
    return {
      liveRows: live.length,
      scores: live.map((r) => {
        const sides = [...r.querySelectorAll('.bside')].map((s) => s.textContent.trim());
        const sc = (r.querySelector('.bscore') || {}).textContent || '';
        return sides.join(' ') + ' ' + sc;
      }),
      head,
    };
  });
  console.log('   实时覆盖: ' + JSON.stringify(liveOverlay));
  check(
    '赛程用腾讯实时数据覆盖比分（非构建期快照）',
    liveOverlay.liveRows >= 1,
    liveOverlay.liveRows + ' 行高亮 ' + liveOverlay.scores.join(' | ')
  );
  check('赛程页标注实时场次数', liveOverlay.head.length >= 1, liveOverlay.head.join(' '));
  await livePage.close();

  /* ---------------- 陈旧快照的防错 ---------------- */
  // 把 schedule.json 换成一份「5 天前的快照」，页面必须：
  //   ① 明确提示快照滞后；② 未开打的对阵标成「待确认」（不显示可能过时的队名）；
  //   ③ 给出官方对阵图出口。
  const stalePage = await ctx.newPage();
  await stalePage.route('**/data/schedule.json*', async (route) => {
    const res = await route.fetch();
    const body = await res.json();
    body.updatedAt = new Date(Date.now() - 5 * 86400000).toISOString();
    await route.fulfill({
      status: 200,
      contentType: 'application/json; charset=utf-8',
      body: JSON.stringify(body),
    });
  });
  await stalePage.goto(base + '/#/schedule', { waitUntil: 'domcontentloaded' });
  await stalePage.waitForTimeout(5000);
  const stale = await stalePage.evaluate(() => ({
    banner: !!document.querySelector('.sched-stale'),
    bannerText: (document.querySelector('.sched-stale') || {}).textContent || '',
    pending: document.querySelectorAll('.bracket-row.unconfirmed').length,
    pendingText: (document.querySelector('.bracket-row.unconfirmed .babbr') || {}).textContent || '',
    label: (document.querySelector('.updated-at') || {}).textContent || '',
    link: (document.querySelector('.sched-stale .ss-link') || {}).href || '',
  }));
  console.log('   陈旧快照: ' + JSON.stringify(stale));
  check('赛程快照陈旧时给出明确提示', stale.banner && /滞后|落后/.test(stale.bannerText), stale.label);
  check('陈旧快照下未开打对阵标为「待确认」', stale.pending >= 1 && /待确认/.test(stale.pendingText), 'pending=' + stale.pending);
  check('陈旧提示给出官方对阵图出口', /lpl\.qq\.com/.test(stale.link), stale.link);
  await stalePage.close();

  /* ---------------- 远端数据源（赛程自动更新的通道） ---------------- */
  // 站点把「本地烘焙快照」与「远端数据源」两份都读回来，按 updatedAt 取更新的那份。
  // 这条链路是「赛程像录像一样自动更新」的实现基础：CI 只需更新 JSON 文件，
  // 不必重新部署站点；远端不可用时必须干净地回退本地快照。
  const remoteDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lpltv-remote-'));
  const localSched = JSON.parse(fs.readFileSync(path.join(SITE, 'data', 'schedule.json'), 'utf8'));
  const localCat = JSON.parse(fs.readFileSync(path.join(SITE, 'data', 'catalog.json'), 'utf8'));
  // 远端必须比本地新（用「本地 + 1 小时」保证无论何时跑都比本地新）
  const remoteIso = new Date((Date.parse(localSched.updatedAt) || Date.now()) + 3600000).toISOString();
  const remoteMatches = [
    {
      id: '',
      title: '远端测试 RA vs RB',
      game: '远端测试赛',
      phase: '测试轮',
      mode: 'BO5',
      date: '2026-10-29 10:00:00',
      duration: 0,
      cover: '',
      teamA: 'RA',
      teamB: 'RB',
      teamIdA: '',
      teamIdB: '',
      score: '1:0',
      place: '',
      published: false,
      bvid: '',
      biliPage: 0,
    },
  ];
  fs.writeFileSync(
    path.join(remoteDir, 'schedule.json'),
    JSON.stringify({ updatedAt: remoteIso, source: '远端测试源', total: remoteMatches.length, matches: remoteMatches })
  );
  fs.writeFileSync(
    path.join(remoteDir, 'catalog.json'),
    JSON.stringify({ updatedAt: remoteIso, matches: (localCat.matches || []).concat(remoteMatches) })
  );
  fs.writeFileSync(
    path.join(remoteDir, 'liverooms.json'),
    JSON.stringify({ updatedAt: remoteIso, rooms: [], externalRooms: [] })
  );
  const remoteServer = http.createServer((req, res) => {
    const p = decodeURIComponent(req.url.split('?')[0]);
    const file = path.join(remoteDir, p);
    if (!file.startsWith(remoteDir) || !fs.existsSync(file)) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('404');
      return;
    }
    res.writeHead(200, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'Access-Control-Allow-Origin': '*',
    });
    fs.createReadStream(file).pipe(res);
  });
  const remotePort = await new Promise((r) => remoteServer.listen(0, '127.0.0.1', () => r(remoteServer.address().port)));
  const remoteBase = `http://127.0.0.1:${remotePort}`;

  const remotePage = await ctx.newPage();
  await remotePage.addInitScript((b) => {
    window.__LPLTV_DATA_BASE__ = b;
  }, remoteBase);
  await remotePage.goto(base + '/#/schedule', { waitUntil: 'domcontentloaded' });
  await remotePage.waitForTimeout(4500);
  const remoteState = await remotePage.evaluate(() => ({
    label: (document.querySelector('.updated-at') || {}).textContent || '',
    text: (document.body.innerText || '').replace(/\s+/g, ' ').slice(0, 3000),
  }));
  const remoteMark = new Date(remoteIso);
  const remoteDay =
    remoteMark.getFullYear() +
    '-' +
    String(remoteMark.getMonth() + 1).padStart(2, '0') +
    '-' +
    String(remoteMark.getDate()).padStart(2, '0');
  console.log('   远端数据源: ' + JSON.stringify(remoteState.label));
  check(
    '远端数据源被采用（快照时间取更新的那份并标注来源）',
    /远端实时数据/.test(remoteState.label) && remoteState.label.indexOf(remoteDay) >= 0,
    remoteState.label
  );
  check('远端赛程内容真正生效（不只是标签变了）', /RA/.test(remoteState.text), remoteState.text.slice(0, 90));
  await remotePage.close();

  // 远端不可用 → 必须回退本地快照，站点照常可用
  const deadPage = await ctx.newPage();
  await deadPage.addInitScript(() => {
    window.__LPLTV_DATA_BASE__ = 'http://127.0.0.1:1/nope';
  });
  await deadPage.goto(base + '/#/schedule', { waitUntil: 'domcontentloaded' });
  await deadPage.waitForTimeout(6000);
  const deadState = await deadPage.evaluate(() => ({
    label: (document.querySelector('.updated-at') || {}).textContent || '',
    rows: document.querySelectorAll('.bracket-row').length,
    err: document.querySelector('.state h3') ? document.querySelector('.state h3').textContent : '',
  }));
  console.log('   远端挂掉时: ' + JSON.stringify(deadState));
  check(
    '远端不可用时回退本地快照（站点仍可用）',
    deadState.rows > 0 && !/远端实时数据/.test(deadState.label) && !deadState.err,
    'rows=' + deadState.rows + ' err=' + deadState.err
  );
  await deadPage.close();
  remoteServer.close();

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

  /* ---------------- 赛程快照 vs 腾讯上游（数据级判据） ---------------- */
  console.log('\n[赛程数据正确性]');
  const UA_QQ =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';
  async function upstreamMatches() {
    const url = 'https://lpl.qq.com/web201612/data/LOL_MATCH2_MATCH_HOMEPAGE_BMATCH_LIST.js';
    const res = await fetch(url, { headers: { 'User-Agent': UA_QQ, Referer: 'https://lpl.qq.com/' } });
    const j = JSON.parse(await res.text());
    return { list: j.msg || [], lastUpTime: j.lastUpTime || '' };
  }
  function normTeam(s) {
    return String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  }
  try {
    const up = await upstreamMatches();
    const local = JSON.parse(fs.readFileSync(path.join(SITE, 'data', 'schedule.json'), 'utf8'));
    const lm = local.matches || [];
    // 今天及以后的场次：本地快照与腾讯上游必须完全一致 ——
    // 这正是「已淘汰的队伍还挂在后续赛程里」这类错误的根因。
    const cutoff = todayKey();
    const upF = upstreamKeys(up.list, cutoff);
    const loF = localKeys(lm, cutoff);
    const missing = [...upF].filter((k) => !loF.has(k));
    const extra = [...loF].filter((k) => !upF.has(k));
    console.log(
      `   上游 ${up.lastUpTime} · 上游今天起 ${upF.size} 场 · 本地 ${loF.size} 场 · 缺 ${missing.length} / 多 ${extra.length}`
    );
    check(
      '赛程快照与腾讯上游一致（已淘汰队伍不会残留在后续赛程）',
      missing.length === 0 && extra.length === 0,
      `缺 ${missing.length} 多 ${extra.length}` + (missing.length ? ' 例:' + missing[0] : '')
    );
    const snapTs = Date.parse(local.updatedAt || '');
    const ageH = (Date.now() - snapTs) / 3600000;
    check('赛程快照时间在 48 小时内', isFinite(ageH) && ageH < 48, `滞后 ${Math.round(ageH)} 小时`);
  } catch (e) {
    check('赛程快照与腾讯上游一致（已淘汰队伍不会残留在后续赛程）', false, '上游抓取失败：' + e.message);
  }

  // B 站源年份校验：标题里的年份/日期不得与比赛对不上
  try {
    const cat = JSON.parse(fs.readFileSync(path.join(SITE, 'data', 'catalog.json'), 'utf8'));
    const bad = (cat.matches || []).filter((m) => {
      const t = m.biliTitle || m.biliPart || '';
      if (!t) return false;
      const y = String(m.date || '').slice(0, 4);
      if (!/^\d{4}$/.test(y)) return false;
      const ys = [...new Set(t.match(/20\d{2}/g) || [])];
      return ys.length && !ys.includes(y);
    });
    check('B 站录像源没有年份错配', bad.length === 0, bad.length ? bad.slice(0, 3).map((m) => m.title).join(' | ') : '');
  } catch (e) {
    check('B 站录像源没有年份错配', false, e.message);
  }

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
