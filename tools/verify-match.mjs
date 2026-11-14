/* =====================================================================
 * verify-match.mjs — 跟赛页本地验收
 *
 * 默认**无头**（不往用户桌面弹浏览器窗口）；HEADED=1 才开有头。
 *
 * 判据清单（可证伪，不依赖数据年龄）：
 *   A 页面结构：记分牌 / 胜率条 / 对比表 / 解读 / 社群 五个区块都在
 *   B 比分来源可解释：有来源标注，拿不到就明说（绝不编造）
 *   C 胜率模型：概率恒在 [0,1]；随领先局数单调不减；3:0→100%、0:3→0%；
 *                0:0 时等于模型先验；先验与数据实算一致（不硬编码）
 *   D 模型输入来自数据文件实算（与烘焙基线一致）
 *   E 合规：页面渲染文本里屏蔽词命中数 = 0
 *   F 直播源：腾讯官方源给出多档清晰度
 *   G 独立页：不改主播放器逻辑（final.html 不引 app.js）
 *
 * 用法：node tools/verify-match.mjs
 * ===================================================================== */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolvePlaywright } from './resolve-playwright.mjs';

const { chromium } = resolvePlaywright().pw;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const SITE = path.join(ROOT, 'site');
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
};

function startServer() {
  const server = http.createServer((req, res) => {
    let p = decodeURIComponent(req.url.split('?')[0].split('#')[0]);
    if (p === '/') p = '/index.html';
    const file = path.join(SITE, p);
    if (!file.startsWith(SITE) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('404');
      return;
    }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-store',
    });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }));
  });
}

const results = [];
function check(name, pass, detail) {
  results.push({ name, pass: !!pass, detail: detail || '' });
  console.log(`  ${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
}

(async () => {
  const { server, port } = await startServer();
  const base = `http://127.0.0.1:${port}`;
  console.log('静态服务器：' + base + '\n');

  const browser = await chromium.launch({
    headless: process.env.HEADED !== '1',
    executablePath: CHROME,
    args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required', '--mute-audio'],
  });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e && e.message ? e.message : e).slice(0, 200)));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push('console: ' + m.text().slice(0, 200));
  });

  console.log('[跟赛页]');
  await page.goto(base + '/final.html', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(9000);

  /* ---------- A 页面结构 ---------- */
  const struct = await page.evaluate(() => ({
    sb: !!document.getElementById('sb'),
    prob: !!document.getElementById('prob'),
    stream: !!document.getElementById('stream'),
    compare: !!document.getElementById('compare'),
    insight: !!document.getElementById('insight'),
    social: !!document.getElementById('social'),
    nameA: (document.getElementById('sb-name-a') || {}).textContent || '',
    nameB: (document.getElementById('sb-name-b') || {}).textContent || '',
    meta: (document.getElementById('sb-meta') || {}).textContent || '',
    cmpRows: document.querySelectorAll('#cmp-table tbody tr').length,
    insItems: document.querySelectorAll('#ins-list li').length,
    hotWords: document.querySelectorAll('#hot-words .hot-word').length,
    msItems: document.querySelectorAll('#milestones .ms-item').length,
    steps: document.querySelectorAll('#prob-steps li').length,
    why: (document.getElementById('prob-why') || {}).textContent || '',
    src: (document.getElementById('sb-src') || {}).textContent || '',
    note: (document.getElementById('sb-note') || {}).textContent || '',
    qualities: document.querySelectorAll('#stream-ctl button').length,
    dmStatus: (document.getElementById('dm-status') || {}).textContent || '',
  }));
  console.log('   ' + JSON.stringify(struct).slice(0, 500));
  check('跟赛页五个区块齐全', struct.sb && struct.prob && struct.stream && struct.compare && struct.insight && struct.social);
  check('记分牌渲染出对阵与赛事信息', !!struct.nameA && !!struct.nameB && /决赛|BO5/.test(struct.meta), struct.meta.slice(0, 60));
  check('两队对比表有数据行', struct.cmpRows >= 5, struct.cmpRows + ' 行');
  check('看点解读有内容', struct.insItems >= 4, struct.insItems + ' 条');
  check('胜率推导链已展开', struct.steps >= 4, struct.steps + ' 步');

  /* ---------- B 比分来源可解释 ---------- */
  const scoreState = await page.evaluate(() => {
    const S = window.__LPLTV_MATCH__;
    return {
      score: { ...S.score },
      model: S.state.model ? { p: S.state.model.p, prior: S.state.model.prior } : null,
    };
  });
  console.log('   比分状态: ' + JSON.stringify(scoreState.score));
  check(
    '比分带来源标注（不裸奔）',
    !!scoreState.score.sourceLabel && scoreState.score.source !== 'unknown',
    scoreState.score.sourceLabel
  );
  check(
    '比分要么是数字要么明确标为未获取（不编造）',
    scoreState.score.known
      ? Number.isFinite(scoreState.score.a) && Number.isFinite(scoreState.score.b)
      : scoreState.score.source === 'none' || scoreState.score.source === 'manual',
    scoreState.score.known ? scoreState.score.a + ':' + scoreState.score.b : '未获取'
  );

  /* ---------- C 胜率模型（用页面里同一套函数实算） ---------- */
  const prob = await page.evaluate(() => {
    const S = window.__LPLTV_MATCH__;
    const p = S.state.model.p;
    const out = { p: p, prior: S.state.model.prior, grid: [] };
    for (let b = 0; b <= 3; b++) {
      for (let a = 0; a <= 3; a++) {
        // 3:3 是物理上不可能的状态（先到 3 局就结束），不纳入网格
        if (a === 3 && b === 3) continue;
        out.grid.push({ a, b, v: S.seriesWinProb(p, a, b) });
      }
    }
    return out;
  });
  check('胜率恒在 [0,1]', prob.grid.every((g) => g.v >= 0 && g.v <= 1), prob.grid.length + ' 个组合');
  check('3:0 → 100%', prob.grid.find((g) => g.a === 3 && g.b === 0).v === 1);
  check('0:3 → 0%', prob.grid.find((g) => g.a === 0 && g.b === 3).v === 0);
  check(
    '3:x 与 x:3 全部归一',
    prob.grid.filter((g) => g.a === 3).every((g) => g.v === 1) && prob.grid.filter((g) => g.b === 3).every((g) => g.v === 0)
  );
  // 单调性：对固定 b，a 增大时概率不减
  let mono = true;
  for (let b = 0; b <= 3; b++) {
    const row = prob.grid.filter((g) => g.b === b).sort((x, y) => x.a - y.a);
    for (let i = 1; i < row.length; i++) if (row[i].v < row[i - 1].v - 1e-12) mono = false;
  }
  check('随领先局数单调不减', mono);
  check(
    '0:0 等于模型先验（不允许凭空改先验）',
    Math.abs(prob.grid.find((g) => g.a === 0 && g.b === 0).v - prob.prior) < 1e-9,
    '先验 ' + (prob.prior * 100).toFixed(2) + '%'
  );

  /* ---------- D 模型输入来自数据文件实算 ---------- */
  const bakedPath = path.join(SITE, 'data', 'final-baseline.json');
  let baked = null;
  if (fs.existsSync(bakedPath)) baked = JSON.parse(fs.readFileSync(bakedPath, 'utf8'));
  check('烘焙基线存在', !!baked);
  if (baked) {
    check(
      '页面实算的 p 与烘焙基线一致（同源数据）',
      Math.abs(prob.p - baked.model.perGameWinProb) < 1e-6,
      '页面 ' + prob.p.toFixed(6) + ' vs 基线 ' + baked.model.perGameWinProb.toFixed(6)
    );
    check(
      '页面实算的先验与烘焙基线一致',
      Math.abs(prob.prior - baked.model.prior) < 1e-6,
      (prob.prior * 100).toFixed(2) + '%'
    );
    check(
      '模型输入为数据实算值（非 0/1 之类的占位）',
      baked.model.inputs.a.bo5GamesWon > 0 && baked.model.inputs.b.bo5GamesWon > 0,
      JSON.stringify(baked.model.inputs.a) + ' / ' + JSON.stringify(baked.model.inputs.b)
    );
  }

  /* ---------- D2 比分源选择：取更先进的那个（不固定优先级） ---------- */
  const pick = await page.evaluate(() => {
    const S = window.__LPLTV_MATCH__;
    const f = S.pickScoreSource;
    return {
      txAhead: f({ a: 1, b: 0 }, { a: 2, b: 0 }),
      snapAhead: f({ a: 2, b: 0 }, { a: 1, b: 0 }),
      tie: f({ a: 1, b: 0 }, { a: 1, b: 0 }),
      onlySnap: f({ a: 1, b: 0 }, null),
      onlyTx: f(null, { a: 1, b: 0 }),
      none: f(null, null),
      zeroOnly: f({ a: 0, b: 0 }, { a: 0, b: 0 }),
      hasFn: typeof f === 'function',
    };
  });
  console.log('   比分源选择: ' + JSON.stringify(pick));
  check('比分源选择函数已导出', pick.hasFn);
  check(
    '腾讯源更先进时选腾讯（局末更新比 CI 快照快）',
    pick.txAhead === 'tencent',
    'snap 1:0 vs tx 2:0 → ' + pick.txAhead
  );
  check('站内快照更先进时选快照', pick.snapAhead === 'snapshot', 'snap 2:0 vs tx 1:0 → ' + pick.snapAhead);
  check('两者一致时优先站内快照', pick.tie === 'snapshot', '1:0 vs 1:0 → ' + pick.tie);
  check('只有一个源可用时用它', pick.onlySnap === 'snapshot' && pick.onlyTx === 'tencent');
  check('两个源都没有时为 none（不编造）', pick.none === 'none');

  /* ---------- E 合规：渲染文本屏蔽词 0 命中 ---------- */
  const abuse = await page.evaluate(() => {
    const S = window.__LPLTV_MATCH__;
    const zones = ['sb', 'prob', 'compare', 'insight', 'social'];
    const texts = [];
    for (const z of zones) {
      const n = document.getElementById(z);
      if (n) texts.push(n.textContent || '');
    }
    const dm = document.getElementById('dm-live');
    if (dm) texts.push(dm.textContent || '');
    const all = texts.join('\n');
    const words = window.__LPLTV_ABUSE_WORDS || [];
    const hits = [];
    for (const w of words) {
      const n = String(w).toLowerCase();
      const re = /^[a-z]{2,4}$/.test(n) ? new RegExp('(?<![a-z0-9])' + n + '(?![a-z0-9])', 'g') : null;
      const c = re ? (all.toLowerCase().match(re) || []).length : all.toLowerCase().split(n).length - 1;
      if (c > 0) hits.push(w + '×' + c);
    }
    return { hits: hits, chars: all.length, hasFn: typeof S.hasAbuse === 'function' };
  });
  check('跟赛面板渲染文本屏蔽词命中数为 0', abuse.hits.length === 0, abuse.hits.join(', ') || ('扫描 ' + abuse.chars + ' 字符'));

  /* ---------- F 直播源 ---------- */
  check('腾讯官方源给出多档清晰度', struct.qualities >= 2, struct.qualities + ' 档');

  /* ---------- G 独立页 ---------- */
  const html = fs.readFileSync(path.join(SITE, 'final.html'), 'utf8');
  check('跟赛页不引主站 app.js（不碰主播放器逻辑）', !/assets\/app\.js/.test(html));
  check('跟赛页引用了屏蔽词唯一来源', /assets\/abuse-words\.js/.test(html));

  /* ---------- 页面错误 ---------- */
  check('跟赛页无 JS 运行时错误', errors.length === 0, errors.slice(0, 3).join(' | '));

  /* ---------- 移动端 ---------- */
  console.log('\n[移动端]');
  const mctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  const mp = await mctx.newPage();
  await mp.goto(base + '/final.html', { waitUntil: 'domcontentloaded' });
  // 首屏 2.5 秒内就应给出胜率（用本地烘焙基线先算一版，不等远端赛程）
  await mp.waitForTimeout(2500);
  const firstPaint = await mp.evaluate(() => ({
    pct: (document.getElementById('prob-pct-a') || {}).textContent || '',
    score: (document.getElementById('sb-score-a') || {}).textContent || '',
  }));
  check(
    '首屏 2.5 秒内就渲染出胜率（不等远端赛程）',
    /%/.test(firstPaint.pct),
    'prob-pct-a=' + firstPaint.pct
  );
  await mp.waitForTimeout(9000);
  const mob = await mp.evaluate(() => {
    const wrap = document.querySelector('.m-wrap');
    const card = document.querySelector('.card');
    const nums = document.querySelector('.sb-nums');
    return {
      overflowX: document.documentElement.scrollWidth > window.innerWidth + 2,
      scrollW: document.documentElement.scrollWidth,
      winW: window.innerWidth,
      cardW: card ? card.getBoundingClientRect().width : 0,
      numsW: nums ? nums.getBoundingClientRect().width : 0,
      wrapW: wrap ? wrap.getBoundingClientRect().width : 0,
      probPct: (document.getElementById('prob-pct-a') || {}).textContent || '',
    };
  });
  console.log('   ' + JSON.stringify(mob));
  check('移动端无横向溢出', !mob.overflowX, mob.scrollW + ' vs ' + mob.winW);
  check('移动端胜率数值已渲染', /%/.test(mob.probPct), mob.probPct);

  const pass = results.filter((r) => r.pass).length;
  console.log(`\n=== 跟赛页验收：${pass}/${results.length} 通过 ===`);
  for (const r of results) if (!r.pass) console.log('  FAIL ' + r.name + ' — ' + r.detail);

  await browser.close();
  server.close();
  process.exit(pass === results.length ? 0 : 1);
})();
