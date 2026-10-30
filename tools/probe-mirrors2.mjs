/*
 * 扫描「实时镜像」候选：从**浏览器**里实测（Chrome 的网络路径和 Node 不一样）。
 * 重点看两件事：① 通不通 ② 拿到的是不是仓库**当前最新**的内容。
 *
 * 用法：node tools/probe-mirrors2.mjs [期望的 version.json.updatedAt]
 */
import { resolvePlaywright } from './resolve-playwright.mjs';
const { chromium } = resolvePlaywright().pw;

const LATEST = process.argv[2] || '';
const RAW = 'https://raw.githubusercontent.com/fjt272033067/lpl-tv/main/site/data';

const CANDIDATES = [
  ['raw(直连)', RAW],
  ['gh-proxy.com', 'https://gh-proxy.com/' + RAW],
  ['ghproxy.net', 'https://ghproxy.net/' + RAW],
  ['gh-proxy.net', 'https://gh-proxy.net/' + RAW],
  ['ghproxy.cc', 'https://ghproxy.cc/' + RAW],
  ['ghfast.top', 'https://ghfast.top/' + RAW],
  ['gh.llkk.cc', 'https://gh.llkk.cc/' + RAW],
  ['ghp.ci', 'https://ghp.ci/' + RAW],
  ['github.moeyy', 'https://github.moeyy.xyz/' + RAW],
  ['gh-proxy.cc', 'https://gh-proxy.cc/' + RAW],
  ['ghproxy.homeboyc', 'https://ghproxy.homeboyc.cn/' + RAW],
  ['hub.gitmirror', 'https://hub.gitmirror.com/https://raw.githubusercontent.com/fjt272033067/lpl-tv/main/site/data'],
  ['gitclone', 'https://gitclone.com/github.com/fjt272033067/lpl-tv/raw/main/site/data'],
  ['gh.api.99988866', 'https://gh.api.99988866.xyz/' + RAW],
  ['gh.ddlc.top', 'https://gh.ddlc.top/' + RAW],
  ['ghproxy.ru', 'https://ghproxy.ru/' + RAW],
  ['gh-proxy.cn', 'https://gh-proxy.cn/' + RAW],
  ['ghproxy.link', 'https://ghproxy.link/' + RAW],
];

const browser = await chromium.launch({
  headless: true,
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  args: ['--no-sandbox'],
});
const ctx = await browser.newContext();
const page = await ctx.newPage();
await page.goto('https://4kf9kfxujfhg2.space.mcode.cn/', { waitUntil: 'domcontentloaded' });

console.log('候选'.padEnd(20) + '状态    耗时     ACAO   新鲜度');
console.log('-'.repeat(70));
const good = [];
for (const [name, base] of CANDIDATES) {
  const r = await page.evaluate(async (b) => {
    const ctl = new AbortController();
    const to = setTimeout(() => ctl.abort(), 8000);
    const sw = performance.now();
    try {
      const res = await fetch(b + '/version.json', { signal: ctl.signal, cache: 'no-store' });
      clearTimeout(to);
      const ms = Math.round(performance.now() - sw);
      let up = '?';
      try {
        up = (await res.json()).updatedAt || '无';
      } catch (e) {
        up = '非 JSON';
      }
      return { status: res.status, ms, acao: res.headers.get('access-control-allow-origin') || '(无)', up };
    } catch (e) {
      clearTimeout(to);
      return { err: e && e.name === 'AbortError' ? '超时8s' : String(e && e.message).slice(0, 34), ms: Math.round(performance.now() - sw) };
    }
  }, base);
  const fresh = LATEST && r.up === LATEST ? '✅最新' : LATEST && r.up && r.up !== '?' && r.up !== '非 JSON' ? '❌落后' : '';
  console.log(
    name.padEnd(20) +
      (r.err ? ('ERR ' + r.err).padEnd(16) : String(r.status).padEnd(9)) +
      String(r.ms) + 'ms'.padEnd(9) +
      String(r.acao).padEnd(8) +
      fresh
  );
  if (r.status === 200 && r.acao === '*' && fresh === '✅最新') good.push(name + ' :: ' + base);
}
console.log('\n可用且最新的实时镜像：\n  ' + (good.join('\n  ') || '（没有）'));
await browser.close();
