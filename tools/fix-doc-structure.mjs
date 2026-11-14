/**
 * fix-doc-structure.mjs — 修 docs/新建仓库并推送.md 里被重复插入的 §11
 *
 * 问题：之前两次编辑把「总决赛跟赛页」章节插了两次，
 * 并且第一次插入把 §10「本机网络提醒」的正文顶掉了。
 *
 * 修法（按内容定位，不靠行号）：
 *   1. 找到第一处 "## 10. 本机网络提醒..." 与第二处 "## 11. 本机网络提醒..."，
 *      删掉这两者之间的全部内容（重复的跟赛页块 + 它的分隔线）；
 *   2. 把剩下的 "## 11. 本机网络提醒..." 改回 "## 10. ..."（它才是真正的 §10）。
 */
import fs from 'node:fs';

const FILE = 'E:/M3.1-Flash工作室/lpl-tv/docs/新建仓库并推送.md';
const lines = fs.readFileSync(FILE, 'utf8').split(/\r?\n/);

const H10 = '## 10. 本机网络提醒（内地电信 + Watt Toolkit）';
const H11NET = '## 11. 本机网络提醒（内地电信 + Watt Toolkit）';

const i10 = lines.indexOf(H10);
let i11net = -1;
for (let i = 0; i < lines.length; i++) {
  if (lines[i] === H11NET) {
    i11net = i;
    break;
  }
}
if (i10 < 0 || i11net < 0 || i11net < i10) {
  console.error('定位失败：i10=' + i10 + ' i11net=' + i11net);
  process.exit(1);
}
console.log('删除区间：第 ' + (i10 + 1) + ' ~ ' + i11net + ' 行（共 ' + (i11net - i10) + ' 行）');
console.log('被删的首行：' + lines[i10]);
console.log('被删的末行：' + lines[i11net - 1]);

const out = lines.slice(0, i10).concat(lines.slice(i11net));
// 把真正的 §10 标题从 11 改回 10
const j = out.indexOf(H11NET);
out[j] = H10;

fs.writeFileSync(FILE, out.join('\n'), 'utf8');
console.log('已修复。现在 §10/' + H10 + ' 出现次数 = ' + out.filter((l) => l === H10).length);
console.log('「总决赛跟赛页」章节数 = ' + out.filter((l) => l.indexOf('## 11. 总决赛跟赛页') === 0).length);
