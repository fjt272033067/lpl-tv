/* 精确定位：点击「关闭弹幕」后，reset() 到底有没有被调用 */
import { resolvePlaywright } from './resolve-playwright.mjs';
const { chromium } = resolvePlaywright().pw;
const SITE = process.argv[2] || 'http://127.0.0.1:8791';
const ID = process.argv[3] || 'u4102m15w3z';

const browser = await chromium.launch({
  headless: true,
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required', '--mute-audio'],
});
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
page.on('pageerror', (e) => console.log('[pageerror]', String(e.message).slice(0, 200)));
await page.goto(`${SITE}/#/watch/${ID}`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(9000);

const r = await page.evaluate(() => {
  const dm0 = window.__dm;
  const log = { resetCalls: 0, stopCalls: 0, spawnAfter: 0 };
  const origReset = dm0.reset.bind(dm0);
  const origStop = dm0.stop.bind(dm0);
  const origSpawn = dm0._spawn.bind(dm0);
  dm0.reset = function () { log.resetCalls++; return origReset(); };
  dm0.stop = function () { log.stopCalls++; return origStop(); };
  dm0._spawn = function (it) { log.spawnAfter++; return origSpawn(it); };

  const before = { dom: document.querySelectorAll('.dm-item').length, active: dm0.active.length };

  document.querySelector('[data-ctl="danmaku"]').click();
  const m = document.querySelector('.menu[data-menu="dm"]');
  const item = [...m.querySelectorAll('.menu-item')].find((x) => /关闭弹幕/.test(x.textContent));
  item.click();

  const after = {
    dom: document.querySelectorAll('.dm-item').length,
    active: dm0.active.length,
    sameEngine: window.__dm === dm0,
    playing: dm0.playing,
    log: JSON.parse(JSON.stringify(log)),
    menuOpen: !!document.querySelector('.menu[data-menu="dm"]'),
    btnClass: document.querySelector('[data-ctl="danmaku"]').className,
  };
  return { before, after };
});
console.log(JSON.stringify(r, null, 1));
await page.waitForTimeout(2000);
const later = await page.evaluate(() => ({
  dom: document.querySelectorAll('.dm-item').length,
  active: window.__dm.active.length,
  playing: window.__dm.playing,
}));
console.log('2 秒后:', JSON.stringify(later));
await browser.close();
