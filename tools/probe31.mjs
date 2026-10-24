// Probe v31: 为什么 Bilibili 直播在 iframe 里不播？对照 referrerpolicy / 宽度 / 是否顶层
import http from 'node:http';
import { resolvePlaywright } from './resolve-playwright.mjs';
import { decodePng, frameStats } from './pngdiff.mjs';

const ROOM = process.argv[2] || '8016907';
const SRC = `https://live.bilibili.com/blanc/${ROOM}`;

const PAGE = (w, rp) => `<!doctype html><html><head><meta charset="utf-8"><style>
html,body{margin:0;background:#111}
#f{width:${w}px;height:760px;border:0;display:block}
</style></head><body>
<iframe id="f" src="${SRC}" ${rp ? `referrerpolicy="${rp}"` : ''} allowfullscreen></iframe>
</body></html>`;

const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  const cfg = JSON.parse(u.searchParams.get('cfg') || '{}');
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(PAGE(cfg.w || 941, cfg.rp));
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;

const { chromium } = resolvePlaywright().pw;
const browser = await chromium.launch({
  headless: false,
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required', '--mute-audio', '--window-size=1500,900'],
});

for (const cfg of [
  { w: 941, rp: 'no-referrer', tag: '941px + no-referrer' },
  { w: 941, rp: '', tag: '941px + 默认 Referer' },
  { w: 1280, rp: 'no-referrer', tag: '1280px + no-referrer' },
  { w: 1280, rp: '', tag: '1280px + 默认 Referer' },
  { w: 700, rp: '', tag: '700px + 默认 Referer' },
]) {
  const page = await browser.newPage({ viewport: { width: 1500, height: 900 } });
  const m3u8 = [];
  page.on('response', (r) => {
    if (/\.m3u8|\.flv/.test(r.url())) m3u8.push(r.status());
  });
  try {
    await page.goto(`http://127.0.0.1:${port}/?cfg=${encodeURIComponent(JSON.stringify(cfg))}`, {
      waitUntil: 'domcontentloaded',
    });
    await page.waitForTimeout(12000);
    const el = await page.$('#f');
    const s1 = decodePng(await el.screenshot());
    await page.waitForTimeout(3200);
    const s2 = decodePng(await el.screenshot());
    const st = frameStats(s1, s2);
    console.log(
      `  ${cfg.tag.padEnd(24)} 非黑=${(st.nonBlackRatio * 100).toFixed(1)}% 变化=${(
        st.diffRatio * 100
      ).toFixed(2)}% 亮度=${st.meanLuma.toFixed(0)} 流请求=${m3u8.length}`
    );
    await page.screenshot({ path: `data/ui-smoke/iframe-${cfg.w}-${cfg.rp || 'default'}.png` });
  } catch (e) {
    console.log(`  ${cfg.tag} 失败: ${e.message.slice(0, 70)}`);
  }
  await page.close();
}
await browser.close();
server.close();
