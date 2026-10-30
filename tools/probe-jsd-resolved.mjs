/*
 * 试验：jsDelivr 的「版本解析」接口能不能给出**当前最新 commit**，
 * 再用不可变 URL（@<sha>）取数据 —— 这样既避开 12 小时分支缓存，又不依赖 raw。
 *
 * 用法：node tools/probe-jsd-resolved.mjs
 */
import { resolvePlaywright } from './resolve-playwright.mjs';
const { chromium } = resolvePlaywright().pw;

const REPO = 'fjt272033067/lpl-tv';
const browser = await chromium.launch({
  headless: true,
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  args: ['--no-sandbox'],
});
const ctx = await browser.newContext();
const page = await ctx.newPage();
await page.goto('https://4kf9kfxujfhg2.space.mcode.cn/', { waitUntil: 'domcontentloaded' });

const api = 'https://data.jsdelivr.com/v1/packages/gh/' + REPO;
for (const u of [api + '@main/resolved', api, 'https://data.jsdelivr.com/v1/package/gh/' + REPO + '@main/resolved']) {
  const r = await page.evaluate(async (b) => {
    const ctl = new AbortController();
    const to = setTimeout(() => ctl.abort(), 8000);
    const sw = performance.now();
    try {
      const res = await fetch(b, { signal: ctl.signal, cache: 'no-store' });
      clearTimeout(to);
      const t = await res.text();
      return {
        status: res.status,
        ms: Math.round(performance.now() - sw),
        acao: res.headers.get('access-control-allow-origin') || '(无)',
        cc: res.headers.get('cache-control') || '-',
        body: t.slice(0, 300),
      };
    } catch (e) {
      clearTimeout(to);
      return { err: e && e.name === 'AbortError' ? '超时8s' : String(e && e.message).slice(0, 40) };
    }
  }, u);
  console.log('\n' + u);
  console.log('  ' + JSON.stringify(r).slice(0, 520));
}

// 用解析到的 sha 取数据
const resolved = await page.evaluate(async (b) => {
  try {
    const res = await fetch(b, { cache: 'no-store' });
    if (!res.ok) return null;
    const j = await res.json();
    return j.version || (j.versions && j.versions[0] && j.versions[0].version) || null;
  } catch (e) {
    return null;
  }
}, api + '@main/resolved');
console.log('\n解析到的版本：' + (resolved || '(拿不到)'));

if (resolved) {
  const dataUrl = 'https://cdn.jsdelivr.net/gh/' + REPO + '@' + resolved + '/site/data/version.json';
  const r = await page.evaluate(async (b) => {
    try {
      const res = await fetch(b, { cache: 'no-store' });
      const t = await res.text();
      return { status: res.status, acao: res.headers.get('access-control-allow-origin') || '(无)', body: t.slice(0, 220) };
    } catch (e) {
      return { err: String(e && e.message).slice(0, 50) };
    }
  }, dataUrl);
  console.log('\n按 sha 取 version.json：' + dataUrl);
  console.log('  ' + JSON.stringify(r));
}
await browser.close();
