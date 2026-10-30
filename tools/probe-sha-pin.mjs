/*
 * 试验「解析 → 不可变 URL」路线：
 *   ① api.github.com 拿仓库最新 commit 的 SHA（CORS 可读、按 IP 限流）
 *   ② cdn.jsdelivr.net/gh/<owner>/<repo>@<sha>/site/data/xxx.json
 *      —— 这个 URL 是**不可变**的，内容永远等于那一次提交，绕开分支 URL 的 12 小时缓存
 *
 * 用法：node tools/probe-sha-pin.mjs
 */
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

const sha = await page.evaluate(async () => {
  const ctl = new AbortController();
  const to = setTimeout(() => ctl.abort(), 8000);
  const sw = performance.now();
  try {
    const res = await fetch('https://api.github.com/repos/fjt272033067/lpl-tv/commits?per_page=1', {
      signal: ctl.signal,
      headers: { Accept: 'application/vnd.github+json' },
    });
    clearTimeout(to);
    const j = await res.json();
    return {
      status: res.status,
      ms: Math.round(performance.now() - sw),
      acao: res.headers.get('access-control-allow-origin') || '(无)',
      ratelimit: res.headers.get('x-ratelimit-remaining') || '-',
      sha: Array.isArray(j) && j[0] ? j[0].sha : null,
      msg: Array.isArray(j) ? '' : String(j.message || '').slice(0, 80),
    };
  } catch (e) {
    clearTimeout(to);
    return { err: e && e.name === 'AbortError' ? '超时8s' : String(e && e.message).slice(0, 60) };
  }
});
console.log('① api.github.com 解析 SHA：');
console.log('   ' + JSON.stringify(sha));

if (sha.sha) {
  const urls = [
    'https://cdn.jsdelivr.net/gh/fjt272033067/lpl-tv@' + sha.sha + '/site/data/version.json',
    'https://cdn.jsdelivr.net/gh/fjt272033067/lpl-tv@' + sha.sha + '/site/data/liverooms.json',
    'https://gcore.jsdelivr.net/gh/fjt272033067/lpl-tv@' + sha.sha + '/site/data/version.json',
  ];
  for (const u of urls) {
    const r = await page.evaluate(async (b) => {
      const ctl = new AbortController();
      const to = setTimeout(() => ctl.abort(), 10000);
      const sw = performance.now();
      try {
        const res = await fetch(b, { signal: ctl.signal, cache: 'no-store' });
        clearTimeout(to);
        const t = await res.text();
        let up = '';
        try {
          const j = JSON.parse(t);
          up = j.updatedAt || ('房间=' + (j.rooms || []).length);
        } catch (e) {
          up = '(非 JSON)';
        }
        return {
          status: res.status,
          ms: Math.round(performance.now() - sw),
          acao: res.headers.get('access-control-allow-origin') || '(无)',
          up,
        };
      } catch (e) {
        clearTimeout(to);
        return { err: String(e && e.message).slice(0, 50) };
      }
    }, u);
    console.log('\n② ' + u.slice(0, 96));
    console.log('   ' + JSON.stringify(r));
  }
}
await browser.close();
