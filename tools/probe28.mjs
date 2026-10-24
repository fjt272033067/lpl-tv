// Probe v28: 有头浏览器下 blanc 播放器是否还弹验证码
import { resolvePlaywright } from './resolve-playwright.mjs';
const { chromium } = resolvePlaywright().pw;

const ROOM = process.argv[2] || '1727071300';
const browser = await chromium.launch({
  headless: false,
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required', '--mute-audio', '--window-size=1400,900'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const reqs = [];
page.on('response', (r) => {
  const u = r.url();
  if (/\.m3u8|\.flv|getRoomPlayInfo|getDanmuInfo/.test(u)) reqs.push(r.status() + ' ' + u.slice(0, 100));
});
await page.goto(`https://live.bilibili.com/blanc/${ROOM}`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(14000);
const info = await page.evaluate(() => {
  const v = document.querySelector('video');
  const body = document.body.innerText || '';
  return {
    hasVideo: !!v,
    w: v ? v.videoWidth : 0,
    h: v ? v.videoHeight : 0,
    captcha: /请在下图依次点击|依次点击|验证码/.test(body),
    bodyHead: body.replace(/\s+/g, ' ').slice(0, 150),
  };
});
console.log('有头模式: ' + JSON.stringify(info));
console.log('网络: ' + (reqs.slice(0, 6).join('\n      ') || '(无流请求)'));
await page.screenshot({ path: 'data/ui-smoke/blanc-headed.png' });
await browser.close();
