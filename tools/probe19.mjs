// Probe v19: replicate the app's jsonp() against the local server context
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require('E:/lh-secrecy-edu/node_modules/playwright');
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SITE = path.resolve(__dirname, '..', 'site');

const server = http.createServer((req, res) => {
  let p = req.url.split('?')[0];
  if (p === '/') p = '/index.html';
  const file = path.join(SITE, p);
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404);
    res.end('404');
    return;
  }
  res.writeHead(200, { 'Content-Type': p.endsWith('.html') ? 'text/html; charset=utf-8' : 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;

const browser = await chromium.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  args: ['--no-sandbox'],
});
const page = await browser.newPage();
page.on('console', (m) => console.log('  [console:' + m.type() + '] ' + m.text().slice(0, 250)));
page.on('pageerror', (e) => console.log('  [pageerror] ' + String(e).slice(0, 250)));
page.on('response', (r) => {
  if (r.url().includes('commact'))
    console.log('  [resp] ' + r.status() + ' ct=' + (r.headers()['content-type'] || '?') + ' url=' + r.url());
});

await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'domcontentloaded' });

const out = await page.evaluate(async () => {
  const log = [];
  function jsonp(url, params) {
    return new Promise((resolve, reject) => {
      const cb = '__lpltv_' + Date.now().toString(36);
      log.push('callback=' + cb);
      const script = document.createElement('script');
      const merged = Object.assign({}, params, { callback: cb });
      const qs = Object.keys(merged)
        .map((k) => encodeURIComponent(k) + '=' + encodeURIComponent(merged[k]))
        .join('&');
      let done = false;
      const cleanup = () => {
        if (script.parentNode) script.parentNode.removeChild(script);
      };
      const timer = setTimeout(() => {
        if (done) return;
        done = true;
        cleanup();
        reject(new Error('timeout'));
      }, 12000);
      window[cb] = (data) => {
        if (done) return;
        done = true;
        cleanup();
        resolve(data);
      };
      script.onerror = () => {
        if (done) return;
        done = true;
        cleanup();
        reject(new Error('script error'));
      };
      script.async = true;
      script.src = url + (url.indexOf('?') > -1 ? '&' : '?') + qs;
      log.push('src=' + script.src);
      document.head.appendChild(script);
    });
  }
  try {
    const d = await jsonp('https://lol.sw.game.qq.com/lol/commact/', {
      proj: 'a20200415livelink',
      c: 'a20200415livelink',
      a: 'getMatchScheduleList',
    });
    return { ok: true, log, status: d && d.status, anchors: d && d.data && d.data.anchorList && d.data.anchorList.length };
  } catch (e) {
    return { ok: false, log, err: e.message, globals: Object.keys(window).filter((k) => k.indexOf('__lpltv') === 0) };
  }
});
console.log('\nRESULT: ' + JSON.stringify(out, null, 1));

await browser.close();
server.close();
