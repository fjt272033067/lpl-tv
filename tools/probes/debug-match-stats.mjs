/**
 * debug-match-stats.mjs — 查清页面实算的模型输入与烘焙基线为何不一致
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolvePlaywright } from './resolve-playwright.mjs';

const { chromium } = resolvePlaywright().pw;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SITE = path.resolve(__dirname, '..', 'site');
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8' };

const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/') p = '/index.html';
  const file = path.join(SITE, p);
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end('404'); return; }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
  fs.createReadStream(file).pipe(res);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = 'http://127.0.0.1:' + server.address().port;

const browser = await chromium.launch({ headless: true, executablePath: CHROME, args: ['--no-sandbox', '--mute-audio'] });
const page = await browser.newPage();
await page.goto(base + '/final.html', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(9000);

const dump = await page.evaluate(() => {
  const S = window.__LPLTV_MATCH__.state;
  const fm = S.finalMatch;
  const dumpTeam = (st) => ({
    series: st.series,
    games: st.games,
    bo5: { w: st.bo5.w, l: st.bo5.l, played: st.bo5.played, gamesW: st.bo5.gamesW, gamesL: st.bo5.gamesL, sweeps: st.bo5.sweeps },
    seriesList: st.bo5.series,
  });
  // 本届赛事里两队全部场次
  const rows = S.matches.filter((m) => m.game === fm.game && (m.teamA === fm.teamA || m.teamB === fm.teamB));
  return {
    final: { game: fm.game, phase: fm.phase, mode: fm.mode, date: fm.date, teamA: fm.teamA, teamB: fm.teamB, score: fm.score, gameId: fm.gameId, bMatchId: fm.bMatchId },
    tournamentRows: rows.map((m) => `${m.date} ${m.mode} ${m.teamA} ${m.score} ${m.teamB} (${m.phase})`),
    a: dumpTeam(S.statsA),
    b: dumpTeam(S.statsB),
    model: { p: S.model.p, rA: S.model.rA, rB: S.model.rB, prior: S.model.prior },
    matchCount: S.matches.length,
    scheduleUpdatedAt: S.scheduleUpdatedAt,
  };
});
console.log(JSON.stringify(dump, null, 1));

await browser.close();
server.close();
