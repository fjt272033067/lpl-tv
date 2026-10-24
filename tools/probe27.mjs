// Probe v27: blanc 播放器在不同宽度下能否出画
import { resolvePlaywright } from './resolve-playwright.mjs';
const { chromium } = resolvePlaywright().pw;

const ROOM = process.argv[2] || '1727071300';
const browser = await chromium.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required', '--mute-audio'],
});

for (const [w, h] of [[1280, 720], [640, 900], [420, 900]]) {
  const page = await browser.newPage({ viewport: { width: w, height: h } });
  const reqs = [];
  page.on('response', (r) => {
    const u = r.url();
    if (/\.m3u8|\.flv|playurl|getDanmuInfo|xlive-web-room|room-play/.test(u))
      reqs.push(r.status() + ' ' + u.slice(0, 96));
  });
  await page.goto(`https://live.bilibili.com/blanc/${ROOM}`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(11000);
  const info = await page.evaluate(() => {
    const v = document.querySelector('video');
    return {
      hasVideo: !!v,
      w: v ? v.videoWidth : 0,
      h: v ? v.videoHeight : 0,
      paused: v ? v.paused : null,
      txt: (document.body.innerText || '').replace(/\s+/g, ' ').slice(0, 120),
    };
  });
  console.log(`--- 视口 ${w}x${h} ---`);
  console.log('   ' + JSON.stringify(info));
  console.log('   网络: ' + (reqs.slice(0, 4).join(' | ') || '(无流请求)'));
  await page.screenshot({ path: `data/ui-smoke/blanc-${w}.png` });
  await page.close();
}
await browser.close();
