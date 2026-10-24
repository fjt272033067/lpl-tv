// Probe v29: 真实（ headed）浏览器里，B 站接口的 JSONP 能否被执行（ORB 是否放行）
import { resolvePlaywright } from './resolve-playwright.mjs';
const { chromium } = resolvePlaywright().pw;

const browser = await chromium.launch({
  headless: false,
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required', '--mute-audio', '--window-size=1400,900'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
page.on('response', (r) => {
  const u = r.url();
  if (/getDanmuInfo|getRoomPlayInfo|getRoomBaseInfo/.test(u))
    console.log(`  [resp] ${r.status()} ct=${r.headers()['content-type']} ${u.slice(0, 78)}`);
});
page.on('requestfailed', (r) => {
  const u = r.url();
  if (/getDanmuInfo|getRoomPlayInfo|getRoomBaseInfo/.test(u))
    console.log(`  [reqfail] ${u.slice(0, 78)} :: ${(r.failure() || {}).errorText}`);
});
page.on('pageerror', (e) => console.log('  [pageerror] ' + String(e.message || e).slice(0, 140)));

await page.goto('https://sbf5ebf7vt81f.space.mcode.cn/', { waitUntil: 'domcontentloaded' });

async function tryJsonp(label, url) {
  const res = await page.evaluate(
    (u) =>
      new Promise((resolve) => {
        const cb = '__t_' + Date.now().toString(36);
        window[cb] = (d) => resolve({ ok: true, keys: Object.keys(d || {}), head: JSON.stringify(d).slice(0, 160) });
        const s = document.createElement('script');
        s.async = true;
        s.onerror = () => resolve({ ok: false, err: 'script error' });
        s.src = u.replace('CALLBACK', cb);
        document.head.appendChild(s);
        setTimeout(() => resolve({ ok: false, err: 'timeout(未回调)' }), 12000);
      }),
    url
  );
  console.log(`  ${label}: ${JSON.stringify(res)}`);
  return res;
}

console.log('=== A. getDanmuInfo 的 JSONP（callback + jsonp=jsonp）===');
await tryJsonp(
  'getDanmuInfo',
  'https://api.live.bilibili.com/xlive/web-room/v1/index/getDanmuInfo?id=1727071300&type=0&callback=CALLBACK&jsonp=jsonp'
);

console.log('\n=== B. getRoomPlayInfo 的 JSONP（对照：该接口已知能返回 200）===');
await tryJsonp(
  'getRoomPlayInfo',
  'https://api.live.bilibili.com/xlive/web-room/v2/index/getRoomPlayInfo?room_id=1727071300&callback=CALLBACK&jsonp=jsonp'
);

console.log('\n=== C. 直接 fetch（看 CORS 头）===');
const f = await page.evaluate(async () => {
  try {
    const r = await fetch('https://api.live.bilibili.com/xlive/web-room/v1/index/getDanmuInfo?id=1727071300&type=0');
    const t = await r.text();
    return { ok: true, status: r.status, acao: r.headers.get('access-control-allow-origin'), head: t.slice(0, 160) };
  } catch (e) {
    return { ok: false, err: String(e.message || e) };
  }
});
console.log('  fetch: ' + JSON.stringify(f));

await browser.close();
