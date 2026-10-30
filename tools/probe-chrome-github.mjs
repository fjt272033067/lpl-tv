/* 诊断：本机 Chrome 到底能不能直连 raw.githubusercontent.com（Playwright 环境） */
import { resolvePlaywright } from './resolve-playwright.mjs';
const { chromium } = resolvePlaywright().pw;

const browser = await chromium.launch({
  headless: true,
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  args: ['--no-sandbox'],
});
const ctx = await browser.newContext();
const page = await ctx.newPage();
await page.goto('https://4kf9kfxujfhg2.space.mcode.cn/', { waitUntil: 'domcontentloaded' });

const targets = [
  'https://raw.githubusercontent.com/fjt272033067/lpl-tv/main/site/data/version.json',
  'https://gcore.jsdelivr.net/gh/fjt272033067/lpl-tv@main/site/data/version.json',
  'https://cdn.jsdelivr.net/gh/fjt272033067/lpl-tv@main/site/data/version.json',
  'https://ghproxy.net/https://raw.githubusercontent.com/fjt272033067/lpl-tv/main/site/data/version.json',
];

for (const t of targets) {
  const r = await page.evaluate(async (url) => {
    const sw = performance.now();
    try {
      const ctl = new AbortController();
      const to = setTimeout(() => ctl.abort(), 6000);
      const res = await fetch(url, { signal: ctl.signal });
      clearTimeout(to);
      const txt = await res.text();
      return { ok: res.ok, status: res.status, ms: Math.round(performance.now() - sw), cc: res.headers.get('cache-control'), len: txt.length };
    } catch (e) {
      return { err: String(e && e.name ? e.name + ': ' + e.message : e), ms: Math.round(performance.now() - sw) };
    }
  }, t);
  console.log(t.slice(0, 78).padEnd(80), JSON.stringify(r));
}
await browser.close();
