/* 赛程页视觉与交互探针：把含 B站录播标记的行截图出来 */
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolvePlaywright } from './resolve-playwright.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'data', 'ui-probe');
fs.mkdirSync(OUT, { recursive: true });
const BASE = process.argv[2] || 'http://127.0.0.1:8099';

const { pw } = resolvePlaywright();
const browser = await pw.chromium.launch({
  executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  headless: false,
  args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
await page.goto(BASE + '#/schedule', { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForTimeout(5000);

const info = await page.evaluate(() => {
  const rows = [...document.querySelectorAll('.bracket-row')];
  const withBili = rows.filter((r) => r.classList.contains('bili-only'));
  const withTx = rows.filter((r) => r.classList.contains('has-vod') && !r.classList.contains('bili-only'));
  const noVod = rows.filter((r) => r.classList.contains('no-vod'));
  const brief = (r) => ({
    text: (r.textContent || '').replace(/\s+/g, ' ').trim(),
    title: r.title,
    badge: (r.querySelector('.bplay') || {}).textContent || '',
  });
  return {
    total: rows.length,
    tx: withTx.length,
    bili: withBili.length,
    none: noVod.length,
    biliSamples: withBili.slice(0, 8).map(brief),
    txSamples: withTx.slice(0, 3).map(brief),
  };
});
console.log(JSON.stringify(info, null, 1));

// 滚到第一个 B 站行并截图
const shot = await page.evaluate(() => {
  const r = document.querySelector('.bracket-row.bili-only');
  if (!r) return null;
  r.scrollIntoView({ block: 'center' });
  const box = r.getBoundingClientRect();
  return { text: (r.textContent || '').replace(/\s+/g, ' ').trim(), title: r.title, y: box.top };
});
console.log('B站行: ' + JSON.stringify(shot));
if (shot) {
  await page.waitForTimeout(600);
  await page.screenshot({ path: path.join(OUT, 'schedule-bili-row.png') });
}

await page.screenshot({ path: path.join(OUT, 'schedule-full.png'), fullPage: false });
await browser.close();
console.log('截图目录: ' + OUT);
