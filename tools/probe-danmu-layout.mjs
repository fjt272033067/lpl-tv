/* =====================================================================
 * probe-danmu-layout.mjs — 弹幕布局实测（不是猜，是量）
 *
 * 核心测量：**画面上的弹幕元素数（DOM） vs 引擎认为在飞的弹幕数（active）**
 *   两者不等 = 有「摘不掉的残留弹幕」冻结在画面上（用户看到的右侧那一堆重叠）。
 * 另外测：重叠对数、是否在动、拖进度条后的表现。
 *
 * 用法：node tools/probe-danmu-layout.mjs [线上地址] [录像id]
 * ===================================================================== */
import { resolvePlaywright } from './resolve-playwright.mjs';
const { chromium } = resolvePlaywright().pw;

const SITE = (process.argv[2] || 'https://4kf9kfxujfhg2.space.mcode.cn').replace(/\/+$/, '');
const ID = process.argv[3] || 'u4102m15w3z';

const browser = await chromium.launch({
  headless: process.env.HEADED !== '1',
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required', '--mute-audio'],
});
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
page.on('pageerror', (e) => console.log('  [pageerror]', String(e.message).slice(0, 160)));

await page.goto(`${SITE}/#/watch/${ID}`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(9000);

const snap = async () =>
  await page.evaluate(() => {
    const dm = window.__dm;
    if (!dm) return { err: 'no __dm' };
    const nodes = [...document.querySelectorAll('.dm-item')];
    const items = nodes.map((e) => {
      const r = e.getBoundingClientRect();
      return { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height), t: (e.textContent || '').slice(0, 10) };
    });
    let overlap = 0;
    for (let i = 0; i < items.length; i++) {
      for (let j = i + 1; j < items.length; j++) {
        const a = items[i], b = items[j];
        if (a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h) overlap++;
      }
    }
    const video = document.querySelector('video');
    const root = dm.root.getBoundingClientRect();
    return {
      domNodes: nodes.length,
      active: dm.active.length,
      leftover: nodes.length - dm.active.length,
      overlap,
      engine: { _w: dm._w, _h: dm._h, tracks: dm._trackCount, laneH: Math.round(dm._laneH), cursor: dm.cursor, time: Math.round(dm.time * 10) / 10, items: dm.items.length, spawned: dm.stats.spawned },
      canvas: [Math.round(root.left), Math.round(root.top), Math.round(root.width), Math.round(root.height)],
      videoTime: video ? Math.round(video.currentTime * 10) / 10 : null,
      items: items.slice(0, 6),
    };
  });

const line = (tag, s) => {
  if (s.err) { console.log(tag + ' ' + s.err); return; }
  console.log(
    tag +
      ' 画面元素=' + String(s.domNodes).padStart(3) +
      ' 在飞=' + String(s.active).padStart(3) +
      ' 残留=' + String(s.leftover).padStart(3) +
      ' 重叠对=' + String(s.overlap).padStart(3) +
      ' 游标=' + String(s.engine.cursor).padStart(3) + '/' + s.engine.items +
      ' 视频时间=' + s.videoTime + 's'
  );
};

console.log('=== ① 刚播起来 ===');
let a = await snap();
line('  ', a);

console.log('\n=== ② 1.5 秒后再看（弹幕应���在动，且残留应恒为 0）===');
await page.waitForTimeout(1500);
let b = await snap();
line('  ', b);

console.log('\n=== ③ 模拟拖进度条（+300 秒）===');
await page.evaluate(() => {
  const v = document.querySelector('video');
  v.currentTime = Math.min((v.duration || 600) - 5, (v.currentTime || 0) + 300);
});
await page.waitForTimeout(2500);
let c = await snap();
line('  ', c);
console.log('   前 6 条：');
for (const it of c.items || []) console.log('     x=' + String(it.x).padStart(5) + ' y=' + String(it.y).padStart(4) + ' w=' + String(it.w).padStart(4) + '  ' + it.t);

console.log('\n=== ④ 再等 3 秒（弹幕应继续滚动，不该堆在原地）===');
await page.waitForTimeout(3000);
let d = await snap();
line('  ', d);
for (const it of d.items || []) console.log('     x=' + String(it.x).padStart(5) + ' y=' + String(it.y).padStart(4) + '  ' + it.t);

console.log('\n=== 判定（布局）===');
const bad = [a, b, c, d].filter((s) => !s.err && (s.leftover > 0 || s.overlap > 0));
console.log(bad.length ? 'FAIL 有残留/重叠：' + bad.map((s) => '残留' + s.leftover + '/重叠' + s.overlap).join('， ') : 'PASS 无残留、无重叠');

/* ---------- 关闭弹幕入口 ---------- */
console.log('\n=== ⑤ 弹幕按钮 → 菜单里有没有「关闭弹幕」===');
const menu = await page.evaluate(() => {
  const btn = document.querySelector('[data-ctl="danmaku"]');
  if (!btn) return { err: 'no danmaku button' };
  btn.click();
  const m = document.querySelector('.menu[data-menu="dm"]');
  const items = [...(m ? m.querySelectorAll('.menu-item') : [])].map((x) => x.textContent.trim());
  return { visible: m ? getComputedStyle(m).display !== 'none' : false, items };
});
console.log('  菜单项：' + JSON.stringify(menu.items || menu.err));

const clicked = await page.evaluate(() => {
  const m = document.querySelector('.menu[data-menu="dm"]');
  const item = [...(m ? m.querySelectorAll('.menu-item') : [])].find((x) => /关闭弹幕/.test(x.textContent));
  if (!item) return false;
  item.click();
  return true;
});
console.log('  点到「关闭弹幕」：' + (clicked ? '是' : '否'));
await page.waitForTimeout(3000);
const off = await page.evaluate(() => {
  const layer = document.querySelector('.dm-layer') || document.querySelector('[class*="dm-layer"]');
  const nodes = document.querySelectorAll('.dm-item').length;
  const dm = window.__dm;
  return {
    layerDisplay: layer ? getComputedStyle(layer).display : '(no layer)',
    nodes,
    active: dm ? dm.active.length : -1,
    playing: dm ? dm.playing : null,
    menuItems: [...document.querySelectorAll('.menu[data-menu="dm"] .menu-item')].map((x) => x.textContent.trim()),
  };
});
console.log('  关闭后：' + JSON.stringify(off));
console.log('  ' + (clicked && off.nodes === 0 && off.active === 0 && off.playing === false ? 'PASS 弹幕已关闭且不再生成' : 'FAIL 关闭不彻底'));

console.log('\n=== ⑥ 重新打开弹幕 ===');
const reopened = await page.evaluate(() => {
  const btn = document.querySelector('[data-ctl="danmaku"]');
  btn.click();
  const m = document.querySelector('.menu[data-menu="dm"]');
  const item = [...(m ? m.querySelectorAll('.menu-item') : [])].find((x) => /开启弹幕/.test(x.textContent));
  if (!item) return false;
  item.click();
  return true;
});
await page.waitForTimeout(2500);
const on = await page.evaluate(() => {
  const layer = document.querySelector('.dm-layer') || document.querySelector('[class*="dm-layer"]');
  const dm = window.__dm;
  return {
    layerDisplay: layer ? getComputedStyle(layer).display : '(no layer)',
    nodes: document.querySelectorAll('.dm-item').length,
    active: dm ? dm.active.length : -1,
    playing: dm ? dm.playing : null,
    btnOn: document.querySelector('[data-ctl="danmaku"]').classList.contains('on'),
  };
});
console.log('  重新打开：' + (reopened ? '已点' : '没找到「开启弹幕」项') + ' ' + JSON.stringify(on));
console.log('  ' + (reopened && on.layerDisplay !== 'none' && on.btnOn ? 'PASS 弹幕可重新开启' : 'FAIL 重新开启失败'));

await browser.close();
