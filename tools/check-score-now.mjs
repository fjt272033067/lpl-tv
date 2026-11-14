/**
 * check-score-now.mjs — 核对「页面当前显示的比分」与各数据源的实际值
 *
 * 回答三件事：
 *   ① 线上跟赛页此刻显示什么比分、来自哪个源
 *   ② 四个镜像此刻各自的 updatedAt 与决赛比分（看哪个落后 —— 但结论不可固化）
 *   ③ 腾讯静态记分牌此刻的 Last-Modified 与比分
 */
import { resolvePlaywright } from './resolve-playwright.mjs';

const { chromium } = resolvePlaywright().pw;
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const ONLINE = 'https://4kf9kfxujfhg2.space.mcode.cn';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0 Safari/537.36';

console.log('=== ① 线上页面当前比分 ===');
const browser = await chromium.launch({ headless: true, executablePath: CHROME, args: ['--no-sandbox', '--mute-audio'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const perrs = [];
page.on('pageerror', (e) => perrs.push(String((e && e.message) || e).slice(0, 200)));
page.on('console', (m) => {
  if (m.type() === 'error') perrs.push('console: ' + m.text().slice(0, 200));
});
await page.goto(ONLINE + '/final.html', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(20000);
const view = await page.evaluate(() => {
  const S = window.__LPLTV_MATCH__;
  if (!S) return { fatal: 'window.__LPLTV_MATCH__ 不存在（脚本没加载？）' };
  const m = S.state.model;
  return {
    fatal: null,
    score: { ...S.score },
    p: m ? m.p : null,
    prior: m ? m.prior : null,
    scheduleUpdatedAt: S.state.scheduleUpdatedAt,
    finalMatch: S.state.finalMatch ? { teamA: S.state.finalMatch.teamA, teamB: S.state.finalMatch.teamB, score: S.state.finalMatch.score } : null,
    matchCount: S.state.matches.length,
    tencentStatus: S.state.tencentStatus,
    tencentUpdatedAt: S.state.tencentUpdatedAt,
    shownA: (document.getElementById('sb-score-a') || {}).textContent,
    shownB: (document.getElementById('sb-score-b') || {}).textContent,
    why: (document.getElementById('prob-why') || {}).textContent,
    srcText: (document.getElementById('sb-src') || {}).textContent,
  };
});
console.log(JSON.stringify(view, null, 1));
if (perrs.length) console.log('页面错误:', perrs.slice(0, 5));
await browser.close();

console.log('\n=== ② 四个镜像此刻的 schedule.json ===');
const bases = [
  ['gh-proxy', 'https://gh-proxy.com/https://raw.githubusercontent.com/fjt272033067/lpl-tv/main/site/data'],
  ['gcore.jsdelivr', 'https://gcore.jsdelivr.net/gh/fjt272033067/lpl-tv@main/site/data'],
  ['cdn.jsdelivr', 'https://cdn.jsdelivr.net/gh/fjt272033067/lpl-tv@main/site/data'],
  ['raw.gh', 'https://raw.githubusercontent.com/fjt272033067/lpl-tv/main/site/data'],
];
for (const [name, base] of bases) {
  try {
    const r = await fetch(base + '/schedule.json', { headers: { 'Cache-Control': 'no-cache' } });
    const j = await r.json();
    const f = (j.matches || []).filter((m) => /GEN/i.test(m.teamA || '') && /BLG/i.test(m.teamB || ''))[0];
    console.log(`  ${name.padEnd(14)} updatedAt=${j.updatedAt}  决赛=${f ? f.score : '-'}  Age=${r.headers.get('age')}`);
  } catch (e) {
    console.log(`  ${name.padEnd(14)} ERR ${e.message}`);
  }
}

console.log('\n=== ③ 腾讯静态记分牌此刻 ===');
for (const [label, url] of [
  ['LiveBMatchList', 'https://lpl.qq.com/web201612/data/LOL_MATCH2_LIVE_BMATCH_LIST.js'],
  ['MATCH_LIST_246', 'https://lpl.qq.com/web201612/data/LOL_MATCH2_MATCH_HOMEPAGE_BMATCH_LIST_246.js'],
]) {
  try {
    const r = await fetch(url, { headers: { 'User-Agent': UA, Referer: 'https://lpl.qq.com/', 'Cache-Control': 'no-cache' } });
    const t = await r.text();
    console.log(`  ${label}: LM=${r.headers.get('last-modified')} Age=${r.headers.get('age')} CC=${r.headers.get('cache-control')}`);
    if (label === 'LiveBMatchList') {
      const m = t.match(/var\s+LiveBMatchList\s*=\s*(\{[\s\S]*\})\s*;?\s*$/);
      const j = JSON.parse(m[1]);
      console.log('    lastUpTime=', j.lastUpTime);
      for (const v of Object.values(j.msg)) {
        if (typeof v !== 'string' || !v) continue;
        try {
          const row = JSON.parse(v);
          if (/GEN|BLG/i.test(JSON.stringify(row))) {
            console.log(`    → ${row.bMatchName} ScoreA=${row.ScoreA} ScoreB=${row.ScoreB} MatchStatus=${row.MatchStatus}`);
          }
        } catch (e) {}
      }
    } else {
      const j = JSON.parse(t);
      console.log('    lastUpTime=', j.lastUpTime);
      const f = (j.msg || []).filter((r) => /GEN/i.test(r.TeamNameA || '') && /BLG/i.test(r.TeamNameB || ''));
      for (const r of f) console.log(`    → ${r.bMatchName} ScoreA=${r.ScoreA} ScoreB=${r.ScoreB} MatchStatus=${r.MatchStatus}`);
    }
  } catch (e) {
    console.log(`  ${label}: ERR ${e.message}`);
  }
}
