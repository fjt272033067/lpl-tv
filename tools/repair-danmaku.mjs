/* =====================================================================
 * repair-danmaku.mjs — 修补「有 cid 但缺弹幕文件」的条目
 * 用法： node tools/repair-danmaku.mjs
 * ===================================================================== */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA = path.resolve(__dirname, '..', 'site', 'data');
const DM_DIR = path.join(DATA, 'dm');
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function curlBuf(url, headers = []) {
  const args = ['-s', '--max-time', '25', '-A', UA];
  headers.forEach((h) => args.push('-H', h));
  args.push(url);
  try {
    // curl 的可执行名：Windows 是 curl.exe，Linux/macOS 是 curl
    const bin = process.platform === 'win32' ? 'curl.exe' : 'curl';
    return execFileSync(bin, args, { encoding: 'buffer', maxBuffer: 64 * 1024 * 1024, windowsHide: true });
  } catch (e) {
    return Buffer.alloc(0);
  }
}
function decode(buf) {
  if (!buf || !buf.length) return '';
  if (buf[0] === 0x1f && buf[1] === 0x8b) { try { return zlib.gunzipSync(buf).toString('utf8'); } catch {} }
  if (buf[0] === 0x78) { try { return zlib.inflateSync(buf).toString('utf8'); } catch {} }
  try { return zlib.brotliDecompressSync(buf).toString('utf8'); } catch {}
  try { return zlib.inflateRawSync(buf).toString('utf8'); } catch {}
  return buf.toString('utf8');
}
function parseDanmakuXml(xml) {
  const items = [];
  const re = /<d p="([^"]+)"[^>]*>([^<]*)<\/d>/g;
  let m;
  while ((m = re.exec(xml)) !== null) {
    const p = m[1].split(',');
    const text = m[2]
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'")
      .replace(/&amp;/g, '&');
    if (!text) continue;
    items.push([+p[0] || 0, +p[1] || 1, +p[3] || 16777215, +p[2] || 25, text]);
  }
  return items;
}

const catalogPath = path.join(DATA, 'catalog.json');
const catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf8'));
const missing = catalog.matches.filter((m) => m.cid && !fs.existsSync(path.join(DM_DIR, m.cid + '.json')));
console.log(`目录中 ${catalog.matches.length} 场，其中 ${missing.length} 场缺弹幕文件`);

let fixed = 0;
let stillEmpty = 0;
for (const m of missing) {
  const file = path.join(DM_DIR, m.cid + '.json');
  if (fs.existsSync(file)) continue;
  const xml = decode(curlBuf(`https://comment.bilibili.com/${m.cid}.xml`, [`Referer: https://www.bilibili.com/video/`]));
  const items = xml && xml.indexOf('<d p=') > -1 ? parseDanmakuXml(xml) : [];
  if (items.length) {
    fs.writeFileSync(
      file,
      JSON.stringify({ cid: m.cid, bvid: m.bvid, title: m.title, count: items.length, items })
    );
    m.dmCount = items.length;
    fixed++;
    console.log(`  ✓ ${m.cid}  ${m.bvid || ''}  ${items.length} 条  ${m.title}`);
  } else {
    // 确实没有弹幕（多为高光短片）→ 清掉 cid，避免 UI 误标「有弹幕」
    m.dmCount = 0;
    stillEmpty++;
    console.log(`  · ${m.cid}  ${m.bvid || ''}  无弹幕数据 → 标记为无弹幕`);
  }
  await sleep(400);
}

catalog.withDanmaku = catalog.matches.filter((m) => m.dmCount > 0).length;
catalog.updatedAt = new Date().toISOString();
fs.writeFileSync(catalogPath, JSON.stringify(catalog));
console.log(`\n修补完成：新增 ${fixed} 个弹幕文件，${stillEmpty} 场确认为无弹幕；当前有弹幕 ${catalog.withDanmaku} 场`);
