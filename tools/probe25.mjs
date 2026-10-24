// Probe v25: 验证 B 站 search/all/v2 的 JSONP 能否在浏览器里跑通并拿到直播间
import { execFileSync } from 'node:child_process';
import zlib from 'node:zlib';
import { resolvePlaywright } from './resolve-playwright.mjs';

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

function curlBuf(url, headers = []) {
  const args = ['-s', '-D', '-', '--max-time', '25', '-A', UA];
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

const kw = process.argv[2] || 'AL vs KC';
const url = `https://api.bilibili.com/x/web-interface/search/all/v2?keyword=${encodeURIComponent(kw)}&page=1&callback=cbfn&jsonp=jsonp`;

console.log('=== A. 服务端响应 ===');
const raw = decode(curlBuf(url, ['Referer: https://search.bilibili.com/']));
console.log('  前缀: ' + raw.slice(0, 60).replace(/\s+/g, ' '));
try {
  const j = JSON.parse(raw.replace(/^cbfn\s*\(/, '').replace(/\);?\s*$/, ''));
  for (const g of j.data?.result || []) {
    if (g.result_type !== 'video') continue;
    const rooms = (g.data || []).filter((x) => x.roomid);
    console.log(`  视频类结果 ${g.data.length} 条，其中直播间 ${rooms.length} 个`);
    rooms.forEach((r) =>
      console.log(`    room=${r.roomid} uid=${r.uid} ${String(r.title).replace(/<[^>]+>/g, '').slice(0, 46)}`)
    );
  }
} catch (e) {
  console.log('  解析失败: ' + e.message);
}

console.log('\n=== B. 浏览器里以 <script> 加载 ===');
const { chromium } = resolvePlaywright().pw;
const browser = await chromium.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  args: ['--no-sandbox'],
});
const page = await browser.newPage();
page.on('console', (m) => console.log('  [console] ' + m.text().slice(0, 160)));
page.on('response', (r) => {
  if (r.url().includes('search/all'))
    console.log(`  [resp] ${r.status()} ct=${r.headers()['content-type']} ${r.url().slice(0, 80)}`);
});
await page.goto('https://sbf5ebf7vt81f.space.mcode.cn/', { waitUntil: 'domcontentloaded' });

const out = await page.evaluate(
  (u) =>
    new Promise((resolve) => {
      const cb = '__lpltv_test_' + Date.now().toString(36);
      window[cb] = (d) => {
        const rooms = [];
        for (const g of d?.data?.result || []) {
          if (g.result_type !== 'video') continue;
          for (const it of g.data || []) {
            if (it.roomid) rooms.push({ roomid: it.roomid, title: String(it.title || '').replace(/<[^>]+>/g, '') });
          }
        }
        resolve({ ok: true, rooms });
      };
      const s = document.createElement('script');
      s.async = true;
      s.onerror = () => resolve({ ok: false, err: 'script error' });
      s.src = u.replace('cbfn', cb);
      document.head.appendChild(s);
      setTimeout(() => resolve({ ok: false, err: 'timeout' }), 12000);
    }),
  url
);
console.log('  结果: ' + JSON.stringify(out).slice(0, 700));

await browser.close();
