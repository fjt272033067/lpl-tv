/* 一次性探针：量一下浏览器里访问 raw.githubusercontent.com 的真实耗时 */
import { resolvePlaywright } from './resolve-playwright.mjs';

const { chromium } = resolvePlaywright().pw;
const browser = await chromium.launch({
  headless: true,
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  args: ['--no-sandbox'],
});
const page = await browser.newPage();
page.on('console', (m) => {
  if (m.type() === 'error') console.log('  [console error]', m.text().slice(0, 140));
});
await page.goto('https://4kf9kfxujfhg2.space.mcode.cn/?t=' + Date.now(), { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(6000);
const r = await page.evaluate(async () => {
  const out = { resources: [], timing: null };
  performance.getEntriesByType('resource').forEach((e) => {
    if (/raw\.githubusercontent|version\.json|schedule\.json/.test(e.name)) {
      out.resources.push({ name: e.name.slice(0, 90), dur: Math.round(e.duration), start: Math.round(e.startTime) });
    }
  });
  const t0 = performance.now();
  try {
    const res = await fetch('https://raw.githubusercontent.com/fjt272033067/lpl-tv/main/site/data/version.json');
    out.timing = { status: res.status, ms: Math.round(performance.now() - t0) };
  } catch (e) {
    out.timing = { error: String(e && e.message), ms: Math.round(performance.now() - t0) };
  }
  return out;
});
console.log(JSON.stringify(r, null, 1));
await browser.close();
