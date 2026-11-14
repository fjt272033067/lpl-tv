/**
 * probe-live-source.mjs — 看主站当前主线路选的是谁、各线路的可播/过期状态
 * 用法：node tools/probe-live-source.mjs [线上URL]
 */
import { resolvePlaywright } from '../resolve-playwright.mjs';

const { chromium } = resolvePlaywright().pw;
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const URL = process.argv[2] || 'https://4kf9kfxujfhg2.space.mcode.cn';

const browser = await chromium.launch({ headless: true, executablePath: CHROME, args: ['--no-sandbox', '--mute-audio'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto(URL + '/#/live', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(14000);

const info = await page.evaluate(async () => {
  const r = await fetch('data/liverooms.json', { cache: 'no-store' }).then((x) => x.json());
  const now = Math.floor(Date.now() / 1000);
  const rooms = (r.rooms || [])
    .filter((x) => x.stream)
    .map((x) => ({
      roomid: x.roomid,
      title: String(x.title || '').slice(0, 26),
      leftMin: x.stream.expires ? Math.round((x.stream.expires - now) / 60) : null,
      qn: x.stream.qn,
    }))
    .sort((a, b) => (b.leftMin ?? -1) - (a.leftMin ?? -1));
  // 打开线路菜单，读出每条线路的文案
  const btn = document.querySelector('[data-ctl="source"]');
  if (btn) btn.click();
  await new Promise((res) => setTimeout(res, 400));
  const items = [...document.querySelectorAll('.menu[data-menu="source"] .menu-item')].map((i) => i.textContent.trim());
  const v = document.querySelector('.player video');
  return {
    liveroomsUpdatedAt: r.updatedAt,
    rooms,
    menuItems: items,
    mainSrc: (document.querySelector('.player-top') || {}).textContent || '',
    videoW: v ? v.videoWidth : 0,
    stripLabel: (document.querySelector('.live-strip .strip-label') || {}).textContent || '',
  };
});
console.log(JSON.stringify(info, null, 1));
await browser.close();
