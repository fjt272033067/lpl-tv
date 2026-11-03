/* =====================================================================
 * probe-live-state.mjs — 一眼看清线上站点当前状态
 *
 * 一次性检查线上这几件事（每项都给出实测数字，不是"看起来对不对"）：
 *   ① 数据新鲜度：赛程页显示的快照时间、是否有陈旧横幅、数据通道状态
 *   ② 对阵图：每个轮次的行数是否与数据一致（同一对队伍不同轮次不合并）
 *   ③ 弹幕：拖进度条后有没有冻结残留/叠字；菜单里有没有「关闭弹幕」入口
 *   ④ 合规：屏蔽词表是否加载、微信专属提示条是否已移除
 *
 * 用法：node tools/probe-live-state.mjs [线上地址] [录像id]
 * ===================================================================== */
import { resolvePlaywright } from './resolve-playwright.mjs';

const { chromium } = resolvePlaywright().pw;
const SITE = (process.argv[2] || 'https://4kf9kfxujfhg2.space.mcode.cn').replace(/\/+$/, '');
const VID = process.argv[3] || 'u4102m15w3z';

const browser = await chromium.launch({
  headless: process.env.HEADED !== '1',
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required', '--mute-audio'],
});
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();

/* ---------- ① ② 赛程页 ---------- */
await page.goto(`${SITE}/#/schedule`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(7000);
const sch = await page.evaluate(() => {
  const ROUND_NAME = {
    第一天: '第1轮', 第二天: '第2轮', 第三天: '第3轮', 第四天: '第4轮',
    第五天: '第5轮', 第六天: '第6轮', 第七天: '第7轮', 第八天: '第8轮',
    四分之一决赛: '晋级', 半决赛: '半决赛', 决赛: '决赛',
  };
  const list = window.__LPLTV_SCHED_LIST || [];
  const evTitle = (document.querySelector('.bracket-event-title span') || {}).textContent || '';
  const byRound = new Map();
  for (const m of list) {
    if (m.game !== evTitle) continue;
    if (!m.teamA || !m.teamB || /^D\d/i.test(m.teamA)) continue;
    const r = ROUND_NAME[m.phase] || '第1轮';
    if (!byRound.has(r)) byRound.set(r, new Set());
    byRound.get(r).add((m.phase || '') + '|' + [m.teamA, m.teamB].sort().join('-'));
  }
  const cols = [...document.querySelectorAll('.bracket-col')].map((c) => ({
    round: (c.querySelector('.round-name') || {}).textContent || '',
    rows: c.querySelectorAll('.bracket-row').length,
    teams: [...c.querySelectorAll('.bracket-row')].map((x) =>
      x.textContent.replace(/录播|▶/g, '').replace(/\s+/g, ' ').trim().slice(0, 14)
    ),
  }));
  const st = window.__LPLTV_DATA_STATUS__ || {};
  return {
    label: (document.querySelector('.updated-at') || {}).textContent || '',
    banner: !!document.querySelector('.sched-stale'),
    channel: { state: st.state || '', origin: st.origin || '', liveUpdatedAt: st.liveUpdatedAt || '' },
    cols: cols.filter((c) => c.round),
    bad: cols
      .filter((c) => byRound.has(c.round) && byRound.get(c.round).size !== c.rows)
      .map((c) => c.round + ' 渲染' + c.rows + ' 应为' + byRound.get(c.round).size),
    series: (document.querySelector('.bracket-event-title small') || {}).textContent || '',
  };
});
console.log('【赛程页】');
console.log('  快照标签 :', sch.label);
console.log('  陈旧横幅 :', sch.banner ? '有（异常）' : '无');
console.log('  数据通道 :', sch.channel.state, '| origin=' + sch.channel.origin, '| 直播源数据=' + sch.channel.liveUpdatedAt);
console.log('  ' + sch.series);
for (const c of sch.cols) console.log('    ' + c.round.padEnd(7) + ' ' + String(c.rows).padStart(2) + ' 行  ' + c.teams.join(' / '));
console.log('  行数核对 :', sch.bad.length ? '❌ ' + sch.bad.join('; ') : '✅ 每一列都与数据一致');

/* ---------- ③④ 播放页：弹幕 + 合规 ---------- */
await page.goto(`${SITE}/#/watch/${VID}`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(9000);
await page.evaluate(() => {
  const v = document.querySelector('.player video');
  if (v) v.currentTime = Math.min((v.duration || 600) - 5, (v.currentTime || 0) + 300);
});
await page.waitForTimeout(3000);
const dm = await page.evaluate(() => {
  const nodes = [...document.querySelectorAll('.dm-canvas .dm-item')];
  const rs = nodes.map((n) => n.getBoundingClientRect());
  let overlap = 0;
  for (let i = 0; i < rs.length; i++) {
    for (let j = i + 1; j < rs.length; j++) {
      const a = rs[i], c = rs[j];
      if (a.left < c.right && c.left < a.right && a.top < c.bottom && c.top < a.bottom) overlap++;
    }
  }
  const eng = window.__dm;
  const btn = document.querySelector('[data-ctl="danmaku"]');
  if (btn) btn.click();
  const menuItems = [...document.querySelectorAll('.menu[data-menu="dm"] .menu-item')].map((x) => x.textContent.trim());
  return {
    dom: nodes.length,
    active: eng ? eng.active.length : -1,
    overlap,
    menuItems,
    hasClose: menuItems.some((t) => /关闭弹幕|开启弹幕/.test(t)),
    wxTip: !!document.querySelector('#wx-tip'),
    words: Array.isArray(window.__LPLTV_ABUSE_WORDS) ? window.__LPLTV_ABUSE_WORDS.length : 0,
    jumpPrompt: /在浏览器打开|改用浏览器|点右上角/.test(document.body.innerText || ''),
  };
});
console.log('\n【播放页 · 弹幕】');
console.log('  拖进度条后 : 画面元素=' + dm.dom + ' 引擎在飞=' + dm.active + ' 残留=' + (dm.dom - dm.active) + ' 重叠=' + dm.overlap);
console.log('  弹幕菜单   :', JSON.stringify(dm.menuItems));
console.log('  有「关闭弹幕」入口 :', dm.hasClose ? '✅' : '❌');
console.log('\n【合规】');
console.log('  屏蔽词表   :', dm.words, '词');
console.log('  微信提示条 :', dm.wxTip ? '❌ 还在' : '✅ 已移除');
console.log('  跳出微信引导 :', dm.jumpPrompt ? '❌ 还有' : '✅ 无');

await browser.close();
