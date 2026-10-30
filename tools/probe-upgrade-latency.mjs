/*
 * 诊断：冷加载时「远端数据升级」到底有没有发生、耗时多久。
 *
 * 背景
 * ----
 * 站点铁律是「远端绝不能挡住首屏」：本地快照先渲染，远端在后台探测，
 * 探测到更新的数据后再通过 onRemoteUpgrade 回调触发重绘。
 *
 * 线上验收里出现过一个矛盾现象：
 *   · 内置浏览器打开同一地址 → DOM 完整（清晰度 2 档、侧栏 6 行、通知条有内容）；
 *   · Playwright 冷加载 → 清晰度 0 档、侧栏 0 行、通知条 0 项。
 *
 * 本探针用「全新 context（空 sessionStorage）」复现冷加载，逐秒记录：
 *   · 对 raw.githubusercontent.com 的每个请求（状态码 + 耗时）；
 *   · 关键 DOM 里程碑第一次出现的时间。
 *
 * 判读方式
 * --------
 *   A. 远端 version.json 请求 200，但里程碑在超时内一直不出现
 *      → 升级回调丢失（探测返回时页面还没注册回调 / 回调注册后没再触发）。
 *   B. 远端 version.json 请求失败（0 / 404 / CORS）
 *      → 远端通道本身断了。
 *   C. 里程碑在 T 秒出现
 *      → 升级有效，只是验收采样太早。
 *
 * 用法：node tools/probe-upgrade-latency.mjs [线上地址] [观察秒数]
 */
import { resolvePlaywright } from './resolve-playwright.mjs';

const { chromium } = resolvePlaywright().pw;

const URL = process.argv[2] || 'https://4kf9kfxujfhg2.space.mcode.cn';
const OBSERVE = Number(process.argv[3] || 60);

const browser = await chromium.launch({
  headless: process.env.HEADED !== '1',
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required', '--mute-audio', '--window-size=1440,900'],
});
// 全新 context = 空 sessionStorage = 真·冷加载
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();

const t0 = Date.now();
const el = () => ((Date.now() - t0) / 1000).toFixed(1).padStart(5) + 's';

console.log(`冷加载探针： ${URL}`);
console.log(`观察窗口： ${OBSERVE}s\n`);

console.log('── 网络（只列 raw.githubusercontent.com 与本站 data/） ──');
page.on('request', (r) => {
  const u = r.url();
  if (/raw\.githubusercontent\.com/.test(u) || /\/data\/.*\.json/.test(u)) {
    console.log(`  ${el()} → ${r.method()} ${u.replace(URL, '').slice(0, 120)}`);
  }
});
page.on('response', async (r) => {
  const u = r.url();
  if (/raw\.githubusercontent\.com/.test(u)) {
    console.log(`  ${el()} ← ${r.status()} ${u.slice(0, 110)}`);
  }
});
page.on('requestfailed', (r) => {
  const u = r.url();
  if (/raw\.githubusercontent\.com/.test(u)) {
    console.log(`  ${el()} ✗ FAILED ${u.slice(0, 110)} :: ${r.failure() && r.failure().errorText}`);
  }
});

await page.goto(URL + '/?t=' + Date.now() + '#/live', { waitUntil: 'domcontentloaded' });
console.log(`  ${el()} ⇢ 已导航\n`);

console.log('── DOM 里程碑 ──');
const MILESTONES = {
  '远端 version.json 响应': async () =>
    page.evaluate(async () => {
      try {
        const r = await fetch('https://raw.githubusercontent.com/fjt272033067/lpl-tv/main/site/data/version.json', {
          method: 'HEAD',
          mode: 'cors',
        });
        return r.ok ? 'ok' : 'http' + r.status;
      } catch (e) {
        return 'cors-fail';
      }
    }),
};

const seen = {};
const probe = async () =>
  page.evaluate(() => {
    const q = document.querySelector('.menu[data-menu="quality"]');
    return {
      q: q ? q.querySelectorAll('.menu-item').length : 0,
      rows: document.querySelectorAll('.side-row').length,
      strip: document.querySelectorAll('.live-strip .strip-item').length,
      panels: document.querySelectorAll('.side-panel').length,
      heroPlayer: !!document.querySelector('.hero .player'),
      // 「远端实时数据」标记 / 快照时间文案
      txt: (document.querySelector('.view, #view') || document.body).innerText.replace(/\s+/g, ' ').slice(0, 260),
      ss: (() => {
        try {
          const c = sessionStorage.getItem('lpltv-remote-ver');
          return c ? c.slice(0, 160) : '(null)';
        } catch (e) {
          return '(err)';
        }
      })(),
    };
  });

let last = null;
for (let i = 0; i < OBSERVE; i++) {
  const s = await probe();
  const key = `q=${s.q} rows=${s.rows} strip=${s.strip} panels=${s.panels} hero=${s.heroPlayer}`;
  if (key !== last) {
    console.log(`  ${el()}  ${key}`);
    last = key;
  }
  const sess = s.ss;
  if (sess && sess !== '(null)' && !seen['ss']) {
    seen['ss'] = true;
    console.log(`  ${el()}  sessionStorage[lpltv-remote-ver] = ${sess}`);
  }
  for (const [name, fn] of Object.entries(MILESTONES)) {
    if (seen[name]) continue;
    const v = await fn();
    seen[name] = true;
    console.log(`  ${el()}  ${name} → ${v}`);
  }
  await page.waitForTimeout(1000);
}

const s = await probe();
console.log('\n── 最终快照 ──');
console.log('  ' + JSON.stringify(s, null, 2).replace(/\n/g, '\n  '));
console.log('\n  文案片段： ' + s.txt);

await browser.close();
