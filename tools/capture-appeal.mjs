/* =====================================================================
 * capture-appeal.mjs — 抓取申诉用证明截图
 *
 * 用途：云服务商把网址标成「违规链接」后，人工申诉要上传「相关证明图片」。
 * 这里是自动生成 4 张：
 *   01-直播页 / 02-赛程页 / 03-录像库 / 04-归属权校验文件
 *
 * 用法：node tools/capture-appeal.mjs [站点地址]
 * 默认无头（不弹浏览器窗口）；HEADED=1 可开有头。
 * ===================================================================== */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolvePlaywright } from './resolve-playwright.mjs';

const { chromium } = resolvePlaywright().pw;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(__dirname, '..', 'docs', '申诉材料');
fs.mkdirSync(OUT, { recursive: true });

const SITE = (process.argv[2] || 'https://4kf9kfxujfhg2.space.mcode.cn').replace(/\/+$/, '');
const VERIFY_FILE = '669fcdc4f936334c18d1e91cc2db1a13.txt';
const VERIFY_TOKEN = '172fcace09575cc753438c49d1857c5c497aab93';

const browser = await chromium.launch({
  headless: process.env.HEADED !== '1',
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required', '--mute-audio', '--window-size=1440,900'],
});
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();

const shots = [
  { hash: '#/live', file: '01-直播页.png', wait: 9000 },
  { hash: '#/schedule', file: '02-赛程页.png', wait: 9000 },
  { hash: '#/vod', file: '03-录像库.png', wait: 9000 },
];

for (const s of shots) {
  // ⚠️ 绕缓存参数必须放在 hash **之前**：写成 `/#/live?t=1` 时 `?t=1` 会被
  // 解析进 hash，路由匹配不到 `#/live`，页面全部退回默认视图（截图会全一样）。
  await page.goto(`${SITE}/?t=${Date.now()}${s.hash}`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(s.wait);
  const p = path.join(OUT, s.file);
  await page.screenshot({ path: p });
  const where = await page.evaluate(() => location.hash);
  console.log('已抓取 ' + s.file + '  (hash=' + where + ')');
}

// 归属权校验文件：把纯文本渲染成一张可读的图（截图纯文本页面在浏览器里就是白底黑字）
await page.goto(`${SITE}/${VERIFY_FILE}?t=${Date.now()}`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1500);
const body = (await page.evaluate(() => document.body.innerText || '')).trim();
console.log('校验文件返回内容：' + body);
const p4 = path.join(OUT, '04-归属权校验文件.png');
await page.screenshot({ path: p4 });
console.log('已抓取 04-归属权校验文件.png');

await browser.close();
console.log('\n输出目录：' + OUT);
console.log('校验内容一致：' + (body === VERIFY_TOKEN ? '是' : '否（实际=' + body + '）'));
