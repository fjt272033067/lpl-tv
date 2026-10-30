/* =====================================================================
 * check-render-races.mjs — 静态检查：渲染函数里「清空 view 之后还有没有 await」
 *
 * 为什么需要它：
 *   渲染流程是「先 view.innerHTML = '' 清空，再逐块回填」。
 *   如果清空和回填之间隔着 await，两个并发渲染（远端数据到位触发自动重绘、
 *   用户快速切页）就会交错 —— 旧渲染晚到，在新渲染后面又追加一份，
 *   页面上就出现重复内容（实测：赛程页出现两份赛程）。
 *
 * 判据：清空之后若还有 await，就报出来。
 *   · 已经在 view 上做「清空 + 挂载」两段式守卫的（直播页），不报 ——
 *     它把 append 收在离屏容器里，中间 await 不污染页面。
 *   · 真正需要「清空与回填原子」的（赛程页、录像库页），一旦有 await 就要报。
 *
 * 用法: node tools/check-render-races.mjs
 * 退出码: 0 = 没有风险；1 = 有风险（可直接挂进 CI）
 * ===================================================================== */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APP = path.resolve(__dirname, '..', 'site', 'assets', 'app.js');
const lines = fs.readFileSync(APP, 'utf8').split('\n');

// 这些页面把内容先建在离屏容器里、最后才挂到 view，
// 所以「清空之后有 await」是安全的 —— 只要挂载前有代次守卫。
const MOUNT_RE = /view\.appendChild\((hero|wrap)\)/;

const FNS = ['renderLive', 'renderVod', 'renderWatch', 'renderSchedule'];
let problems = 0;

for (const fn of FNS) {
  const start = lines.findIndex((l) => new RegExp(`async function ${fn}\\s*\\(`).test(l));
  if (start < 0) {
    console.log(`!! ${fn} 没找到`);
    problems++;
    continue;
  }
  let end = start;
  for (let i = start + 1; i < lines.length; i++) {
    if (/^ {2}\}\s*$/.test(lines[i])) {
      end = i;
      break;
    }
  }
  const body = lines.slice(start, end + 1);
  const clearIdx = body.findIndex((l) => /view\.innerHTML\s*=\s*''/.test(l));
  console.log(`\n=== ${fn}（第 ${start + 1} - ${end + 1} 行）===`);

  if (clearIdx < 0) {
    console.log('  没有 view.innerHTML = \'\' 的清空');
    continue;
  }
  const clearLine = start + clearIdx + 1;
  const after = [];
  for (let i = clearIdx + 1; i < body.length; i++) {
    if (/\bawait\b/.test(body[i])) after.push({ line: start + i + 1, text: body[i].trim() });
  }

  if (after.length === 0) {
    console.log('  ✅ 清空之后没有 await —— 清空与回填是原子的');
    continue;
  }

  // 有 await：只要「挂载到 view 之前有代次守卫」就安全 ——
  //   · await 期间构建的是离屏容器，不污染页面；
  //   · 过期渲染在挂载前被拦下，不会盖掉新渲染。
  const mountIdx = body.findIndex((l) => MOUNT_RE.test(l));
  const guardBeforeClear = body.slice(0, clearIdx).some((l) => /isStaleRender\(seq\)/.test(l));
  const guardBeforeMount =
    mountIdx > 0 && body.slice(0, mountIdx).some((l) => /isStaleRender\(seq\)/.test(l));

  if (mountIdx > 0 && guardBeforeMount && guardBeforeClear) {
    console.log('  ✅ 离屏构建 + 清空前与挂载前都有代次守卫（不会与并发渲染交错）');
    after.forEach((a) => console.log(`     （中途 await：${a.line}: ${a.text}）`));
    continue;
  }

  console.log(`  ⚠️ 第 ${clearLine} 行清空之后还有 await —— 并发渲染会交错，页面会留下重复内容：`);
  if (mountIdx < 0) console.log('     （并且找不到 view.appendChild(hero|wrap) 这个挂载点）');
  else if (!guardBeforeMount) console.log('     （挂载点前缺少 isStaleRender 守卫）');
  else if (!guardBeforeClear) console.log('     （清空前缺少 isStaleRender 守卫）');
  after.forEach((a) => console.log(`     ${a.line}: ${a.text}`));
  problems++;
}

console.log(problems ? `\n❌ 发现 ${problems} 处风险` : '\n✅ 未发现渲染竞态风险');
process.exit(problems ? 1 : 0);
