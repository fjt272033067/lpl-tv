/* =====================================================================
 * capture-covers.mjs — 为直播线路抓取预览缩略图
 *
 * 线路卡片原本是一块纯黑（只有一个小标签），访客完全看不出这路直播在播什么。
 * 做法：构建期用 ffmpeg 从直播流里截一帧存成 jpg，站点直接当卡片封面用。
 *   - 抓的是真实直播画面，所以缩略图内容 = 该路当前在播的内容
 *   - 流地址有效期约 60 分钟，抓帧必须在抓地址的同一轮里做
 *
 * 用法： node tools/capture-covers.mjs
 * ===================================================================== */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const DATA = path.join(ROOT, 'site', 'data');
const COVER_DIR = path.join(DATA, 'cover');

fs.mkdirSync(COVER_DIR, { recursive: true });

/** 找一个可用的 ffmpeg（PATH 里没有时试几个常见安装位置） */
function findFfmpeg() {
  const cands = [
    'ffmpeg',
    'C:\\Program Files\\ffmpeg\\bin\\ffmpeg.exe',
    'E:\\ffmpeg\\bin\\ffmpeg.exe',
    'C:\\ffmpeg\\bin\\ffmpeg.exe',
  ];
  const winGet = path.join(
    process.env.LOCALAPPDATA || '',
    'Microsoft',
    'WinGet',
    'Links',
    'ffmpeg.exe'
  );
  cands.push(winGet);
  for (const c of cands) {
    try {
      if (c === 'ffmpeg') {
        execFileSync('ffmpeg', ['-version'], { stdio: 'ignore', windowsHide: true });
        return 'ffmpeg';
      }
      if (fs.existsSync(c)) {
        execFileSync(c, ['-version'], { stdio: 'ignore', windowsHide: true });
        return c;
      }
    } catch (e) {
      /* try next */
    }
  }
  return null;
}

const FFMPEG = findFfmpeg();

/**
 * 给指定房间列表抓预览帧。
 * @param {Array} rooms 房间列表（需含 roomid 与 stream.flvUrl/url）
 * @param {string} outDir 输出目录
 * @returns {{ok:number, fail:number}}
 */
export function captureCovers(rooms, outDir) {
  if (!FFMPEG) {
    console.log('找不到 ffmpeg，跳过封面抓取（可安装后重跑：winget install Gyan.FFmpeg）');
    return { ok: 0, fail: 0 };
  }
  fs.mkdirSync(outDir, { recursive: true });
  let ok = 0;
  let fail = 0;
  for (const r of rooms) {
    if (!r.stream) continue;
    const src = r.stream.flvUrl || r.stream.url;
    if (!src) continue;
    const out = path.join(outDir, `${r.roomid}.jpg`);
    try {
      // HTTP-FLV 是长连接，ffmpeg 需要 -rw_timeout 才能自己放弃
      execFileSync(
        FFMPEG,
        [
          '-y',
          '-loglevel', 'error',
          '-rw_timeout', '15000000',
          '-i', src,
          '-frames:v', '1',
          '-vf', 'scale=640:-2',
          '-q:v', '5',
          '-f', 'image2',
          out,
        ],
        { stdio: 'ignore', windowsHide: true, timeout: 30000 }
      );
      if (fs.existsSync(out) && fs.statSync(out).size > 2000) {
        ok++;
        console.log(`  ✓ ${r.roomid}  ${(fs.statSync(out).size / 1024).toFixed(0)}KB  ${r.title || ''}`);
      } else {
        fail++;
        console.log(`  ✗ ${r.roomid}  抓帧输出异常`);
      }
    } catch (e) {
      fail++;
      console.log(`  ✗ ${r.roomid}  抓帧失败（${(e.message || '').split('\n')[0].slice(0, 60)}）`);
    }
  }
  console.log(`\n封面抓取完成：成功 ${ok} / 失败 ${fail}`);
  return { ok, fail };
}

/**
 * 抓腾讯 LPL 官方直播源的封面帧。
 * 腾讯源是 JSONP 可读的（Content-Type: text/html），运行时能直连，
 * 但流地址只有构建期才知道好在哪，所以封面也构建期抓。
 * @param {string} outDir
 * @returns {Object} {anchorId: 'data/cover/tx-<anchorId>.jpg'}
 */
export function captureTencentCovers(outDir) {
  if (!FFMPEG) return {};
  const map = {};
  let raw = '';
  try {
    raw = execFileSync(
      'curl.exe',
      [
        '-s',
        '--max-time', '25',
        '-A', 'Mozilla/5.0',
        '-H', 'Referer: https://lpl.qq.com/',
        'https://lol.sw.game.qq.com/lol/commact/?proj=a20200415livelink&c=a20200415livelink&a=getMatchScheduleList',
      ],
      { encoding: 'utf8', windowsHide: true }
    );
  } catch (e) {
    return {};
  }
  let j = null;
  try {
    // 腾讯不带 callback 时返回的是 `var J_SWOOLE = {...};` 形式，需要剥掉外壳
    const body = String(raw || '')
      .replace(/^\s*var\s+[A-Za-z_$][\w$]*\s*=\s*/, '')
      .replace(/;\s*$/, '');
    j = JSON.parse(body);
  } catch (e) {
    return {};
  }
  const list = (j && j.data && j.data.anchorList) || [];
  for (const a of list) {
    const anchorId = a && a.anchorInfo && a.anchorInfo.anchorId;
    const streams = (a && a.playInfo && a.playInfo.streamInfo) || [];
    if (!anchorId || !streams.length) continue;
    // 取码率最高的一档
    const best = streams.slice().sort((x, y) => (y.bitrate || 0) - (x.bitrate || 0))[0];
    const src = String(best.hlsUrl || '').replace(/^http:/, 'https:');
    if (!src) continue;
    const out = path.join(outDir, `tx-${anchorId}.jpg`);
    try {
      execFileSync(
        FFMPEG,
        [
          '-y', '-loglevel', 'error',
          '-rw_timeout', '25000000',
          '-i', src,
          '-frames:v', '1',
          '-vf', 'scale=640:-2',
          '-q:v', '5',
          '-f', 'image2',
          out,
        ],
        { stdio: 'ignore', windowsHide: true, timeout: 40000 }
      );
      if (fs.existsSync(out) && fs.statSync(out).size > 2000) {
        map[String(anchorId)] = 'data/cover/tx-' + anchorId + '.jpg';
        console.log(`  ✓ tx-${anchorId}  ${(fs.statSync(out).size / 1024).toFixed(0)}KB  ${(a.roomInfo || {}).roomTitle || ''}`);
      }
    } catch (e) {
      /* 该锚点没在播 / 流不可用，跳过 */
    }
  }
  return map;
}

// 直接运行时：从 liverooms.json 读房间列表
const isMain = (() => {
  try {
    return process.argv[1] && import.meta.url === new URL('file:///' + process.argv[1].replace(/\\/g, '/')).href;
  } catch (e) {
    return false;
  }
})();
if (isMain) {
  const livePath = path.join(DATA, 'liverooms.json');
  if (!fs.existsSync(livePath)) {
    console.log('缺少 liverooms.json，先跑 refresh-liverooms.mjs');
  } else {
    const j = JSON.parse(fs.readFileSync(livePath, 'utf8'));
    captureCovers((j.rooms || []).filter((r) => r.live && r.stream), COVER_DIR);
  }
}
