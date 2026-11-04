/* =====================================================================
 * scrub-danmaku.mjs — 数据层合规清洗（词表唯一来源：site/assets/abuse-words.js）
 *
 * 为什么需要它（实测 2026-11-04）：
 *   bake.mjs 命中「缓存短路」时（site/data/dm/{cid}.json 已存在）直接 continue，
 *   既不重抓、**也不过滤**。而这些文件是 2026-10-25 / 10-29 写的，
 *   早于 11-02 才加上的屏蔽词表 → 原始谩骂文本永久留在公开数据文件里。
 *   CI 每 20 分钟把 site/data 推回公开仓库 → 审核爬虫每天都还能抓到原文
 *   → 站点被反复判「信息不合规 / 内容撤回」。
 *
 *   运行时的过滤（site/assets/app.js）只保护 DOM，**保护不了数据文件本身**：
 *   仓库公开、JSON 可批量下载，直连 raw.githubusercontent.com 就能看到原文。
 *
 * 用法：
 *   node tools/scrub-danmaku.mjs          清洗并写回
 *   node tools/scrub-danmaku.mjs --check  只检查，命中则 exit 1（CI 门禁用）
 *
 * 清洗规则：
 *   · 弹幕条目（数组且最后一个元素是文本）命中屏蔽词 → **整条丢弃**，并同步 count
 *   · 其它字符串字段（标题等）命中屏蔽词 → 打码成等长 '*'
 *   · 命中判定完全复用 abuse-words.mjs 的 hasAbuse()（ASCII 短词按词边界）
 * ===================================================================== */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ABUSE_WORDS, hasAbuse } from './abuse-words.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
export const DATA_DIR = path.join(ROOT, 'site', 'data');

// 与 abuse-words.mjs 同一套匹配规则：纯 ASCII 短词按**词边界**，其余按子串
const EXACT = [];
const BOUNDED = [];
for (const w of ABUSE_WORDS) {
  const n = String(w).toLowerCase();
  if (!n) continue;
  const escaped = n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  if (/^[a-z]{2,4}$/.test(n)) BOUNDED.push(new RegExp('(?<![a-z0-9])' + escaped + '(?![a-z0-9])', 'gi'));
  else EXACT.push(new RegExp(escaped, 'gi'));
}

/** 把命中的屏蔽词打码（等长 '*'），用于不能整条删掉的字段（如标题） */
export function maskAbuse(text) {
  let out = String(text ?? '');
  for (const re of EXACT) out = out.replace(re, (m) => '*'.repeat(m.length));
  for (const re of BOUNDED) out = out.replace(re, (m) => '*'.repeat(m.length));
  return out;
}

/**
 * 递归清洗一个 JSON 值：
 *   · 弹幕条目（元素是数组、末位是字符串）命中 → 整条丢弃
 *   · 其它字符串命中 → 打码
 * 返回 { value, changed, dropped }
 */
function scrubValue(v, state) {
  if (typeof v === 'string') {
    if (!hasAbuse(v)) return v;
    state.masked++;
    return maskAbuse(v);
  }
  if (Array.isArray(v)) {
    const out = [];
    for (const item of v) {
      const isDanmaku =
        Array.isArray(item) && item.length > 0 && typeof item[item.length - 1] === 'string';
      if (isDanmaku && hasAbuse(item[item.length - 1])) {
        state.dropped++;
        continue;
      }
      out.push(scrubValue(item, state));
    }
    return out;
  }
  if (v && typeof v === 'object') {
    const out = {};
    for (const [k, val] of Object.entries(v)) out[k] = scrubValue(val, state);
    return out;
  }
  return v;
}

/** 清洗单个 JSON 文件 */
export function scrubJsonFile(file, apply = true) {
  const rel = path.relative(ROOT, file);
  let obj;
  try {
    obj = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    return { file: rel, error: String((e && e.message) || e) };
  }
  const state = { dropped: 0, masked: 0 };
  const next = scrubValue(obj, state);
  const changed = state.dropped > 0 || state.masked > 0;
  if (!changed) return { file: rel, changed: false, dropped: 0, masked: 0 };

  // count 是弹幕条数，删条目后必须同步，否则页面显示的条数会虚高
  if (next && typeof next === 'object' && Array.isArray(next.items) && typeof next.count === 'number') {
    next.count = next.items.length;
  }
  if (apply) fs.writeFileSync(file, JSON.stringify(next));
  return { file: rel, changed: true, dropped: state.dropped, masked: state.masked };
}

/** 递归清洗一个数据目录下的所有 .json */
export function scrubDataDir(dir = DATA_DIR, apply = true) {
  const summary = { dir, files: 0, filesChanged: 0, dropped: 0, masked: 0, errors: [], offenders: [] };
  const walk = (d) => {
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, entry.name);
      if (entry.isDirectory()) {
        walk(p);
        continue;
      }
      if (!entry.name.endsWith('.json')) continue;
      summary.files++;
      const r = scrubJsonFile(p, apply);
      if (r.error) {
        summary.errors.push(r);
        continue;
      }
      if (r.changed) {
        summary.filesChanged++;
        summary.dropped += r.dropped;
        summary.masked += r.masked;
        summary.offenders.push(r);
      }
    }
  };
  if (fs.existsSync(dir)) walk(dir);
  return summary;
}

/* ---------------- CLI ---------------- */
const isMain = (process.argv[1] || '').replace(/\\/g, '/').endsWith('scrub-danmaku.mjs');
if (isMain) {
  const check = process.argv.includes('--check');
  const s = scrubDataDir(DATA_DIR, !check);
  console.log(
    `[scrub] 扫描 ${s.files} 个 JSON，命中文件 ${s.filesChanged} 个，丢弃弹幕 ${s.dropped} 条，打码 ${s.masked} 处`
  );
  if (s.offenders.length) {
    for (const o of s.offenders.slice(0, 12)) {
      console.log(`   ${o.file}  丢弃 ${o.dropped} 条 / 打码 ${o.masked} 处`);
    }
    if (s.offenders.length > 12) console.log(`   …另有 ${s.offenders.length - 12} 个文件`);
  }
  for (const e of s.errors) console.log(`   ! 解析失败 ${e.file}: ${e.error}`);
  if (check && s.offenders.length) {
    console.error('[scrub] 数据层仍含屏蔽词原文，合规门禁不通过');
    process.exit(1);
  }
  if (!check && s.filesChanged) console.log('[scrub] 已清洗并写回');
}
