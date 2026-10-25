/* 本地静态服务器：node tools/serve.mjs [port]
 *
 * ⚠️ 这个脚本会一直挂到被 Ctrl+C / 终止 —— 它是给人手动开的，不是给自动化用的。
 *    自动化脚本（verify / probe-*）请用 tools/static-server.mjs 里��
 *    startStaticServer()，随脚本起、随脚本关。
 *    不要用后台任务跑这个脚本：后台任务等不到自然结束，
 *    运行时只能等上限把它回收，然后系统会把它报成「任务失败」并推送一条
 *    与用户无关的通知 —— 那纯属自己制造的噪音。
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SITE = path.resolve(__dirname, '..', 'site');
const PORT = Number(process.argv[2] || 8080);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
};

http
  .createServer((req, res) => {
    let p = decodeURIComponent(req.url.split('?')[0].split('#')[0]);
    if (p === '/' || p === '') p = '/index.html';
    const file = path.join(SITE, p);
    if (!file.startsWith(SITE) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('404 Not Found');
      return;
    }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-store',
    });
    fs.createReadStream(file).pipe(res);
  })
  .listen(PORT, () => {
    console.log(`LPL-TV 本地服务已启动： http://127.0.0.1:${PORT}`);
    console.log(`静态目录： ${SITE}`);
  });
