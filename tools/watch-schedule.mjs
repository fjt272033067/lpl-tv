/*
 * 盯 GitHub Actions 的 event=schedule run 数量随时间的变化。
 * 用来判决：cron-probe（每 5 分钟一次）到底会不会被调度。
 *
 * 用法：node tools/watch-schedule.mjs [分钟]
 */
const MIN = Number(process.argv[2] || 20);
const END = Date.now() + MIN * 60 * 1000;
const UA = { 'User-Agent': 'Mozilla/5.0', Accept: 'application/vnd.github+json' };
const t = () => new Date().toISOString().slice(11, 19) + 'Z';

async function runs(event) {
  const q = event ? `?event=${event}&per_page=20` : '?per_page=20';
  const r = await fetch('https://api.github.com/repos/fjt272033067/lpl-tv/actions/runs' + q, {
    headers: UA,
    signal: AbortSignal.timeout(15000),
  });
  if (!r.ok) return { err: r.status };
  const j = await r.json();
  return {
    total: j.total_count,
    list: (j.workflow_runs || []).map((x) => `${x.name}/${x.event}/${x.conclusion}@${x.created_at}`),
  };
}

let lastKey = '';
while (Date.now() < END) {
  const all = await runs();
  const sched = await runs('schedule');
  const key = JSON.stringify([all.total, sched.total]);
  if (key !== lastKey) {
    console.log(`[${t()}] 全部 run=${all.total}  schedule run=${sched.total}`);
    (sched.list || []).slice(0, 5).forEach((x) => console.log('    ' + x));
    (all.list || []).slice(0, 3).forEach((x) => console.log('    · ' + x));
    lastKey = key;
  }
  await new Promise((r) => setTimeout(r, 60000));
}
console.log(`[${t()}] 观察结束`);
