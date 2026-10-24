// Probe v48: 找「可运行时加载」的腾讯最新录像数据源（var 赋值格式）
import { execFileSync } from 'node:child_process';
import zlib from 'node:zlib';

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
function curlBuf(url, headers = []) {
  const args = ['-s', '--max-time', '20', '-A', UA];
  headers.forEach((h) => args.push('-H', h));
  args.push(url);
  try {
    return execFileSync('curl.exe', args, { encoding: 'buffer', maxBuffer: 32 * 1024 * 1024, windowsHide: true });
  } catch (e) { return Buffer.alloc(0); }
}
function decode(buf) {
  if (!buf || !buf.length) return '';
  if (buf[0] === 0x1f && buf[1] === 0x8b) { try { return zlib.gunzipSync(buf).toString('utf8'); } catch {} }
  if (buf[0] === 0x78) { try { return zlib.inflateSync(buf).toString('utf8'); } catch {} }
  try { return zlib.brotliDecompressSync(buf).toString('utf8'); } catch {}
  try { return zlib.inflateRawSync(buf).toString('utf8'); } catch {}
  return buf.toString('utf8');
}

const idx = decode(curlBuf('https://lpl.qq.com/web202301/js/index.js'));
const i = idx.indexOf('subnavConfigArr');
console.log('=== subnavConfigArr 片段 ===');
console.log(idx.slice(i - 60, i + 700).replace(/\s+/g, ' '));

// 所有可能的 id
const ids = [...new Set([...idx.matchAll(/["']?(\d{2,4})["']?\s*:\s*\{\s*iSecond/g)].map((m) => m[1]))];
console.log('\n候选 id: ' + ids.join(', '));

console.log('\n=== 探测 LATEST_VIDEOS 各变体 ===');
const names = new Set();
ids.forEach((id) => {
  names.add(`LOL_MATCH2_NEWS_HOMEPAGE_LATEST_VIDEOS_LIST_0_${id}.js`);
  names.add(`LOL_MATCH2_NEWS_HOMEPAGE_LATEST_VIDEOS_LIST_${id}_20.js`);
});
names.add('LOL_MATCH2_NEWS_HOMEPAGE_LATEST_VIDEOS_LIST_0_20.js');
names.add('LOL_MATCH2_NEWS_HOMEPAGE_LATEST_VIDEOS_LIST_20_20.js');

let found = 0;
for (const n of names) {
  const raw = decode(curlBuf('https://lpl.qq.com/web201612/data/' + n));
  if (!raw || raw.length < 400) continue;
  const isVar = /^var\s+[A-Za-z_$][\w$]*\s*=/.test(raw.trim());
  const vid = /sVID/.test(raw);
  const round = /全场回顾|巅峰时刻/.test(raw);
  if (isVar) {
    found++;
    console.log(`  ★VAR  ${n}  len=${raw.length} sVID=${vid} 全场回顾=${round}`);
    console.log(`        ${raw.slice(0, 120).replace(/\s+/g, ' ')}`);
  } else if (vid && round) {
    console.log(`   raw  ${n}  len=${raw.length}（裸 JSON，不能 <script> 加载）`);
  }
}
console.log(`\n可 var 加载的文件数: ${found}`);

// 另外：官方内容接口能否拿到「全场回顾」类条目（其它 authorid / type）
console.log('\n=== 官方内容接口：找含「回放/全场回顾」的账号或类型 ===');
for (const q of [
  'type=1&page=1&num=40&r1=authorid&authorid=288',
  'type=1&page=1&num=40&r1=authorid&authorid=288&tagIds=1280',
  'type=4&page=1&num=40&r1=authorid&authorid=288',
  'type=1&page=1&num=40&r1=authorid&authorid=225',
  'type=1&page=1&num=40&r1=authorid&authorid=226',
]) {
  const raw = decode(
    curlBuf(`https://apps.game.qq.com/cmc/zmMcnAuthorContentList?${q}&source=web_pc`, ['Referer: https://lpl.qq.com/'])
  );
  const body = raw.replace(/^var authorid=/, '').replace(/;\s*$/, '');
  let j = null;
  try { j = JSON.parse(body); } catch {}
  const res = (j && j.data && j.data.result) || [];
  const replay = res.filter((x) => /回放|全场回顾|录像/.test(x.sTitle || ''));
  console.log(`  ${q.slice(0, 62).padEnd(64)} -> ${res.length} 条，含录像类 ${replay.length} 条`);
  if (res[0]) console.log(`      首条 ${res[0].sCreated} ${res[0].sTitle}`);
}
