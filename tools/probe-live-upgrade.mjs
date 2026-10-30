/*
 * 验证生产环境的「远端升级」通路：冷加载线上站点，等远端通道拿到比本地快照更新的数据，
 * 看页面是否自动升级到远端那份（而不是停在部署时的本地快照）。
 *
 * 用法：node tools/probe-live-upgrade.mjs [线上地址]
 */
import { resolvePlaywright } from './resolve-playwright.mjs';
const { chromium } = resolvePlaywright().pw;

const URL = process.argv[2] || 'https://4kf9kfxujfhg2.space.mcode.cn';
const browser = await chromium.launch({
  headless: true,
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required', '--mute-audio'],
});
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();

const net = [];
page.on('response', (r) => {
  const u = r.url();
  if (/gh-proxy|raw\.githubusercontent|jsdelivr/.test(u) && /liverooms|version/.test(u)) {
    net.push(`${r.status()} ${u.replace(URL, '').slice(0, 96)}`);
  }
});

await page.goto(URL + '/?t=' + Date.now() + '#/live', { waitUntil: 'domcontentloaded' });

for (let i = 0; i < 8; i++) {
  await page.waitForTimeout(2500);
  const s = await page.evaluate(() => {
    const st = window.__LPLTV_DATA_STATUS__ || {};
    const strip = document.querySelector('.live-strip .strip-label');
    return {
      state: st.state,
      base: (st.base || '').slice(-46),
      origin: st.origin,
      updatedAt: st.updatedAt,
      banner: (document.getElementById('data-channel-banner') || {}).style?.display !== 'none',
      strip: strip ? strip.textContent.trim() : '',
      quality: document.querySelectorAll('.menu[data-menu="quality"] .menu-item').length,
    };
  });
  console.log(`  t+${(i + 1) * 2.5}s  ` + JSON.stringify(s));
}
console.log('\n网络：\n  ' + (net.join('\n  ') || '（没抓到远端请求）'));
await browser.close();
