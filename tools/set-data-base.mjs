/* =====================================================================
 * set-data-base.mjs — 设置站点的「远端数据源」基址
 *
 * 为什么需要它：赛程 / 录像目录 / B 站直播流地址这三份数据，上游接口都没有跨域头
 * （腾讯全量对阵表是裸 JSON、B 站流地址接口不给 ACAO 且 JSONP 被 ORB 拦死），
 * 浏览器运行时读不到，只能构建期抓。所以数据必须有一个「会自己跑」的构建环境
 * 才能持续更新 —— 桌面手动烘焙不算。
 *
 * 站点侧已经准备好了远端数据源：它把本地烘焙快照与远端两份都读回来，
 * 按 updatedAt 取更新的那份。于是 CI 每次重建只要把 site/data 提交到公开仓库，
 * 站点就能自动拿到新数据，**不必重新部署站点本身**。
 *
 * 用法：
 *   node tools/set-data-base.mjs https://cdn.jsdelivr.net/gh/<owner>/<repo>@main/site/data
 *   node tools/set-data-base.mjs            # 不带参数 = 关闭远端数据源（回到纯本地快照）
 * ===================================================================== */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const INDEX = path.join(ROOT, 'site', 'index.html');

const arg = (process.argv[2] || '').trim().replace(/\/+$/, '');
const html = fs.readFileSync(INDEX, 'utf8');

const re = /<meta\s+name="lpl-tv-data-base"\s+content="([^"]*)"\s*\/?>/;
if (!re.test(html)) {
  console.error('index.html 里找不到 <meta name="lpl-tv-data-base">，无法设置。');
  process.exit(1);
}

const current = (html.match(re) || [])[1] || '';
if (current === arg) {
  console.log('远端数据源未变化：' + (arg || '(未配置)'));
  process.exit(0);
}

const next = html.replace(re, `<meta name="lpl-tv-data-base" content="${arg}" />`);
fs.writeFileSync(INDEX, next, 'utf8');
console.log('远端数据源：' + (current || '(未配置)') + '  ->  ' + (arg || '(未配置)'));
console.log('提醒：改完要重新部署 site/ 目录，线上才会生效（数据之后就不用再部署了）。');
