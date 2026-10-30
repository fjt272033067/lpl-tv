/*
 * 线上「远端自动升级」链路探针（默认无头，不弹浏览器窗口）。
 *
 * 要回答的问题：线上页面是不是**停在了部署那一刻的本地快照**，
 * 还是能自动升级到仓库里更新的那份数据？
 *
 * 判定是「通道感知」的（和 verify-public.mjs 同一套哲学）：
 *   · 浏览器能连通至少一个镜像 → 必须升级到更新的远端那份，否则是站点缺陷；
 *   · 一个镜像都连不上 → 属于网络环境问题（比如 raw.githubusercontent 在
 *     本机浏览器里被 hosts 指到 127.0.0.1），报告为「通道不可达」，
 *     **不**判成站点回归。
 *
 * 用法：node tools/probe-live-upgrade.mjs [线上地址] [最长等待秒数]
 */
import { resolvePlaywright } from './resolve-playwright.mjs';
const { chromium } = resolvePlaywright().pw;

const URL = (process.argv[2] || 'https://4kf9kfxujfhg2.space.mcode.cn').replace(/\/+$/, '');
const MAX_WAIT = Number(process.argv[3] || 100);

// 部署时烘焙进去的本地快照时间戳（线上 version.json = 本地快照的「上次核对上游」时间）
let deployed = null;
try {
  const r = await fetch(URL + '/data/version.json?t=' + Date.now());
  deployed = await r.json();
} catch (e) {
  console.log('拿不到线上 version.json：' + String(e.message).slice(0, 80));
}
const localLiveStamp = (deployed && deployed.files && deployed.files.liverooms) || '';
console.log('部署内的本地快照 liverooms：' + (localLiveStamp || '(未知)'));
console.log('线上地址：' + URL + '（最多等 ' + MAX_WAIT + ' 秒）\n');

const browser = await chromium.launch({
  headless: process.env.HEADED !== '1',
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required', '--mute-audio'],
});
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();

const net = [];
page.on('response', (r) => {
  const u = r.url();
  if (/gh-proxy|raw\.githubusercontent|jsdelivr/.test(u) && /liverooms|version/.test(u)) {
    net.push(`${r.status()} ${u.slice(0, 110)}`);
  }
});
page.on('requestfailed', (r) => {
  const u = r.url();
  if (/gh-proxy|raw\.githubusercontent|jsdelivr/.test(u)) {
    net.push(`FAIL ${u.slice(0, 110)}`);
  }
});

await page.goto(URL + '/?t=' + Date.now() + '#/live', { waitUntil: 'domcontentloaded' });

let last = null;
const t0 = Date.now();
while (Date.now() - t0 < MAX_WAIT * 1000) {
  await page.waitForTimeout(3000);
  const s = await page.evaluate(() => {
    const st = window.__LPLTV_DATA_STATUS__ || {};
    const strip = document.querySelector('.live-strip .strip-label');
    const banner = document.getElementById('data-channel-banner');
    return {
      state: st.state || '',
      // 完整 base（别在这里截断：后面要解析主机名，截了就只剩一段路径）
      base: st.base || '',
      origin: st.origin || '',
      liveUpdatedAt: st.liveUpdatedAt || '',
      banner: banner ? banner.textContent.replace(/\s+/g, ' ').slice(0, 70) : '',
      strip: strip ? strip.textContent.trim() : '',
      quality: document.querySelectorAll('.menu[data-menu="quality"] .menu-item').length,
    };
  });
  last = s;
  const upgraded =
    localLiveStamp && s.liveUpdatedAt && Date.parse(s.liveUpdatedAt) > Date.parse(localLiveStamp);
  console.log(
    `  t+${((Date.now() - t0) / 1000).toFixed(0)}s  ` +
      JSON.stringify({ ...s, base: s.base.slice(-46) }) +
      (upgraded ? '   ← 已升级到更新的远端' : '')
  );
  if (upgraded) break;
}

console.log('\n镜像请求：\n  ' + (net.join('\n  ') || '（没抓到远端请求）'));

const channelOk = !!(last && last.state === 'ok');
const upgraded = !!(
  last &&
  localLiveStamp &&
  last.liveUpdatedAt &&
  Date.parse(last.liveUpdatedAt) > Date.parse(localLiveStamp)
);
console.log('\n===== 判定 =====');
if (upgraded) {
  console.log('PASS 线上页面已自动升级到更新的远端直播源');
  console.log('      部署快照 ' + localLiveStamp + ' → 实际生效 ' + last.liveUpdatedAt);
} else if (!channelOk) {
  console.log('WARN 浏览器连不上任何远端镜像 —— 属于网络环境问题，不是站点回归');
  console.log('      （raw.githubusercontent 在本机被 hosts 指到 127.0.0.1 时就会这样）');
} else {
  console.log('FAIL 通道是通的，但页面没有升级到更新的远端数据 —— 站点缺陷');
  console.log('      state=' + last.state + ' origin=' + last.origin + ' liveUpdatedAt=' + last.liveUpdatedAt);
}
// base 是完整 URL（可能是 gh-proxy 包着 raw.githubusercontent），
// 只显示主机名会误以为「用的就是 raw」——所以这里把包一层的那层也标出来
let baseHost = '(无)';
if (last && last.base) {
  try {
    const u = new URL(last.base);
    const inner = u.pathname.match(/^https?:\/\/([^/]+)/);
    baseHost = u.host + (inner ? ' → 实际取自 ' + inner[1] : '');
  } catch (e) {
    baseHost = last.base;
  }
}
console.log('通道 base：' + baseHost);
console.log('横幅：' + (last && last.banner ? last.banner : '(无)'));
console.log('清晰度档位：' + (last ? last.quality : '(无)'));

await browser.close();
