/* =====================================================================
 * dispatch-refresh.mjs —— 手动 / 外部调度器触发一次数据刷新
 *
 * 为什么需要它：GitHub 自带的 `schedule` 触发器是 **best-effort** 的，
 * 公开仓库尤其容易出现「workflow 是 active、push 触发器照常跑，
 * 但 event=schedule 的 run 一条都没有」的情况（实测 2026-10-30：
 * 本仓库连过 5 个 20 分钟槽位，schedule run 仍然是 0）。
 *
 * 稳妥做法是留一条**外部调度通道**：任意能定时发 HTTP 请求的服务
 * （uptime-kuma / cron-job.org / 一台小 VPS 的 crontab），
 * 带着一个 fine-grained PAT 打 GitHub 的 dispatch 接口。
 *
 * 用法：
 *   $env:GITHUB_TOKEN = 'github_pat_xxx'
 *   node tools/dispatch-refresh.mjs
 *
 * 外部调度器要打的那条请求（服务里填这个 URL + Header 即可）：
 *   POST https://api.github.com/repos/fjt272033067/lpl-tv/actions/workflows/refresh-data.yml/dispatches
 *   Authorization: Bearer <你的 fine-grained PAT>
 *   Content-Type: application/json
 *   {"ref":"main"}
 *
 * PAT 权限（fine-grained，最小集）：
 *   · Actions: Read and write   —— 触发 workflow_dispatch
 *   （若改用 repository_dispatch 接口，则需要 Contents: Read and write）
 *   · 仓库范围只勾 fjt272033067/lpl-tv 这一个
 * ===================================================================== */
const OWNER = 'fjt272033067';
const REPO = 'lpl-tv';
const WORKFLOW = 'refresh-data.yml';

const token = (process.env.GITHUB_TOKEN || process.env.GH_TOKEN || '').trim();
if (!token) {
  console.error('缺少 GITHUB_TOKEN 环境变量。');
  console.error('  PowerShell: $env:GITHUB_TOKEN = "github_pat_xxx"');
  console.error('  bash:       GITHUB_TOKEN=github_pat_xxx node tools/dispatch-refresh.mjs');
  process.exit(2);
}

const url = `https://api.github.com/repos/${OWNER}/${REPO}/actions/workflows/${WORKFLOW}/dispatches`;
const body = JSON.stringify({ ref: 'main', inputs: { vods: process.env.VODS || '160' } });

try {
  const r = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'Content-Type': 'application/json',
      'User-Agent': 'lpl-tv-dispatch',
    },
    body,
    signal: AbortSignal.timeout(20000),
  });
  if (r.status === 204) {
    console.log('已触发 refresh-data 工作流（HTTP 204）。去 Actions 页看 run：');
    console.log(`  https://github.com/${OWNER}/${REPO}/actions/workflows/${WORKFLOW}`);
  } else {
    const t = await r.text();
    console.error(`触发失败：HTTP ${r.status}`);
    console.error(t.slice(0, 600));
    process.exit(1);
  }
} catch (e) {
  console.error('触发失败：' + (e && e.message ? e.message : String(e)));
  process.exit(1);
}
