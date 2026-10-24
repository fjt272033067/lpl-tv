// Probe v30: 对比不同 B 站直播间 URL，用「画面是否在变化」当硬指标
import { resolvePlaywright } from './resolve-playwright.mjs';
const { chromium } = resolvePlaywright().pw;

const ROOM = process.argv[2] || '8016907';
const browser = await chromium.launch({
  headless: false,
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required', '--mute-audio', '--window-size=1400,900'],
});

function diffRatio(a, b) {
  const n = Math.min(a.length, b.length);
  if (!n) return 0;
  let d = 0;
  for (let i = 0; i < n; i++) if (a[i] !== b[i]) d++;
  return d / n;
}

const urls = [
  ['blanc', `https://live.bilibili.com/blanc/${ROOM}`],
  ['blanc+bili_jct', `https://live.bilibili.com/blanc/${ROOM}?bili_jct=`],
  ['完整直播间页', `https://live.bilibili.com/${ROOM}`],
  ['embed 变体', `https://live.bilibili.com/embed/${ROOM}`],
];

for (const [tag, url] of urls) {
  const page = await browser.newPage({ viewport: { width: 1100, height: 760 } });
  const net = [];
  page.on('response', (r) => {
    const u = r.url();
    if (/\.m3u8|\.flv/.test(u)) net.push(r.status() + ' ' + u.slice(0, 70));
  });
  let body = '';
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 25000 });
    await page.waitForTimeout(11000);
    body = await page.evaluate(() => (document.body.innerText || '').replace(/\s+/g, ' ').slice(0, 300));
    const s1 = await page.screenshot();
    await page.waitForTimeout(3000);
    const s2 = await page.screenshot();
    const ratio = diffRatio(s1, s2);
    console.log(`\n=== ${tag} (${url}) ===`);
    console.log(`  画面变化率 = ${(ratio * 100).toFixed(2)}%  ${ratio > 0.005 ? '✅ 在动' : '❌ 静止/黑屏'}`);
    console.log(`  流请求: ${net.slice(0, 2).join(' | ') || '(无)'}`);
    console.log(`  文本: ${body.slice(0, 120)}`);
  } catch (e) {
    console.log(`\n=== ${tag} === 加载失败: ${e.message.slice(0, 80)}`);
  }
  await page.close();
}
await browser.close();
