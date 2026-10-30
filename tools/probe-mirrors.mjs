/*
 * 探测「远端数据镜像」候选：从**浏览器**里实测（浏览器和 Node 的网络路径不一样，
 * Node 能通不代表浏览器能通 —— hosts/系统代理那套浏览器不继承）。
 *
 * 每个候选测三件事：
 *   1) 通不通（浏览器里能不能拿到）
 *   2) 拿到的是不是**最新**内容（对比远端仓库当前的 version.json.updatedAt）
 *   3) 有没有 CORS 头（站点是纯静态、不能有后端代理）
 *
 * 用法：node tools/probe-mirrors.mjs
 */
import { resolvePlaywright } from './resolve-playwright.mjs';
const { chromium } = resolvePlaywright().pw;

const LATEST = process.argv[2] || ''; // 期望的 version.json.updatedAt（留空则不判新鲜度）

const CANDIDATES = [
  ['raw.githubusercontent', 'https://raw.githubusercontent.com/fjt272033067/lpl-tv/main/site/data'],
  ['gcore.jsdelivr', 'https://gcore.jsdelivr.net/gh/fjt272033067/lpl-tv@main/site/data'],
  ['cdn.jsdelivr', 'https://cdn.jsdelivr.net/gh/fjt272033067/lpl-tv@main/site/data'],
  ['fastly.jsdelivr', 'https://fastly.jsdelivr.net/gh/fjt272033067/lpl-tv@main/site/data'],
  ['jsd.onmicrosoft', 'https://jsd.onmicrosoft.cn/gh/fjt272033067/lpl-tv@main/site/data'],
  ['statically.io', 'https://cdn.statically.io/gh/fjt272033067/lpl-tv/main/site/data'],
  ['raw.gitmirror', 'https://raw.gitmirror.com/fjt272033067/lpl-tv/main/site/data'],
  ['ghproxy.net', 'https://ghproxy.net/https://raw.githubusercontent.com/fjt272033067/lpl-tv/main/site/data'],
  ['gh-proxy.com', 'https://gh-proxy.com/https://raw.githubusercontent.com/fjt272033067/lpl-tv/main/site/data'],
  ['kgithub', 'https://raw.kgithub.com/fjt272033067/lpl-tv/main/site/data'],
  ['gitcdn.link', 'https://gitcdn.link/repo/fjt272033067/lpl-tv/main/site/data'],
  ['jsd.gcore', 'https://jsd.gcore.io/gh/fjt272033067/lpl-tv@main/site/data'],
];

const browser = await chromium.launch({
  headless: true,
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  args: ['--no-sandbox'],
});
const ctx = await browser.newContext();
const page = await ctx.newPage();
await page.goto('https://4kf9kfxujfhg2.space.mcode.cn/', { waitUntil: 'domcontentloaded' });

console.log('候选'.padEnd(18) + '状态   耗时    ACAO        新鲜度');
console.log('-'.repeat(78));
for (const [name, base] of CANDIDATES) {
  const r = await page.evaluate(async (b) => {
    const ctl = new AbortController();
    const to = setTimeout(() => ctl.abort(), 7000);
    const sw = performance.now();
    try {
      const res = await fetch(b + '/version.json', { signal: ctl.signal, cache: 'no-store' });
      clearTimeout(to);
      const ms = Math.round(performance.now() - sw);
      const acao = res.headers.get('access-control-allow-origin');
      const cc = res.headers.get('cache-control');
      let up = '?';
      try {
        const j = await res.json();
        up = j.updatedAt || '无 updatedAt';
      } catch (e) {
        up = '非 JSON';
      }
      return { status: res.status, ms, acao: acao || '(无)', cc: cc || '', up };
    } catch (e) {
      clearTimeout(to);
      return { err: e && e.name === 'AbortError' ? '超时 7s' : String(e && e.message).slice(0, 40), ms: Math.round(performance.now() - sw) };
    }
  }, base);
  const fresh = LATEST && r.up === LATEST ? '✅ 最新' : LATEST ? '❌ 落后' : '';
  console.log(
    name.padEnd(18) +
      (r.err ? ('ERR ' + r.err).padEnd(14) : String(r.status).padEnd(7)) +
      String(r.ms) + 'ms'.padEnd(8) +
      String(r.acao).padEnd(12) +
      fresh +
      '  ' +
      r.up
  );
}
await browser.close();
