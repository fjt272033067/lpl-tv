/* =====================================================================
 * audit-publish.mjs — 公开仓库前的全量风险审计
 *
 * 要审两件事（两者都会被公开）：
 *   ① 工作树里的全部文件
 *   ② **完整的 git 历史**（旧提交里的东西一样会被公开，事后改代码也擦不掉）
 *
 * 输出：凭据、个人信息、第三方内容的规模与命中位置。
 * ===================================================================== */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { validCnId, validLuhn } from './sanitize-danmaku.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(p, 'utf8');

const RULES = [
  ['GitHub PAT', /gh[pousr]_[A-Za-z0-9]{20,}/g],
  ['fine-grained PAT', /github_pat_[A-Za-z0-9_]{20,}/g],
  ['AWS 密钥', /AKIA[0-9A-Z]{16}/g],
  ['Google API Key', /AIza[0-9A-Za-z\-_]{30,}/g],
  ['私有钥块', /-----BEGIN [A-Z ]*PRIVATE KEY-----/g],
  ['Bearer 令牌', /Bearer\s+[A-Za-z0-9._\-]{24,}/g],
  ['Authorization 头', /authorization"?\s*[:=]\s*"?[A-Za-z0-9._\-]{20,}/gi],
  ['cookie', /SESSDATA\s*=\s*[A-Za-z0-9%]{20,}|bili_jct\s*=\s*[A-Za-z0-9%]{20,}/g],
  ['access_token 赋值', /access[_-]?token"?\s*[:=]\s*"?[A-Za-z0-9._\-]{20,}/gi],
  ['api key 赋值', /api[_-]?key"?\s*[:=]\s*"?[A-Za-z0-9]{16,}/gi],
  ['密码赋值', /pass(word|wd)"?\s*[:=]\s*"?[^"\s]{6,}/gi],
  ['手机号', /(?<!\d)1[3-9]\d{9}(?!\d)/g],
  ['邮箱', /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g],
  ['身份证号', /(?<!\d)\d{17}[\dXx](?!\d)/g],
  ['银行卡号', /(?<!\d)\d{16,19}(?!\d)/g],
  ['QQ 号', /(QQ|qq|扣扣|企鹅)\s*[:：]?\s*\d{5,12}/g],
];

const TEXT_EXT = new Set(['.js', '.mjs', '.json', '.md', '.html', '.css', '.yml', '.yaml', '.txt', '.gitignore', '.lock']);

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name === '.git') continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

// ① 工作树：**只扫 git 跟踪的文件**（= 真正会被公开的那些）
//    被 .gitignore 忽略的本地探针产物不算。
const tracked = execFileSync('git', ['-C', ROOT, 'ls-files']).toString().trim().split('\n');
const files = tracked.map((rel) => path.join(ROOT, rel)).filter((p) => fs.existsSync(p));
const findings = [];
for (const f of files) {
  const ext = path.extname(f).toLowerCase();
  if (!TEXT_EXT.has(ext)) continue;
  const size = fs.statSync(f).size;
  if (size > 30 * 1024 * 1024) continue; // 弹幕大文件单独扫
  const text = read(f);
  for (const [name, re] of RULES) {
    // 身份证/银行卡用带校验位的判定，避免把「666666666666」这类字符画误报
    if (name === '身份证号') {
      const hits = (text.match(re) || []).filter((h) => validCnId(h));
      if (hits.length) findings.push({ where: path.relative(ROOT, f), rule: name, count: hits.length, sample: [...new Set(hits)].slice(0, 3) });
      continue;
    }
    if (name === '银行卡号') {
      const hits = (text.match(re) || []).filter((h) => validLuhn(h));
      if (hits.length) findings.push({ where: path.relative(ROOT, f), rule: name, count: hits.length, sample: [...new Set(hits)].slice(0, 3) });
      continue;
    }
    re.lastIndex = 0;
    const hits = text.match(re);
    if (hits) {
      const uniq = [...new Set(hits)].slice(0, 3);
      findings.push({ where: path.relative(ROOT, f), rule: name, count: hits.length, sample: uniq });
    }
  }
}

// ② 弹幕文件（内容多，单独扫并统计规模）
const dmDir = path.join(ROOT, 'site', 'data', 'dm');
let dmFiles = 0;
let dmComments = 0;
const dmHits = new Map();
if (fs.existsSync(dmDir)) {
  for (const f of fs.readdirSync(dmDir).filter((x) => x.endsWith('.json'))) {
    dmFiles++;
    const j = JSON.parse(read(path.join(dmDir, f)));
    for (const it of j.items || []) {
      dmComments++;
      const t = Array.isArray(it) ? String(it[it.length - 1] || '') : String(it.text || '');
      for (const [name, re] of RULES) {
        re.lastIndex = 0;
        const m = re.exec(t);
        if (!m) continue;
        // 与脱敏器同一套判定：身份证过校验位、银行卡过 Luhn，其余原样
        if (name === '身份证号' && !validCnId(m[0])) continue;
        if (name === '银行卡号' && !validLuhn(m[0])) continue;
        if (!dmHits.has(name)) dmHits.set(name, []);
        if (dmHits.get(name).length < 12) dmHits.get(name).push({ file: f, text: t.slice(0, 60) });
      }
    }
  }
}

// ③ git 历史里的凭据（同样会被公开）
let historyFindings = [];
try {
  const patch = execFileSync('git', ['-C', ROOT, 'log', '-p', '--all'], { maxBuffer: 1024 * 1024 * 1024 }).toString();
  for (const [name, re] of RULES) {
    if (!/PAT|密钥|Key|令牌|token|cookie|授权|密码|pass/i.test(name)) continue;
    re.lastIndex = 0;
    const hits = patch.match(re);
    if (hits) historyFindings.push({ rule: name, count: hits.length, sample: [...new Set(hits)].slice(0, 2) });
  }
} catch (e) {
  historyFindings.push({ rule: '（历史扫描失败）', error: e.message });
}

console.log('=== 工作树命中 ===');
if (!findings.length) console.log('  （无）');
for (const f of findings) console.log(`  ${f.where}  [${f.rule}] x${f.count}  ${JSON.stringify(f.sample)}`);

console.log('\n=== 弹幕语料 ===');
console.log(`  文件 ${dmFiles} 个 / 评论 ${dmComments} 条`);
if (!dmHits.size) console.log('  个人信息规则命中：（无）');
for (const [rule, list] of dmHits) {
  console.log(`  [${rule}] ${list.length}${list.length >= 12 ? '+' : ''} 条，例如：`);
  for (const h of list.slice(0, 5)) console.log(`     ${h.file}  ${h.text}`);
}

console.log('\n=== git 历史里的凭据 ===');
if (!historyFindings.length) console.log('  （无）');
for (const f of historyFindings) console.log(`  [${f.rule}] x${f.count || ''} ${JSON.stringify(f.sample || f.error || '')}`);

// ④ 即将公开的清单规模
let total = 0;
const byType = {};
for (const rel of tracked) {
  const p = path.join(ROOT, rel);
  const s = fs.existsSync(p) ? fs.statSync(p).size : 0;
  total += s;
  const k = rel.startsWith('site/data/dm/')
    ? '弹幕语料'
    : rel.startsWith('site/data/cover/')
    ? '直播封面帧'
    : rel.startsWith('site/data/')
    ? '赛程/目录数据'
    : rel.startsWith('site/')
    ? '站点代码与资源'
    : rel.startsWith('tools/')
    ? '构建与探针脚本'
    : '其它';
  byType[k] = byType[k] || { n: 0, bytes: 0 };
  byType[k].n++;
  byType[k].bytes += s;
}
console.log('\n=== 将要公开的内容清单 ===');
for (const k in byType)
  console.log(`  ${k}: ${byType[k].n} 个文件, ${(byType[k].bytes / 1024 / 1024).toFixed(2)} MB`);
console.log(`  合计 ${tracked.length} 个文件, ${(total / 1024 / 1024).toFixed(2)} MB`);
