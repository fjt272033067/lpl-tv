/* =====================================================================
 * probe-live.mjs — 直播页真实行为探针
 *  用本机 Chrome + Playwright 打开线上/本地直播页，实测：
 *   - 视频是否真的有画面（videoWidth / 非黑像素）
 *   - 线路菜单里都有什么
 *   - 无信号看门狗是否触发
 *   - console 错误
 * 用法： node tools/probe-live.mjs [baseUrl]
 *   不传参数 → 探测线上站点；传 http://127.0.0.1:xxxx → 探测本地
 * ===================================================================== */
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolvePlaywright } from './resolve-playwright.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const BASE = process.argv[2] || 'https://4kf9kfxujfhg2.space.mcode.cn';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const OUT = path.join(ROOT, 'data', 'ui-probe');
fs.mkdirSync(OUT, { recursive: true });

const { pw } = resolvePlaywright();
const browser = await pw.chromium.launch({
  executablePath: fs.existsSync(CHROME) ? CHROME : undefined,
  headless: false,
  args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'],
});
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();

const errors = [];
const requests = [];
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text());
});
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('requestfailed', (r) => {
  const u = r.url();
  if (u.includes('m3u8') || u.includes('myqcloud') || u.includes('bilibili'))
    requests.push('FAIL ' + u.slice(0, 140) + ' :: ' + (r.failure() || {}).errorText);
});
page.on('response', (r) => {
  const u = r.url();
  if (u.includes('m3u8') || u.includes('myqcloud')) requests.push(r.status() + ' ' + u.slice(0, 140));
});

console.log('打开', BASE + '#/live');
await page.goto(BASE + '#/live', { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForTimeout(4000);

// 线路菜单
const menu = await page.evaluate(() => {
  const btns = Array.from(document.querySelectorAll('[data-menu]'));
  const b = btns.find((x) => /线路/.test(x.textContent || ''));
  if (!b) return { found: false, all: btns.map((x) => x.getAttribute('data-menu')) };
  b.click();
  const panel = document.querySelector('.menu-panel.open, .menu-list.open, [data-menu-panel].open');
  return {
    found: true,
    label: (b.textContent || '').trim(),
    items: panel ? Array.from(panel.querySelectorAll('li,button,a')).map((x) => (x.textContent || '').trim()).filter(Boolean) : [],
  };
});
console.log('线路菜单:', JSON.stringify(menu, null, 1));

await page.waitForTimeout(1500);
await page.screenshot({ path: path.join(OUT, 'live-1.png'), fullPage: false });

// 视频状态
const vstat = await page.evaluate(() => {
  const v = document.querySelector('video');
  if (!v) return { hasVideo: false };
  return {
    hasVideo: true,
    src: (v.currentSrc || v.src || '').slice(0, 160),
    readyState: v.readyState,
    networkState: v.networkState,
    videoWidth: v.videoWidth,
    videoHeight: v.videoHeight,
    currentTime: +v.currentTime.toFixed(2),
    paused: v.paused,
    error: v.error ? { code: v.error.code, msg: v.error.message } : null,
    buffered: v.buffered && v.buffered.length ? +v.buffered.end(0).toFixed(2) : 0,
  };
});
console.log('视频状态:', JSON.stringify(vstat, null, 1));

// 画面像素：抽一帧到 canvas 统计非黑占比
const px = await page.evaluate(async () => {
  const v = document.querySelector('video');
  if (!v || !v.videoWidth) return { skipped: 'no video frame' };
  const c = document.createElement('canvas');
  c.width = 160;
  c.height = 90;
  const g = c.getContext('2d');
  g.drawImage(v, 0, 0, 160, 90);
  const d = g.getImageData(0, 0, 160, 90).data;
  let nonBlack = 0;
  let sum = 0;
  for (let i = 0; i < d.length; i += 4) {
    const l = (d[i] + d[i + 1] + d[i + 2]) / 3;
    sum += l;
    if (l > 12) nonBlack++;
  }
  return { nonBlackRatio: +(nonBlack / (d.length / 4)).toFixed(3), avgLuma: +(sum / (d.length / 4)).toFixed(1) };
});
console.log('画面像素:', JSON.stringify(px));

// 页面上的提示文本
const hints = await page.evaluate(() => {
  const t = [];
  document.querySelectorAll('.player-msg,.msg,.notice,.no-signal,.player-hint,.p-msg').forEach((e) => {
    if (e.offsetParent !== null) t.push((e.textContent || '').trim().slice(0, 160));
  });
  return [...new Set(t)];
});
console.log('页面提示:', JSON.stringify(hints, null, 1));

// 直播列表
const rows = await page.evaluate(() => {
  const s = document.querySelector('.live-list, .live-strip, .live-grid');
  if (!s) return { found: false, bodySnippet: (document.querySelector('#view') || document.body).innerText.slice(0, 400) };
  return { found: true, text: s.innerText.slice(0, 500) };
});
console.log('直播列表:', JSON.stringify(rows, null, 1));

await page.waitForTimeout(3000);
await page.screenshot({ path: path.join(OUT, 'live-2.png'), fullPage: false });

console.log('console 错误:', JSON.stringify(errors.slice(0, 12), null, 1));
console.log('直播相关请求:', JSON.stringify(requests.slice(0, 20), null, 1));

await browser.close();
console.log('截图目录:', OUT);
