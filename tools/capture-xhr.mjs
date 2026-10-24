/* =====================================================================
 * capture-xhr.mjs — 捕获页面全部 XHR/fetch（URL + 响应体片段）
 * 用法： node tools/capture-xhr.mjs <url> [输出前缀]
 * ===================================================================== */
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolvePlaywright } from './resolve-playwright.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'data', 'ui-probe');
fs.mkdirSync(OUT, { recursive: true });

const URL_ = process.argv[2];
const TAG = process.argv[3] || 'xhr';

const { pw } = resolvePlaywright();
const browser = await pw.chromium.launch({
  executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  headless: false,
  args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required', '--mute-audio'],
});
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();

const seen = [];
page.on('response', async (r) => {
  const u = r.url();
  const rt = r.request().resourceType();
  if (rt !== 'xhr' && rt !== 'fetch') return;
  if (/analytics|log|track|report|collect|pv\.|beacon/i.test(u)) return;
  let body = '';
  try { body = (await r.text()).slice(0, 2200); } catch (e) { return; }
  if (!body) return;
  seen.push({ u: u.slice(0, 200), st: r.status(), b: body });
});

console.log('打开', URL_);
await page.goto(URL_, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForTimeout(14000);

console.log('\n=== XHR ' + seen.length + ' 条 ===');
for (const h of seen) {
  console.log('\n--- ' + h.st + ' ' + h.u);
  console.log('    ' + h.b.replace(/\s+/g, ' ').slice(0, 700));
}
fs.writeFileSync(path.join(OUT, TAG + '-xhr.json'), JSON.stringify(seen, null, 1));
await page.screenshot({ path: path.join(OUT, TAG + '.png') });
await browser.close();
