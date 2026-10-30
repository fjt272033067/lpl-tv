/* =====================================================================
 * probe-iframe.mjs — 测试各平台官方播放器 iframe 在第三方页面里能否拉流
 * 判据：iframe 内部是否发起流请求（m3u8/flv/ts），以及是否出现 <video> 有尺寸。
 * 用法： node tools/probe-iframe.mjs
 * ===================================================================== */
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolvePlaywright } from './resolve-playwright.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'data', 'ui-probe');
fs.mkdirSync(OUT, { recursive: true });

const TARGETS = [
  { tag: 'douyu-288016', url: 'https://www.douyu.com/288016' },
  { tag: 'huya-660000', url: 'https://www.huya.com/660000' },
  { tag: 'huya-embed-660000', url: 'https://www.huya.com/embed/660000' },
  { tag: 'bili-7734200', url: 'https://live.bilibili.com/7734200' },
];

const { pw } = resolvePlaywright();
const browser = await pw.chromium.launch({
  executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  headless: process.env.HEADED !== '1',
  args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required', '--mute-audio'],
});

for (const t of TARGETS) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  const net = [];
  page.on('request', (r) => {
    const u = r.url();
    if (/\.m3u8|\.flv|\.ts\b|live-bvc|\/live\//i.test(u) && !/jpg|png|webp/i.test(u)) {
      net.push(r.resourceType() + ' ' + u.slice(0, 130));
    }
  });
  // 一个模拟第三方页面
  await page.setContent(
    `<!doctype html><html><body style="margin:0;background:#000">
     <iframe id="f" src="${t.url}" style="width:1200px;height:700px;border:0" allow="autoplay; fullscreen" referrerpolicy="no-referrer"></iframe>
     </body></html>`,
    { waitUntil: 'domcontentloaded' }
  );
  await page.waitForTimeout(16000);
  const stat = await page.evaluate(() => {
    const f = document.getElementById('f');
    let vids = 0;
    let sized = 0;
    try {
      const d = f.contentDocument;
      if (d) {
        vids = d.querySelectorAll('video').length;
        d.querySelectorAll('video').forEach((v) => { if (v.videoWidth > 0) sized++; });
      }
    } catch (e) {
      return { crossOrigin: true, vids: -1, sized: -1 };
    }
    return { crossOrigin: false, vids, sized };
  });
  console.log('\n=== ' + t.tag + ' ===');
  console.log('  iframe 内 video 元素=' + stat.vids + ' 有尺寸的=' + stat.sized + (stat.crossOrigin ? ' (跨域不可读)' : ''));
  console.log('  流请求数=' + net.length);
  net.slice(0, 6).forEach((n) => console.log('    ' + n));
  await page.screenshot({ path: path.join(OUT, 'iframe-' + t.tag + '.png') });
  await ctx.close();
}

await browser.close();
