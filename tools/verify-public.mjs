/* 线上验收：直接跑已部署的公网地址 */
import { resolvePlaywright } from './resolve-playwright.mjs';
import { decodePng, frameStats } from './pngdiff.mjs';

const { chromium } = resolvePlaywright().pw;

const URL = process.argv[2] || 'https://4kf9kfxujfhg2.space.mcode.cn';
const results = [];
const check = (n, p, d) => {
  results.push({ n, p: !!p, d: d || '' });
  console.log(`  ${p ? 'PASS' : 'FAIL'}  ${n}${d ? ' — ' + d : ''}`);
};

const browser = await chromium.launch({
  // 用有头浏览器：B 站对无头浏览器会弹验证码/黑屏，那不是真实用户环境。
  // 需要 CI 环境时设 HEADLESS=1（届时抽屉的「画面变化率」断言可能不成立）。
  headless: process.env.HEADLESS === '1',
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required', '--mute-audio', '--window-size=1440,900'],
});
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
const errs = [];
// 过滤第三方 iframe（B 站直播间页）自身产生的跨域告警 —— 不是本站缺陷
const NOISE = /Blocked a frame with origin|permissions policy|compute pressure|biliBridgePc/i;
const NOISE_SRC = /hdslb\.com|live\.bilibili\.com/;
let inDrawer = false;
page.on('pageerror', (e) => {
  const s = String(e && e.message ? e.message : e);
  const stack = String((e && e.stack) || '');
  if (NOISE.test(s) || NOISE_SRC.test(stack)) return;
  errs.push(s.slice(0, 160));
});

console.log(`线上验收： ${URL}\n`);

console.log('[1] 静态资源');
const assets = await page.evaluate(async (base) => {
  const out = {};
  for (const p of ['/', '/assets/app.js', '/assets/danmaku.js', '/assets/style.css', '/assets/vendor/hls.min.js', '/data/catalog.json', '/data/liverooms.json']) {
    const r = await fetch(base + p, { method: 'HEAD' });
    out[p] = r.status;
  }
  return out;
}, URL);
console.log('   ' + JSON.stringify(assets));
check('首页可访问', assets['/'] === 200);
check('app.js / danmaku.js / hls.js 可访问', assets['/assets/app.js'] === 200 && assets['/assets/danmaku.js'] === 200 && assets['/assets/vendor/hls.min.js'] === 200);
check('catalog.json 可访问', assets['/data/catalog.json'] === 200);

console.log('\n[2] 直播页');
await page.goto(URL + '/#/live', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(16000);
const live = await page.evaluate(() => {
  const v = document.querySelector('.player video');
  const m = document.querySelector('.menu[data-menu="quality"]');
  return {
    w: v ? v.videoWidth : 0,
    rs: v ? v.readyState : -1,
    q: m ? m.querySelectorAll('.menu-item').length : 0,
    tags: [...document.querySelectorAll('.player-top .badge')].map((b) => b.textContent.trim()),
    rows: document.querySelectorAll('.side-row').length,
  };
});
console.log('   ' + JSON.stringify(live));
// 直播可能正处于「无信号」状态（赛事刚结束/未开播）——此时站点必须给出明确提示，而不是黑屏
const liveMsg = await page.evaluate(() => {
  const m = document.querySelector('.player-msg');
  return m && getComputedStyle(m).display !== 'none' ? m.textContent.trim() : '';
});
if (live.w > 0 && live.rs >= 2) {
  check('直播已开始播放', true, live.w + 'px');
  // 关键判据：不仅要「元素在、尺寸非 0」，还要确认真的解出了画面（不是全黑）。
  // 腾讯常驻锚点挂的是失效流，元素存在但画面全黑 —— 只断言元素存在会漏判。
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
    return { decoded: true, nonBlack: +(nonBlack / (d.length / 4)).toFixed(3) };
  });
  console.log('   直播画面: ' + JSON.stringify(liveFrame));
  check('直播真的解码出画面（非黑屏）', liveFrame.nonBlack > 0.05, 'nonBlack=' + liveFrame.nonBlack);
} else {
  check(
    '无直播信号时给出明确提示（非黑屏无解释）',
    /暂无直播信号|信号|结束|准备/.test(liveMsg),
    liveMsg || '（无提示）'
  );
}
// 清晰度档位随线路变化（腾讯多档 / B 站单档），判据是「有可用档位」
check('清晰度有可用档位', live.q >= 1, 'items=' + live.q);
check('直播赛事信息已展示', live.rows >= 3, 'rows=' + live.rows);

// 直播倍速：hls.js 不得覆写用户选择的倍速
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

// 线路切换
const lines = await page.evaluate(() => {
  const btn = document.querySelector('[data-ctl="source"]');
  if (!btn) return { err: 'no source button' };
  btn.click();
  const menu = document.querySelector('.menu[data-menu="source"]');
  const items = [...menu.querySelectorAll('.menu-item')].map((i) => i.textContent.trim());
  return { items };
});
console.log('   线路: ' + JSON.stringify(lines));
check('播放器提供线路切换菜单', (lines.items || []).length >= 1, (lines.items || []).join(' / ') || lines.err);
check(
  '线路菜单含可站内播放的直播源',
  (lines.items || []).some((t) => /B站/.test(t)) || (lines.items || []).some((t) => /腾讯/.test(t)),
  (lines.items || []).length + ' 条'
);
check(
  '线路菜单含斗鱼/虎牙等其它平台',
  (lines.items || []).some((t) => /斗鱼/.test(t)) && (lines.items || []).some((t) => /虎牙/.test(t)),
  (lines.items || []).filter((t) => /斗鱼|虎牙/.test(t)).join(' | ') || '无'
);
const distinctLines = new Set((lines.items || []).map((t) => t.replace(/^[✓\s]*/, '').split('·')[0].trim())).size;
check('各线路文案互不相同', distinctLines >= Math.min(3, (lines.items || []).length), distinctLines + ' 种');

// 休赛期（没有赛事在播）通知条应如实标注无信号，而不是继续显示「正在直播」
const stripState = await page.evaluate(() => ({
  label: ((document.querySelector('.live-strip .strip-label') || {}).textContent || '').trim(),
  items: document.querySelectorAll('.live-strip .strip-item').length,
}));
console.log('   通知条: ' + JSON.stringify(stripState));
check(
  '通知条状态如实（有直播才显示「正在直播」）',
  stripState.items > 0 ? /正在直播/.test(stripState.label) : /暂无直播|无信号/.test(stripState.label),
  stripState.label + ' items=' + stripState.items
);

// 视觉/体验判据
const visual = await page.evaluate(() => {
  const panels = document.querySelectorAll('.side-panel');
  const cards = [...document.querySelectorAll('.card')];
  const withShot = cards.filter((c) => c.querySelector('.card-cover .shot'));
  const platColors = cards
    .map((c) => (c.querySelector('.card-hd') || {}).className || '')
    .filter((c) => /plat-/.test(c));
  const hero = document.querySelector('.hero');
  return {
    panels: panels.length,
    cards: cards.length,
    withShot: withShot.length,
    platKinds: [...new Set(platColors.map((c) => (c.match(/plat-\w+/) || [''])[0]))],
    banner: !!document.querySelector('.event-banner'),
    bannerLogos: document.querySelectorAll('.event-banner .eb-side img').length,
    toTop: !!document.querySelector('.to-top'),
    stripItems: document.querySelectorAll('.live-strip .strip-item').length,
    heroFirstIsPlayer: !!(
      hero &&
      hero.firstElementChild &&
      hero.firstElementChild.querySelector('.player')
    ),
  };
});
console.log('   视觉: ' + JSON.stringify(visual));
check('比赛信息卡片不重复', visual.panels <= 1, visual.panels + ' 个侧栏');
check('播放器在主区（左右列未颠倒）', visual.heroFirstIsPlayer);
check('线路卡片有预览缩略图', visual.withShot > 0, visual.withShot + '/' + visual.cards + ' 张');
check('平台标签有区分色', visual.platKinds.length >= 2, visual.platKinds.join(','));
check('赛事横幅已渲染', visual.banner, visual.bannerLogos + ' 个队徽');
check('有回到顶部按钮', visual.toTop);
check('通知条为单行紧凑信息', visual.stripItems > 0, visual.stripItems + ' 项');

// 音量可调 + 记忆
const volTest = await page.evaluate(async () => {
  const v = document.querySelector('.player video');
  const input = document.querySelector('.ctrl-vol input[type=range]');
  if (!v || !input) return { err: 'no video / no volume input' };
  input.value = '0.4';
  input.dispatchEvent(new Event('input', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 300));
  let saved = null;
  try { saved = localStorage.getItem('lpltv_volume'); } catch (e) {}
  return { after: v.volume, saved };
});
console.log('   音量: ' + JSON.stringify(volTest));
check(
  '音量可调节并被记住',
  Math.abs(volTest.after - 0.4) < 0.02 && volTest.saved !== null,
  `after=${volTest.after} saved=${volTest.saved} ${volTest.err || ''}`
);

// 站内「刷新数据」按钮
const refreshed = await page.evaluate(async () => {
  const btn = document.querySelector('#refresh-btn');
  if (!btn) return { err: 'no refresh button' };
  btn.click();
  await new Promise((r) => setTimeout(r, 4000));
  return {
    hasButton: true,
    playerStillThere: !!document.querySelector('.player video'),
    tags: document.querySelectorAll('.player-top .badge').length,
  };
});
console.log('   刷新: ' + JSON.stringify(refreshed));
check(
  '站内刷新按钮可用（重拉运行时数据不报错）',
  refreshed.hasButton && refreshed.playerStillThere,
  refreshed.err || 'player=' + refreshed.playerStillThere
);

console.log('\n[3] 录像库 + 播放 + 弹幕');
await page.goto(URL + '/#/vod', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(4500);
const vod = await page.evaluate(async () => {
  const cards = [...document.querySelectorAll('.card')];
  const cat = await fetch('data/catalog.json').then((r) => r.json());
  const bakedMax = cat.matches.map((m) => m.date).filter(Boolean).sort().pop() || '';
  const firstMeta = cards[0] ? (cards[0].querySelector('.card-meta') || {}).textContent || '' : '';
  return {
    cards: cards.length,
    dm: document.querySelectorAll('.card-dm').length,
    officialBadges: [...document.querySelectorAll('.card-dm')].filter((b) => b.textContent.trim() === '官方').length,
    bakedMax: bakedMax.slice(0, 10),
    firstDate: (firstMeta.match(/\d{4}-\d{2}-\d{2}/) || [''])[0],
    updatedAt: document.querySelector('.updated-at') ? document.querySelector('.updated-at').textContent : '',
  };
});
console.log('   ' + JSON.stringify(vod));
check('录像库有卡片', vod.cards > 0, 'cards=' + vod.cards);
check('官方最新内容已并入主列表（非独立板块）', vod.officialBadges > 0, '官方标记=' + vod.officialBadges);
check(
  '主列表比烘焙目录更新（实时生效）',
  !!vod.firstDate && !!vod.bakedMax && vod.firstDate >= vod.bakedMax,
  `首条=${vod.firstDate} 烘焙最新=${vod.bakedMax}`
);
check('显示回放快照时间', /快照|更新于/.test(vod.updatedAt), vod.updatedAt);

const picked = await page.evaluate(() => {
  const cards = [...document.querySelectorAll('.card')];
  let best = null, bestN = -1;
  cards.forEach((c) => {
    const n = Number(c.getAttribute('data-dm') || 0);
    if (n > bestN) { bestN = n; best = c; }
  });
  if (!best) return null;
  const r = { id: best.getAttribute('data-id'), cid: best.getAttribute('data-cid'), dm: bestN };
  best.click();
  return r;
});
console.log('   选中 ' + JSON.stringify(picked));
await page.waitForTimeout(11000);

const w = await page.evaluate(async (cid) => {
  const v = document.querySelector('.player video');
  let target = 30;
  if (cid) {
    try {
      const r = await fetch('data/dm/' + cid + '.json');
      const j = await r.json();
      const times = (j.items || []).map((i) => i[0]).sort((a, b) => a - b);
      let best = 0, bestN = -1, j0 = 0;
      for (let j1 = 0; j1 < times.length; j1++) {
        while (times[j1] - times[j0] > 10) j0++;
        if (j1 - j0 > bestN) { bestN = j1 - j0; best = times[j0]; }
      }
      if (times.length) target = best;
    } catch (e) {}
  }
  v.currentTime = target;
  let items = 0;
  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 500));
    items = document.querySelectorAll('.dm-canvas .dm-item').length;
    if (items > 0) break;
  }
  const nodes = [...document.querySelectorAll('.dm-canvas .dm-item')];
  return {
    w: v.videoWidth, h: v.videoHeight, dur: Math.round(v.duration),
    items, sample: nodes.slice(0, 3).map((n) => n.textContent.slice(0, 14)),
    speed: document.querySelector('.menu[data-menu="speed"]') ? document.querySelector('.menu[data-menu="speed"]').querySelectorAll('.menu-item').length : 0,
  };
}, picked.cid);
console.log('   ' + JSON.stringify(w));
check('录像可播放（720P）', w.w === 1280 && w.h === 720, w.w + 'x' + w.h);
check('倍速菜单 8 档', w.speed === 8);
check('B站弹幕渲染到画面', w.items > 0, 'items=' + w.items + ' ' + JSON.stringify(w.sample));

console.log('\n[4] 赛程页（官方赛事进度视图）');
await page.goto(URL + '/#/schedule', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(4500);
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

// 赛程行点击看录播：腾讯源 → 站内播放页；B 站源 → 新标签打开 B 站视频
const vodRows = await page.evaluate(() => ({
  tx: document.querySelectorAll('.bracket-row.has-vod:not(.bili-only)').length,
  bili: document.querySelectorAll('.bracket-row.bili-only').length,
  none: document.querySelectorAll('.bracket-row.no-vod').length,
}));
console.log('   可回放行: ' + JSON.stringify(vodRows));
check('至少有一行可点看录播', vodRows.tx + vodRows.bili > 0, `腾讯源 ${vodRows.tx} / B站源 ${vodRows.bili}`);

const schClick = await page.evaluate(async () => {
  const row = document.querySelector('.bracket-row.has-vod:not(.bili-only)');
  if (!row) return { err: 'no tx row' };
  row.click();
  await new Promise((r) => setTimeout(r, 2500));
  return {
    hash: location.hash,
    hasVideo: !!document.querySelector('.watch video'),
  };
});
console.log('   赛程点击: ' + JSON.stringify(schClick));
check(
  '点击赛程行进入播放页',
  /^#\/watch\//.test(schClick.hash || '') && schClick.hasVideo,
  schClick.hash || schClick.err || ''
);

// 上一步点进了播放页，必须先回到赛程页，否则赛程行根本不在 DOM 里
await page.goto(URL + '/#/schedule', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(3000);
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
await page.screenshot({ path: 'data/ui-smoke/07-schedule.png' });

console.log('\n[5] 移动端');
const mob = await browser.newPage({ viewport: { width: 390, height: 844 } });
await mob.goto(URL + '/#/vod', { waitUntil: 'domcontentloaded' });
await mob.waitForTimeout(4000);
await mob.screenshot({ path: 'data/ui-smoke/08-mobile-vod.png' });
const mobLayout = await mob.evaluate(() => {
  const grid = document.querySelector('.grid');
  const btn = document.querySelector('.ctrl-btn');
  const sel = document.querySelector('.filters select');
  const lbl = document.querySelector('.filters label');
  return {
    cols: grid ? getComputedStyle(grid).gridTemplateColumns.split(' ').length : 0,
    btnH: btn ? Math.round(btn.getBoundingClientRect().height) : 0,
    selW: sel ? Math.round(sel.getBoundingClientRect().width) : 0,
    labelH: lbl ? Math.round(lbl.getBoundingClientRect().height) : 0,
    overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    wxTipHidden: (() => {
      const t = document.querySelector('#wx-tip');
      return !t || t.hidden || getComputedStyle(t).display === 'none';
    })(),
  };
});
console.log('   ' + JSON.stringify(mobLayout));
check('移动端网格两列', mobLayout.cols === 2, 'cols=' + mobLayout.cols);
check('移动端触控按钮 ≥36px', mobLayout.btnH >= 36, mobLayout.btnH + 'px');
check('移动端无横向溢出', mobLayout.overflow <= 2, 'overflow=' + mobLayout.overflow + 'px');
check('微信提示条默认隐藏（非微信环境不打扰）', mobLayout.wxTipHidden);
check('移动端筛选下拉框可用（未被压扁）', mobLayout.selW >= 90, 'select 宽 ' + mobLayout.selW + 'px');
check('移动端筛选标签不竖排', mobLayout.labelH > 0 && mobLayout.labelH < 34, 'label 高 ' + mobLayout.labelH + 'px');

// 移动端直播页：菜单按钮图标 / 音量滑块 / 控制条不溢出
await mob.goto(URL + '/#/live', { waitUntil: 'domcontentloaded' });
await mob.waitForTimeout(7000);
await mob.screenshot({ path: 'data/ui-smoke/08b-mobile-live.png' });
const mobLive = await mob.evaluate(() => {
  const v = document.querySelector('.player video');
  const p = document.querySelector('.player');
  const iconBtns = {};
  ['quality', 'source', 'speed'].forEach((k) => {
    const b = document.querySelector('[data-ctl="' + k + '"]');
    if (!b) return;
    const ico = b.querySelector('.ico');
    iconBtns[k] = ico ? Math.round(ico.getBoundingClientRect().width) : 0;
  });
  const vol = document.querySelector('.ctrl-vol input');
  const ctrlRow = document.querySelector('.ctrl-row');
  const playerW = p ? Math.round(p.getBoundingClientRect().width) : 0;
  return {
    hasVideo: !!v,
    vw: v ? v.videoWidth : 0,
    playerW,
    iconBtns,
    volW: vol ? Math.round(vol.getBoundingClientRect().width) : 0,
    volVisible: vol ? getComputedStyle(vol.parentElement).display !== 'none' : false,
    ctrlRowW: ctrlRow ? Math.round(ctrlRow.getBoundingClientRect().width) : 0,
    overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
  };
});
console.log('   移动端直播: ' + JSON.stringify(mobLive));
check('移动端直播页无横向溢出', mobLive.overflow <= 2, 'overflow=' + mobLive.overflow + 'px');
check(
  '移动端清晰度/线路/倍速按钮有可见图标',
  mobLive.iconBtns.quality > 0 && mobLive.iconBtns.source > 0 && mobLive.iconBtns.speed > 0,
  JSON.stringify(mobLive.iconBtns)
);
check(
  '移动端音量滑块可见且可用',
  mobLive.volVisible && mobLive.volW >= 24,
  `visible=${mobLive.volVisible} width=${mobLive.volW}px`
);
check(
  '移动端控制条不溢出播放器',
  mobLive.ctrlRowW <= mobLive.playerW + 2,
  `ctrl ${mobLive.ctrlRowW}px vs player ${mobLive.playerW}px`
);

await mob.goto(URL + '/#/schedule', { waitUntil: 'domcontentloaded' });
await mob.waitForTimeout(3500);
await mob.screenshot({ path: 'data/ui-smoke/08c-mobile-schedule.png' });
const mobSch = await mob.evaluate(() => {
  const cols = [...document.querySelectorAll('.bracket-col')];
  const xs = cols.map((c) => Math.round(c.getBoundingClientRect().x));
  return {
    stacked: xs.length > 1 ? Math.max.apply(null, xs) - Math.min.apply(null, xs) < 4 : true,
    cols: cols.length,
    overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
  };
});
check('移动端对阵图纵向堆叠', mobSch.stacked, 'cols=' + mobSch.cols);
check('移动端赛程无横向溢出', mobSch.overflow <= 2, 'overflow=' + mobSch.overflow + 'px');
await mob.close();

console.log('\n[6] 控制台错误');
console.log(errs.length ? errs.slice(0, 5).map((e) => '   ' + e).join('\n') : '   （无）');

await browser.close();
const pass = results.filter((r) => r.p).length;
console.log(`\n===== 线上验收：${pass}/${results.length} 通过 =====`);
results.forEach((r) => { if (!r.p) console.log(`  ✗ ${r.n} ${r.d}`); });
process.exit(pass === results.length ? 0 : 1);
