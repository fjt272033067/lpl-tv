// Probe v18: what does Chrome actually do with the live JSONP response?
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('E:/lh-secrecy-edu/node_modules/playwright');

const browser = await chromium.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  args: ['--no-sandbox'],
});
const page = await browser.newPage();
page.on('console', (m) => console.log('  [console:' + m.type() + '] ' + m.text().slice(0, 220)));
page.on('pageerror', (e) => console.log('  [pageerror] ' + String(e).slice(0, 220)));
page.on('requestfailed', (r) => console.log('  [reqfail] ' + r.url().slice(0, 110) + ' :: ' + (r.failure() || {}).errorText));
page.on('response', (r) => {
  if (r.url().includes('commact') || r.url().includes('getinfo'))
    console.log('  [resp] ' + r.status() + ' ' + (r.headers()['content-type'] || '?') + ' ' + r.url().slice(0, 90));
});

await page.goto('https://example.com/', { waitUntil: 'domcontentloaded' }).catch(() => {});

for (const [tag, url] of [
  [
    'live commact (text/html)',
    'https://lol.sw.game.qq.com/lol/commact/?proj=a20200415livelink&c=a20200415livelink&a=getMatchScheduleList&callback=cbtest',
  ],
  [
    'vod getinfo (application/javascript)',
    'https://vv.video.qq.com/getinfo?otype=json&platform=101001&charge=0&vid=g4102dolw2l&callback=cbtest',
  ],
  [
    'static js (application/x-javascript)',
    'https://lpl.qq.com/web201612/data/LOL_MATCH2_LIVE_BMATCH_LIST.js',
  ],
]) {
  console.log(`\n=== ${tag} ===`);
  const res = await page.evaluate(
    (u) =>
      new Promise((resolve) => {
        let called = false;
        window.cbtest = (d) => {
          called = true;
          resolve({ called: true, keys: Object.keys(d || {}) });
        };
        const s = document.createElement('script');
        s.async = true;
        s.onload = () => setTimeout(() => resolve({ called, onload: true }), 2500);
        s.onerror = () => resolve({ called, onerror: true });
        s.src = u;
        document.head.appendChild(s);
        setTimeout(() => resolve({ called, timeout: true }), 9000);
      }),
    url
  );
  console.log('   -> ' + JSON.stringify(res));
}

await browser.close();
