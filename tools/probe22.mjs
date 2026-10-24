// 区分错误来源：不开抽屉 vs 开抽屉
import { resolvePlaywright } from './resolve-playwright.mjs';
const { chromium } = resolvePlaywright().pw;

const b = await chromium.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required', '--mute-audio'],
});
const p = await b.newPage();
const errs = [];
p.on('pageerror', (e) =>
  errs.push({
    msg: String((e && e.message) || e).slice(0, 140),
    stack: String((e && e.stack) || '').split('\n').slice(0, 5).join(' | ').slice(0, 400),
  })
);

await p.goto('https://sbf5ebf7vt81f.space.mcode.cn/#/live', { waitUntil: 'domcontentloaded' });
await p.waitForTimeout(13000);
console.log('=== A. 不开抽屉 ===');
console.log(errs.length ? JSON.stringify(errs, null, 1) : '  （无错误）');

await p.evaluate(() => {
  const btn = [...document.querySelectorAll('button')].find((x) =>
    (x.textContent || '').includes('B站直播间')
  );
  if (btn) btn.click();
});
await p.waitForTimeout(6000);
console.log('\n=== B. 开抽屉后新增 ===');
console.log(errs.length ? JSON.stringify(errs, null, 1) : '  （无错误）');

await b.close();
