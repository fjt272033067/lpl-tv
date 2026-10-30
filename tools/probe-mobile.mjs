/* =====================================================================
 * probe-mobile.mjs — 手机视口实拍三个页面，检查布局是否真的不挤
 * 用法： node tools/probe-mobile.mjs [baseUrl]
 *   不传参数 → 自动起一个临时静态服务器（用完即关），探测本地构建产物
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

// 临时服务器随脚本起、随脚本关 —— 不用后台常驻任务（常驻任务只会等到超时被回收，
// 然后变成一条与用户无关的「任务失败」通知）
let server = null;
let BASE = process.argv[2];
if (!BASE) {
  server = await startStaticServer(path.join(ROOT, 'site'));
  BASE = server.url;
}
console.log('探测目标: ' + BASE);

const { pw } = resolvePlaywright();
const browser = await pw.chromium.launch({
  executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  headless: process.env.HEADED !== '1',
  args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'],
});
const ctx = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
  userAgent:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
});
const page = await ctx.newPage();

for (const [name, hash, wait] of [
  ['m-live', '#/live', 9000],
  ['m-vod', '#/vod', 4500],
  ['m-sched', '#/schedule', 5000],
]) {
  await page.goto(BASE + '/' + hash, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(wait);
  const m = await page.evaluate(() => {
    const q = (s) => document.querySelector(s);
    const overflow = document.documentElement.scrollWidth - document.documentElement.clientWidth;
    const wide = [];
    document.querySelectorAll('body *').forEach((e) => {
      const r = e.getBoundingClientRect();
      if (r.width > 400 && r.height > 0) {
        wide.push((e.className || e.tagName || '').toString().slice(0, 40) + ' w=' + Math.round(r.width));
      }
    });
    const btn = q('.ctrl-btn');
    const card = q('.card');
    const banner = q('.event-banner');
    const qbar = q('.quality-bar');
    return {
      overflow,
      wide: wide.slice(0, 8),
      btn: btn ? Math.round(btn.getBoundingClientRect().height) : 0,
      cardW: card ? Math.round(card.getBoundingClientRect().width) : 0,
      bannerH: banner ? Math.round(banner.getBoundingClientRect().height) : 0,
      bannerW: banner ? Math.round(banner.getBoundingClientRect().width) : 0,
      qbarH: qbar ? Math.round(qbar.getBoundingClientRect().height) : 0,
      player: (() => {
        const v = q('.player');
        if (!v) return null;
        const r = v.getBoundingClientRect();
        return { w: Math.round(r.width), h: Math.round(r.height), vw: q('video') ? q('video').videoWidth : 0 };
      })(),
      toTop: !!q('.to-top'),
    };
  });
  console.log('\n=== ' + name + ' ===');
  console.log('  ' + JSON.stringify(m));
  await page.screenshot({ path: path.join(OUT, name + '.png') });
  await page.screenshot({ path: path.join(OUT, name + '-full.png'), fullPage: true });
}
await browser.close();
if (server) await server.close();
console.log('\n截图目录: ' + OUT);
