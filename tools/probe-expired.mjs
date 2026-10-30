/* =====================================================================
 * probe-expired.mjs — 验证「流地址过期后自动切源」而不是留黑屏
 * 做法：临时把 liverooms.json 里所有 stream.expires 改成过去时间，
 *      用页面内 fetch 拦截改写响应，观察页面是否自动切到腾讯源。
 * ===================================================================== */
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolvePlaywright } from './resolve-playwright.mjs';
import { startStaticServer } from './static-server.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'data', 'ui-probe');
fs.mkdirSync(OUT, { recursive: true });

// 临时服务器随脚本起、随脚本关（不用后台常驻任务）
let server = null;
let BASE = process.argv[2];
if (!BASE) {
  server = await startStaticServer(path.join(ROOT, 'site'));
  BASE = server.url;
}

const { pw } = resolvePlaywright();
const browser = await pw.chromium.launch({
  executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  headless: process.env.HEADED !== '1',
  args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'],
});
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();

// 把 liverooms.json 响应里的 expires 改成 1 小时前（模拟签名过期）
await page.route('**/data/liverooms.json', async (route) => {
  const res = await route.fetch();
  const j = await res.json();
  (j.rooms || []).forEach((r) => {
    if (r.stream) r.stream.expires = Math.floor(Date.now() / 1000) - 3600;
  });
  await route.fulfill({ response: res, body: JSON.stringify(j), headers: { 'content-type': 'application/json' } });
});

await page.goto(BASE + '/#/live', { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForTimeout(12000);

const st = await page.evaluate(() => {
  const v = document.querySelector('.player video');
  const msg = document.querySelector('.player-msg');
  const items = [...document.querySelectorAll('.live-strip .strip-item')].map((e) => e.textContent.trim());
  const label = (document.querySelector('.live-strip .strip-label') || {}).textContent || '';
  const srcMenu = document.querySelectorAll('.menu[data-menu="source"] .menu-item').length;
  return {
    videoW: v ? v.videoWidth : 0,
    videoH: v ? v.videoHeight : 0,
    playing: v ? !v.paused : false,
    msg: msg && getComputedStyle(msg).display !== 'none' ? msg.textContent.trim().slice(0, 90) : '',
    stripLabel: label.trim(),
    stripItems: items,
    srcMenu,
    tags: [...document.querySelectorAll('.player-top .badge')].map((b) => b.textContent.trim()),
  };
});
console.log(JSON.stringify(st, null, 1));
await page.screenshot({ path: path.join(OUT, 'expired-live.png') });
await browser.close();
if (server) await server.close();
