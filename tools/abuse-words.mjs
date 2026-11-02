/* =====================================================================
 * abuse-words.mjs — Node 侧读取弹幕屏蔽词表
 *
 * 唯一来源是 site/assets/abuse-words.js（浏览器也引同一份），
 * 这里只负责把它读出来给烘焙流水线用 → 两边永远不会不同步。
 *
 * ⚠️ 匹配规则必须与 site/assets/danmaku.js 的 _blocked() 一致：
 *    纯 ASCII 的短词（tm / nm / sb）按**词边界**匹配，
 *    否则会误伤 "letme"（LPL 选手）、"TMWBG"（队名缩写）。
 * ===================================================================== */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(__dirname, '..', 'site', 'assets', 'abuse-words.js');

function load() {
  const src = fs.readFileSync(SRC, 'utf8');
  const m = src.match(/\[[\s\S]*?\]/);
  if (!m) throw new Error('abuse-words.js 里没找到词表数组');
  // 词表是 JS 字面量（单引号 + 尾逗号 + 可能的整行注释），先转成 JSON 语法再 parse；
  // 如果有人改成双引号写法，这里也能正常解析。
  const jsonish = m[0]
    .replace(/^\s*\/\/[^\n]*$/gm, '')
    .replace(/'([^'\\]*)'/g, '"$1"')
    .replace(/,(\s*])/g, '$1');
  return JSON.parse(jsonish);
}

/** 弹幕粗俗/谩骂词表 */
export const ABUSE_WORDS = load();

const EXACT = [];
const BOUNDED = [];
for (const w of ABUSE_WORDS) {
  const n = String(w).toLowerCase();
  if (/^[a-z]{2,4}$/.test(n)) BOUNDED.push(new RegExp('(?<![a-z0-9])' + n + '(?![a-z0-9])', 'g'));
  else EXACT.push(n);
}

/** 这条文本是否命中屏蔽词（命中 → 整条弹幕不显示 / 不落盘） */
export function hasAbuse(text) {
  const t = String(text || '').toLowerCase();
  if (!t) return false;
  for (const n of EXACT) {
    if (t.indexOf(n) !== -1) return true;
  }
  for (const re of BOUNDED) {
    re.lastIndex = 0;
    if (re.test(t)) return true;
  }
  return false;
}
