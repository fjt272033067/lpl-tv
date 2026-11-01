/* =====================================================================
 * capture-danmu.mjs — 抓一张「弹幕正常渲染」的截图（用于验收/展示）
 *
 * 做法跟 verify.mjs 一样：找到弹幕最密集的 10 秒窗口，seek 过去，等弹幕铺开再截图。
 *
 * 用法：node tools/capture-danmu.mjs [站点地址] [录像id]
 * ===================================================================== */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolvePlaywright } from './resolve-playwright.mjs';

const { chromium } = resolvePlaywright().pw;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'docs', '申诉材料');

const SITE = (process.argv[2] || 'https://4kf9kfxujfhg2.space.mcode.cn').replace(/\/+$/, '');
const ID = process.argv[3] || 'u4102m15w3z';

// 从本地 catalog 找这个录像的 cid（弹幕文件名用的是 cid）
let cid = '';
try {
  const cat = JSON.parse(fs.readFileSync(path.join(ROOT, 'site', 'data', 'catalog.json'), 'utf8'));
  const m = (cat.matches || []).find((x) => x.id === ID);
  if (m) cid = String(m.cid);
} catch (e) {}
console.log('录像 id=' + ID + ' cid=' + (cid || '(本地无)'));

const browser = await chromium.launch({
  headless: process.env.HEADED !== '1',
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required', '--mute-audio'],
});
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
await page.goto(`${SITE}/#/watch/${ID}`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(9000);

// 找最密集的窗口并 seek 过去
const target = await page.evaluate(async (c) => {
  let t = 30;
  try {
    const r = await fetch('data/dm/' + c + '.json');
    const j = await r.json();
    const times = (j.items || []).map((i) => i[0]).sort((a, b) => a - b);
    let best = 0, bestN = -1, j0 = 0;
    for (let j1 = 0; j1 < times.length; j1++) {
      while (times[j1] - times[j0] > 10) j0++;
      if (j1 - j0 > bestN) { bestN = j1 - j0; best = times[j0]; }
    }
    if (times.length) t = best;
  } catch (e) {}
  const v = document.querySelector('.player video');
  if (v) v.currentTime = t;
  return t;
}, cid);

await page.waitForTimeout(5000);
const st = await page.evaluate(() => {
  const nodes = [...document.querySelectorAll('.dm-canvas .dm-item')];
  const e = window.__dm;
  return { dom: nodes.length, active: e ? e.active.length : -1, sample: nodes.slice(0, 3).map((n) => n.textContent.slice(0, 14)) };
});
console.log('seek 到 ' + Math.round(target) + 's，画面弹幕：' + JSON.stringify(st));

fs.mkdirSync(OUT, { recursive: true });
const p = path.join(OUT, '05-弹幕渲染正常.png');
await page.screenshot({ path: p });
console.log('已保存：' + p);

await browser.close();
