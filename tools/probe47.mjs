// Probe v47: 官方 event.html?tabId=progress 的真实渲染结构（照搬用）
import { resolvePlaywright } from './resolve-playwright.mjs';

const { chromium } = resolvePlaywright().pw;
const browser = await chromium.launch({
  headless: false,
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  args: ['--no-sandbox', '--window-size=1500,1000'],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto('https://lpl.qq.com/web202301/event.html?gameId=246&tabId=progress', {
  waitUntil: 'domcontentloaded',
});
await page.waitForTimeout(9000);

const info = await page.evaluate(() => {
  const pick = (sel, n) => [...document.querySelectorAll(sel)].slice(0, n || 4).map((e) => ({
    cls: e.className,
    text: (e.innerText || '').replace(/\s+/g, ' ').slice(0, 90),
    html: e.outerHTML.slice(0, 260),
  }));
  return {
    title: document.title,
    tabs: pick('.header-tab-item'),
    contentClasses: [...document.querySelectorAll('[class*="progress"],[class*="schedule"],[class*="group"]')]
      .slice(0, 18)
      .map((e) => e.className),
    groupList: pick('.group-item, .team-group-list, .group-name', 6),
    matchRows: pick('.match-row, .match-name-wrap', 4),
    teamBox: pick('.team-box, .team-list, .game-team', 3),
    bodyText: (document.body.innerText || '').replace(/\s+/g, ' ').slice(0, 700),
  };
});
console.log(JSON.stringify(info, null, 1).slice(0, 4200));
await page.screenshot({ path: 'data/ui-smoke/official-progress.png', fullPage: false });
await browser.close();
