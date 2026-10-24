// Probe v33: 完整直播间页在第三方 iframe 里能否播放？（blanc 不行，试完整页）
import http from 'node:http';
import { resolvePlaywright } from './resolve-playwright.mjs';
import { decodePng, frameStats } from './pngdiff.mjs';

const ROOM = process.argv[2] || '8016907';
const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  const src = u.searchParams.get('src');
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(
    `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;background:#111}#f{width:940px;height:820px;border:0;display:block}</style></head><body><iframe id="f" src="${src}" allowfullscreen></iframe></body></html>`
  );
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;

const { chromium } = resolvePlaywright().pw;
const browser = await chromium.launch({
  headless: false,
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required', '--mute-audio', '--window-size=1500,900'],
});

for (const [tag, src] of [
  ['完整页 live/<room>', `https://live.bilibili.com/${ROOM}`],
  ['blanc/<room>', `https://live.bilibili.com/blanc/${ROOM}`],
  ['完整页 + ?spm', `https://live.bilibili.com/${ROOM}?spm_id_from=333.999.0.0`],
]) {
  const page = await browser.newPage({ viewport: { width: 1500, height: 900 } });
  const m3u8 = [];
  page.on('response', (r) => {
    if (/\.m3u8|\.flv/.test(r.url())) m3u8.push(r.status());
  });
  const dm = [];
  page.on('websocket', (ws) => {
    if (/broadcastlv|danmu|broadcast/.test(ws.url())) dm.push(ws.url().slice(0, 60));
  });
  try {
    await page.goto(`http://127.0.0.1:${port}/?src=${encodeURIComponent(src)}`, {
      waitUntil: 'domcontentloaded',
    });
    await page.waitForTimeout(13000);
    const el = await page.$('#f');
    const s1 = decodePng(await el.screenshot());
    await page.waitForTimeout(3200);
    const s2 = decodePng(await el.screenshot());
    const st = frameStats(s1, s2);
    console.log(
      `  ${tag.padEnd(24)} 非黑=${(st.nonBlackRatio * 100).toFixed(1)}% 变化=${(
        st.diffRatio * 100
      ).toFixed(2)}% 流请求=${m3u8.length} 弹幕WS=${dm.length}`
    );
    await el.screenshot({ path: `data/ui-smoke/embed-${tag.replace(/[^a-z0-9]/gi, '_')}.png` });
  } catch (e) {
    console.log(`  ${tag} 失败: ${e.message.slice(0, 70)}`);
  }
  await page.close();
}
await browser.close();
server.close();
