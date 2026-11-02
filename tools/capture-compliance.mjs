/* =====================================================================
 * capture-compliance.mjs — 抓「整改证据」截图
 *
 * 两张：
 *   06a-弹幕正常渲染.png   播放页（弹幕正常，无谩骂词）
 *   06b-页脚合规声明.png   滚动到页脚（内容合规声明）
 * 用法：node tools/capture-compliance.mjs [站点地址]
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

const browser = await chromium.launch({
  headless: process.env.HEADED !== '1',
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required', '--mute-audio'],
});
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();

// ① 录像页：弹幕正常渲染
await page.goto(`${SITE}/#/watch/u4102m15w3z`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(9000);
await page.evaluate(async () => {
  const v = document.querySelector('.player video');
  if (v) v.currentTime = 480;
});
await page.waitForTimeout(4000);
await page.screenshot({ path: path.join(OUT, '06a-弹幕正常渲染.png') });
console.log('已抓 06a-弹幕正常渲染.png');

// ② 滚到页脚：内容合规声明
await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
await page.waitForTimeout(1200);
await page.screenshot({ path: path.join(OUT, '06b-页脚合规声明.png') });
console.log('已抓 06b-页脚合规声明.png');

// 顺手确认微信提示条确实不存在
const state = await page.evaluate(() => ({
  wxTip: !!document.querySelector('#wx-tip'),
  words: Array.isArray(window.__LPLTV_ABUSE_WORDS) ? window.__LPLTV_ABUSE_WORDS.length : 0,
  jump: /在浏览器打开|改用浏览器|点右上角/.test(document.body.innerText || ''),
  foot: /内容合规|敏感词过滤/.test(document.body.innerText || ''),
}));
console.log('合规状态：' + JSON.stringify(state));

await browser.close();
