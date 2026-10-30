/* =====================================================================
 * capture-streams.mjs — 抓取各直播平台真实的流地址接口
 * 打开平台房间页，捕获 XHR/fetch 响应，筛出含流地址字段的请求。
 * 用法： node tools/capture-streams.mjs <url> [关键词]
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
const KW = (process.argv[3] || '').toLowerCase();
const TAG = process.argv[4] || 'probe';

const { pw } = resolvePlaywright();
const browser = await pw.chromium.launch({
  executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  headless: process.env.HEADED !== '1',
  args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required', '--mute-audio'],
});
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();

const hits = [];
page.on('response', async (r) => {
  const u = r.url();
  const ct = (r.headers()['content-type'] || '').toLowerCase();
  if (!/json|text\/html|javascript/.test(ct)) return;
  if (KW && !u.toLowerCase().includes(KW)) return;
  let body = '';
  try { body = (await r.text()).slice(0, 4000); } catch (e) { return; }
  if (!/(m3u8|\.flv|rtmp|streamName|stream_url|streamUrl|flvUrl|hlsUrl|sFlvUrl|playUrl)/i.test(body)) return;
  hits.push({ url: u.slice(0, 220), status: r.status(), body: body.slice(0, 1400) });
});

console.log('打开', URL_);
await page.goto(URL_, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForTimeout(12000);

console.log('\n=== 命中 ' + hits.length + ' 条 ===');
const seen = new Set();
for (const h of hits) {
  const key = h.url.split('?')[0];
  if (seen.has(key)) continue;
  seen.add(key);
  console.log('\n--- ' + h.status + ' ' + h.url);
  console.log(h.body.replace(/\s+/g, ' ').slice(0, 900));
}

await page.screenshot({ path: path.join(OUT, TAG + '.png') });
await browser.close();
