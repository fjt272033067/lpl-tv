/* =====================================================================
 * sanitize-danmaku.mjs — 弹幕文本脱敏
 *
 * 为什么要做：弹幕是 B 站用户评论的批量转载，其中偶尔混进真实的联系方式
 * （手机号/邮箱/QQ/身份证/银行卡）。站点本来就公开播放这些弹幕，
 * 但**仓库是公开且可批量下载的**，所以在落盘前先把明显的个人联系方式打码，
 * 避免把真人号码连同仓库一起公开。
 *
 * 判定要准：不能把「666666666666」「484848484848」这类弹幕里的字符画
 * 误当成银行卡/身份证去改写 —— 所以：
 *   · 身份证要过校验位
 *   · 银行卡要过 Luhn 校验
 *   · 手机号按 1[3-9] 开头且长度 11
 *   · 邮箱要像真邮箱（域名与 TLD 合法）
 *
 * 用法：
 *   node tools/sanitize-danmaku.mjs                 # 处理 site/data/dm/ 下全部文件
 *   node tools/sanitize-danmaku.mjs --dry           # 只报告不改
 * ===================================================================== */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DM_DIR = path.join(ROOT, 'site', 'data', 'dm');

/* ---------- 判定函数 ---------- */

/** 身份证末位校验（ISO 7064:1983 MOD 11-2） */
export function validCnId(id) {
  if (!/^\d{17}[\dXx]$/.test(id)) return false;
  const w = [7, 9, 10, 5, 8, 4, 2, 1, 6, 3, 7, 9, 10, 5, 8, 4, 2];
  const c = '10X98765432';
  let sum = 0;
  for (let i = 0; i < 17; i++) sum += Number(id[i]) * w[i];
  return c[sum % 11] === id[17].toUpperCase();
}

/** 银行卡 Luhn 校验 */
export function validLuhn(num) {
  if (!/^\d{16,19}$/.test(num)) return false;
  let sum = 0;
  let alt = false;
  for (let i = num.length - 1; i >= 0; i--) {
    let d = Number(num[i]);
    if (alt) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    alt = !alt;
  }
  return sum % 10 === 0;
}

/* ---------- 脱敏规则 ---------- */
const RULES = [
  // 手机号：整串换成占位（宁可多改也不要漏）
  {
    name: '手机号',
    re: /(?<![\d-])1[3-9]\d{9}(?![\d-])/g,
    valid: () => true,
    mask: () => '[手机号已屏蔽]',
  },
  // 邮箱：保留域名，遮住用户名
  {
    name: '邮箱',
    re: /\b([A-Za-z0-9._%+-]{2,})@([A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,6})\b/g,
    valid: (m) => !/[.]{2,}/.test(m),
    mask: (m) => {
      const at = m.indexOf('@');
      const local = m.slice(0, at);
      return local.slice(0, 1) + '***' + m.slice(at);
    },
  },
  // QQ 号
  {
    name: 'QQ号',
    re: /(QQ|qq|扣扣|企鹅)\s*[:：]?\s*(\d{5,12})/g,
    valid: (m) => {
      const digits = m.match(/\d{5,12}/);
      if (!digits) return false;
      const n = digits[0];
      // 全同数字（表情符号）不算
      if (/^(\d)\1+$/.test(n)) return false;
      return true;
    },
    mask: (m) => m.replace(/\d{5,12}/, (d) => d.slice(0, 2) + '***'),
  },
  // 身份证（要过校验位）
  {
    name: '身份证',
    re: /(?<![\dXx])\d{17}[\dXx](?![\dXx])/g,
    valid: (m) => validCnId(m),
    mask: () => '[身份证号已屏蔽]',
  },
  // 银行卡（要过 Luhn）
  {
    name: '银行卡',
    re: /(?<!\d)\d{16,19}(?!\d)/g,
    valid: (m) => validLuhn(m),
    mask: (m) => m.slice(0, 4) + '********' + m.slice(-4),
  },
];

/**
 * 对一段文本脱敏。
 * @returns {{text:string, hits:Array<{rule:string,from:string}>}}
 */
export function sanitizeText(text) {
  let out = String(text);
  const hits = [];
  for (const r of RULES) {
    r.re.lastIndex = 0;
    out = out.replace(r.re, (m) => {
      if (!r.valid(m)) return m;
      hits.push({ rule: r.name, from: m });
      return r.mask(m);
    });
  }
  return { text: out, hits };
}

/* ---------- 命令行：批量处理落盘的弹幕文件 ---------- */
if (process.argv[1] && process.argv[1].endsWith('sanitize-danmaku.mjs')) {
  const dry = process.argv.includes('--dry');
  if (!fs.existsSync(DM_DIR)) {
    console.log('没有弹幕目录，跳过');
    process.exit(0);
  }
  const files = fs.readdirSync(DM_DIR).filter((f) => f.endsWith('.json'));
  let changedFiles = 0;
  let changedItems = 0;
  const allHits = [];
  for (const f of files) {
    const p = path.join(DM_DIR, f);
    const j = JSON.parse(fs.readFileSync(p, 'utf8'));
    let dirty = false;
    for (const it of j.items || []) {
      if (!Array.isArray(it)) continue;
      const raw = String(it[it.length - 1] ?? '');
      const { text, hits } = sanitizeText(raw);
      if (hits.length) {
        dirty = true;
        changedItems++;
        allHits.push({ file: f, rule: hits.map((h) => h.rule).join(','), from: hits[0].from });
        it[it.length - 1] = text;
      }
    }
    if (dirty) {
      changedFiles++;
      if (!dry) fs.writeFileSync(p, JSON.stringify(j));
    }
  }
  console.log(`扫描 ${files.length} 个弹幕文件：命中 ${changedItems} 条，涉及 ${changedFiles} 个文件${dry ? '（dry-run，未写入）' : ''}`);
  for (const h of allHits.slice(0, 20)) console.log(`  ${h.file}  [${h.rule}]  ${h.from}`);
  if (allHits.length > 20) console.log(`  …还有 ${allHits.length - 20} 条`);
}
