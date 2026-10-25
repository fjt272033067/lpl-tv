/* 线上专项探针：赛程页的「腾讯实时比分覆盖」
 *
 * 线上验收套件里没有这一项（本地 58 项里有）。这里针对公网域名单独验两件事：
 *   A. 真实腾讯 LiveBMatchList.js 能否被线上页面跨域 <script> 读到并解析出结构
 *      （这是「零构建期依赖」成立的前提：休赛期该文件为空，但必须 200 且可解析）
 *   B. 注入一条假的实时数据后，线上赛程页是否真的用它覆盖构建期快照并高亮
 */
import { resolvePlaywright } from './resolve-playwright.mjs';

const URL = process.argv[2] || 'https://4kf9kfxujfhg2.space.mcode.cn';
const { chromium } = resolvePlaywright().pw;

const browser = await chromium.launch({
  headless: process.env.HEADLESS === '1',
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required', '--mute-audio'],
});
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });

/* ---------- A. 真实腾讯实时文件 ---------- */
const realPage = await ctx.newPage();
const realNet = [];
realPage.on('response', (r) => {
  if (/LIVE_BMATCH/i.test(r.url())) realNet.push(`${r.status()} ${r.url()}`);
});
await realPage.goto(URL + '/#/schedule', { waitUntil: 'domcontentloaded' });
await realPage.waitForTimeout(7000);
const realParse = await realPage.evaluate(() => {
  const v = window.LiveBMatchList;
  let count = 0;
  if (v && v.msg) {
    for (const k of Object.keys(v.msg)) count += Array.isArray(v.msg[k]) ? v.msg[k].length : 0;
  }
  return { defined: typeof v !== 'undefined', count, status: v ? v.status : null, lastUpTime: v ? v.lastUpTime : null };
});
console.log('[A] 真实腾讯实时文件');
console.log('    net: ' + (realNet.join(' | ') || '（本次未发起请求）'));
console.log('    parse: ' + JSON.stringify(realParse));
const aOk = realNet.some((s) => s.startsWith('200')) && realParse.defined;
console.log(`    ${aOk ? 'PASS' : 'FAIL'}  线上页面可跨域读入并解析腾讯实时文件`);
await realPage.close();

/* ---------- B. 注入假实时数据，验证覆盖生效 ---------- */
const livePage = await ctx.newPage();
await livePage.route('**/LOL_MATCH2_LIVE_BMATCH_LIST.js*', async (route) => {
  const body = [
    'var LiveBMatchList={"status":"0","lastUpTime":"2026-10-25 05:00:00","msg":{"246":[{',
    '"GameId":"246","GameName":"2026全球总决赛","bMatchId":"13633","bMatchName":"TES vs AL",',
    '"TeamNameA":"TES","TeamShortNameA":"TES","ScoreA":"1","TeamNameB":"AL","TeamShortNameB":"AL",',
    '"ScoreB":"1","MatchDate":"2026-10-25 01:00:00","GameMode":"1","GameProcName":"第二天",',
    '"Video3":"764502578","is_anchor":"1"}]}};',
  ].join('');
  await route.fulfill({ status: 200, contentType: 'application/javascript; charset=utf-8', body });
});
await livePage.goto(URL + '/#/schedule', { waitUntil: 'domcontentloaded' });
await livePage.waitForTimeout(5000);
const overlay = await livePage.evaluate(() => {
  const rows = [...document.querySelectorAll('.bracket-row')];
  const live = rows.filter((r) => r.classList.contains('is-live'));
  const head = [...document.querySelectorAll('.section-head .badge-live')].map((e) => e.textContent.trim());
  return {
    liveRows: live.length,
    scores: live.map((r) => {
      const sides = [...r.querySelectorAll('.bside')].map((s) => s.textContent.trim());
      const sc = (r.querySelector('.bscore') || {}).textContent || '';
      return sides.join(' ') + ' ' + sc;
    }),
    head,
  };
});
console.log('\n[B] 注入实时数据后的覆盖结果');
console.log('    ' + JSON.stringify(overlay));
const bOk = overlay.liveRows >= 1 && overlay.head.length >= 1;
console.log(`    ${bOk ? 'PASS' : 'FAIL'}  线上赛程用腾讯实时数据覆盖比分（非构建期快照）`);
await livePage.close();

await browser.close();
console.log(`\n===== 线上实时覆盖探针：${aOk && bOk ? '全部通过' : '存在失败项'} =====`);
process.exit(aOk && bOk ? 0 : 1);
