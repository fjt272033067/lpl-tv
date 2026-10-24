// Probe v24: (A) 任何支持 JSONP 的 B 站直播接口  (B) 抽屉内 B 站弹幕是否真的在滚动
import { execFileSync } from 'node:child_process';
import zlib from 'node:zlib';
import { resolvePlaywright } from './resolve-playwright.mjs';

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
const ROOM = 7734200;

function curlBuf(url, headers = []) {
  const args = ['-s', '--max-time', '25', '-A', UA];
  headers.forEach((h) => args.push('-H', h));
  args.push(url);
  try {
    return execFileSync('curl.exe', args, { encoding: 'buffer', maxBuffer: 64 * 1024 * 1024, windowsHide: true });
  } catch (e) {
    return Buffer.alloc(0);
  }
}
function decode(buf) {
  if (!buf || !buf.length) return '';
  if (buf[0] === 0x1f && buf[1] === 0x8b) { try { return zlib.gunzipSync(buf).toString('utf8'); } catch {} }
  if (buf[0] === 0x78) { try { return zlib.inflateSync(buf).toString('utf8'); } catch {} }
  try { return zlib.brotliDecompressSync(buf).toString('utf8'); } catch {}
  try { return zlib.inflateRawSync(buf).toString('utf8'); } catch {}
  return buf.toString('utf8');
}

console.log('=== A. 哪些 B 站直播接口支持 JSONP（返回 callback(...)） ===');
const eps = [
  `https://api.live.bilibili.com/xlive/web-room/v1/dM/gethistory?room_id=${ROOM}`,
  `https://api.live.bilibili.com/xlive/web-room/v1/dM/gethistory?room_id=${ROOM}&type=0`,
  `https://api.live.bilibili.com/xlive/web-room/v1/index/getRoomBaseInfo?room_ids=${ROOM}`,
  `https://api.live.bilibili.com/room/v1/Room/get_info?room_id=${ROOM}`,
  `https://api.live.bilibili.com/xlive/web-room/v1/index/getDanmuInfo?id=${ROOM}&type=0`,
  `https://api.live.bilibili.com/xlive/web-interface/v1/second/getList?platform=web&parent_area_id=1&area_id=3&sort_type=online&page=1&page_size=5`,
];
for (const u of eps) {
  const raw = decode(curlBuf(u + '&callback=cbfn', [`Referer: https://live.bilibili.com/`]));
  const wrapped = /^\s*cbfn\s*\(/.test(raw || '');
  console.log(`  ${wrapped ? '✓JSONP' : '·raw  '} ${u.replace('https://api.live.bilibili.com', '').slice(0, 78)}`);
  if (wrapped) console.log(`        -> ${raw.slice(0, 220)}`);
}

console.log('\n=== B. 抽屉里的 B 站弹幕是否真的在滚动 ===');
const { chromium } = resolvePlaywright().pw;
const browser = await chromium.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required', '--mute-audio'],
});
const page = await browser.newPage({ viewport: { width: 1500, height: 900 } });
await page.goto('https://sbf5ebf7vt81f.space.mcode.cn/#/live', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(11000);
await page.evaluate(() => {
  const btn = [...document.querySelectorAll('button')].find((x) =>
    (x.textContent || '').includes('B站直播间')
  );
  if (btn) btn.click();
});
await page.waitForTimeout(14000);
const drawer = await page.$('#bili-drawer');
if (drawer) {
  await drawer.screenshot({ path: 'data/ui-smoke/09-bili-drawer-danmaku.png' });
  console.log('  已截图 data/ui-smoke/09-bili-drawer-danmaku.png');
}
// 连续两帧像素差异，验证弹幕在动
const frames = await page.evaluate(async () => {
  const d = document.querySelector('#bili-drawer');
  if (!d) return null;
  const r = d.getBoundingClientRect();
  const grab = () => {
    const c = document.createElement('canvas');
    c.width = 240; c.height = 135;
    const ctx = c.getContext('2d');
    try {
      ctx.drawImage(document.querySelector('#bili-drawer iframe'), 0, 0, 240, 135);
      return ctx.getImageData(0, 0, 240, 135).data.join(',');
    } catch (e) {
      return 'X';
    }
  };
  const a = grab();
  await new Promise((r) => setTimeout(r, 2500));
  const b = grab();
  return { same: a === b, len: a.length, sample: a.slice(0, 30) };
});
console.log('  跨域抓帧: ' + JSON.stringify(frames) + '（X 表示被同源策略挡住，属预期）');
await browser.close();
