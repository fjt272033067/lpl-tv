// Probe v34: GameList / TeamList 结构 —— 能否运行时取到最新录像 + 战队 logo
import { execFileSync } from 'node:child_process';
import zlib from 'node:zlib';

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
function curlBuf(url) {
  try {
    return execFileSync('curl.exe', ['-s', '--max-time', '30', '-A', UA, url], {
      encoding: 'buffer',
      maxBuffer: 64 * 1024 * 1024,
      windowsHide: true,
    });
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
function loadVar(url, name) {
  const raw = decode(curlBuf(url));
  const m = raw.match(/var\s+' + name + '|= *(\{[\s\S]*\})\s*;?\s*$/);
  const body = raw.replace(/^var\s+\w+\s*=\s*/, '').replace(/;\s*$/, '');
  try { return JSON.parse(body); } catch (e) { return null; }
}

console.log('=== A. GameList 结构 ===');
const g = loadVar('https://lpl.qq.com/web201612/data/LOL_MATCH2_GAME_LIST_BRIEF.js', 'GameList');
if (!g) console.log('  解析失败');
else {
  console.log('  top keys: ' + Object.keys(g).join(','));
  const bl = g.msg?.bGameList || [];
  console.log('  bGameList 条数: ' + bl.length);
  if (bl[0]) console.log('  首条字段: ' + Object.keys(bl[0]).join(','));
  // 找带 vid / VOD 的字段
  const withVid = bl.filter((x) => JSON.stringify(x).match(/[a-z0-9]{9,12}/i) && JSON.stringify(x).includes('V1') );
  console.log('  含疑似 vid 的条数: ' + withVid.length);
  // 打印最近几条的关键信息
  const pick = (x) => {
    const o = {};
    for (const k of Object.keys(x)) {
      if (/vid|video|Vid|Title|Name|Time|Date|Id|Url|Img|Pic|Cover/i.test(k)) o[k] = x[k];
    }
    return o;
  };
  bl.slice(0, 3).forEach((x) => console.log('   ' + JSON.stringify(pick(x)).slice(0, 400)));
  // 递归找 sVID
  let found = 0;
  const walk = (o, path, depth) => {
    if (depth > 4 || found > 4) return;
    if (Array.isArray(o)) return o.forEach((v, i) => walk(v, path + '[' + i + ']', depth + 1));
    if (o && typeof o === 'object') {
      for (const k of Object.keys(o)) {
        if (k === 'sVID' || k === 'sVid' || k === 'vid') {
          if (found < 4) console.log(`   >> ${path}.${k} = ${o[k]}  (邻居: ${Object.keys(o).slice(0, 8).join(',')})`);
          found++;
        }
        walk(o[k], path + '.' + k, depth + 1);
      }
    }
  };
  walk(bl, 'bGameList', 0);
  console.log('  递归找到的 vid 字段数: ' + found);
}

console.log('\n=== B. TeamList 结构（含 logo 吗）===');
const t = loadVar('https://lpl.qq.com/web201612/data/LOL_MATCH2_TEAM_LIST.js', 'TeamList');
if (!t) console.log('  解析失败');
else {
  const teams = t.msg || {};
  const keys = Object.keys(teams);
  console.log('  队伍数: ' + keys.length);
  const first = teams[keys[0]];
  console.log('  首条字段: ' + Object.keys(first).join(','));
  const sample = keys.slice(0, 3).map((k) => {
    const o = teams[k];
    return {
      id: k,
      name: o.TeamName || o.TeamShortName || o.sTeamName,
      short: o.TeamShortName,
      logo: o.TeamLogo || o.sTeamLogo || o.TeamIcon || o.sTeamIcon || o.LogoUrl,
    };
  });
  sample.forEach((s) => console.log('   ' + JSON.stringify(s)));
  // 找一个 LPL 队伍看看有没有 logo URL
  const withLogo = Object.values(teams).filter((o) => JSON.stringify(o).match(/https?:\/\/[^"']+\.(png|jpg|jpeg|webp)/i));
  console.log('  含图片 URL 的队伍数: ' + withLogo.length);
  if (withLogo[0]) console.log('   示例: ' + JSON.stringify(withLogo[0]).slice(0, 420));
}
