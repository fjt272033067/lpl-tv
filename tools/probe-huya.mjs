/* =====================================================================
 * probe-huya.mjs — 在虎牙房间页上下文里探测流地址接口
 * 浏览器上下文天然带 cookie，能命中真实请求格式。
 * ===================================================================== */
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolvePlaywright } from './resolve-playwright.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'data', 'ui-probe');
fs.mkdirSync(OUT, { recursive: true });

const { pw } = resolvePlaywright();
const browser = await pw.chromium.launch({
  executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  headless: false,
  args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required', '--mute-audio'],
});
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();

const CANDIDATES = [
  'https://liveapi.huya.com/mg/live/roomInfo?roomId=2610191502',
  'https://liveapi.huya.com/mg/live/roomInfo?roomId=2610191502&sDeviceId=0&sAppId=0',
  'https://liveapi.huya.com/cache/room/getRoomInfo?roomId=2610191502&_=1',
  'https://liveapi.huya.com/cache/room/getRoomInfo?roomId=2610191502&sStreamName=&iStreamType=0',
  'https://liveapi.huya.com/cache/room/getRoomStreamInfo?roomId=2610191502',
  'https://liveapi.huya.com/cache/room/roomMonitor?pid=2610191502&from=live',
  'https://liveapi.huya.com/mg/live/getStreamUrl?roomId=2610191502',
  'https://liveapi.huya.com/mg/live/getPlayInfo?roomId=2610191502',
  'https://m.huya.com/ajax/room/getRoomInfo?roomId=2610191502',
  'https://www.huya.com/api/room/getRoomInfo?roomId=2610191502',
  'https://api.huya.com/?roomId=2610191502',
  'https://cdnws.api.huya.com/?json_func=getRoomInfo&roomId=2610191502',
];

await page.goto('https://www.huya.com/2610191502', { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForTimeout(9000);

const out = await page.evaluate(async (list) => {
  const res = [];
  for (const u of list) {
    try {
      const r = await fetch(u, { credentials: 'omit' });
      const t = await r.text();
      res.push({ u, status: r.status, ct: r.headers.get('content-type'), body: t.slice(0, 900) });
    } catch (e) {
      res.push({ u, err: String(e).slice(0, 160) });
    }
  }
  return res;
}, CANDIDATES);

for (const o of out) {
  console.log('\n--- ' + (o.status || 'ERR') + '  ' + o.u);
  console.log('    ct=' + (o.ct || '-'));
  console.log('    ' + (o.body || o.err || '').replace(/\s+/g, ' ').slice(0, 700));
}

// 页面里是否已有流地址（播放器对象）
const inPage = await page.evaluate(() => {
  const found = [];
  const walk = (obj, path, depth) => {
    if (depth > 4 || !obj || typeof obj !== 'object') return;
    for (const k of Object.keys(obj)) {
      let v;
      try { v = obj[k]; } catch (e) { continue; }
      if (typeof v === 'string' && /sStreamName|sFlvUrl|\.flv\?|\.m3u8/.test(v)) {
        found.push(path + '.' + k + ' = ' + String(v).slice(0, 300));
      } else if (v && typeof v === 'object' && depth < 4) {
        walk(v, path + '.' + k, depth + 1);
      }
    }
  };
  for (const key of Object.keys(window)) {
    if (/player|stream|room|huya/i.test(key)) {
      try { walk(window[key], key, 0); } catch (e) {}
    }
  }
  return found.slice(0, 40);
});
console.log('\n=== 页面内流地址线索 ===');
inPage.forEach((f) => console.log('  ' + f));

await browser.close();
