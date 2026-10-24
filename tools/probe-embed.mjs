/* =====================================================================
 * probe-embed.mjs — 测试各平台的「可内嵌播放器」地址
 * 判据：iframe 内是否发起流请求 + 是否出现有尺寸的 <video>
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
  { tag: 'douyu-embed', url: 'https://www.douyu.com/embed/288016' },
  { tag: 'douyu-player', url: 'https://player.douyu.com/?rid=288016' },
  { tag: 'huya-embed2', url: 'https://www.huya.com/embed?rid=660000' },
  { tag: 'huya-embed3', url: 'https://www.huya.com/embed/660000.html' },
  { tag: 'bili-blackboard', url: 'https://live.bilibili.com/blackboard/activity-2ljWmXgL3m.html' },
  { tag: 'bili-room6', url: 'https://live.bilibili.com/6' },
];

const { pw } = resolvePlaywright();
const browser = await pw.chromium.launch({
  executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  headless: false,
  args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required', '--mute-audio'],
});

for (const t of TARGETS) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 760 } });
  const page = await ctx.newPage();
  const net = [];
  page.on('request', (r) => {
    const u = r.url();
    if (/\.m3u8|\.flv|live-bvc|\/live\/|\.ts\b/i.test(u) && !/jpg|png|webp|css/i.test(u)) {
      net.push(r.resourceType() + ' ' + u.slice(0, 110));
    }
  });
  await page.setContent(
    `<!doctype html><html><body style="margin:0;background:#111">
     <iframe id="f" src="${t.url}" style="width:1200px;height:700px;border:0" allow="autoplay; fullscreen" referrerpolicy="no-referrer"></iframe>
     </body></html>`,
    { waitUntil: 'domcontentloaded' }
  );
  await page.waitForTimeout(15000);
  const stat = await page.evaluate(() => {
    const f = document.getElementById('f');
    try {
      const d = f.contentDocument;
      if (!d) return { vids: -1, sized: -1 };
      const vs = [...d.querySelectorAll('video')];
      return { vids: vs.length, sized: vs.filter((v) => v.videoWidth > 0).length, title: (d.title || '').slice(0, 40) };
    } catch (e) {
      return { vids: -1, sized: -1, xorigin: true };
    }
  });
  console.log(`\n=== ${t.tag} ===`);
  console.log(`  video=${stat.vids} 有尺寸=${stat.sized} ${stat.title ? 'title=' + stat.title : ''}${stat.xorigin ? ' (跨域不可读)' : ''}`);
  console.log(`  流请求=${net.length}`);
  net.slice(0, 4).forEach((n) => console.log('    ' + n));
  await page.screenshot({ path: path.join(OUT, 'embed-' + t.tag + '.png') });
  await ctx.close();
}
await browser.close();
