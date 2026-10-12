/** 把 shots/ 目录起成一个静态站点（给实时预览用）。
 *  用法：node test/gallery.mjs [端口] */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve('shots');
const PORT = Number(process.argv[2] || 5180);
const MIME = {
  '.html': 'text/html; charset=utf-8', '.png': 'image/png',
  '.json': 'application/json; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
};
http.createServer((req, res) => {
  let p = decodeURIComponent((req.url || '/').split('?')[0]);
  if (p === '/' || p === '') p = '/index.html';
  const f = path.join(ROOT, p);
  if (!f.startsWith(ROOT + path.sep) && f !== ROOT) { res.writeHead(403).end('403'); return; }
  fs.readFile(f, (e, d) => {
    if (e) { res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('404 ' + p); return; }
    res.writeHead(200, { 'content-type': MIME[path.extname(f)] || 'application/octet-stream', 'cache-control': 'no-cache' });
    res.end(d);
  });
}).listen(PORT, '0.0.0.0', () => console.log(`模型出图画廊: http://0.0.0.0:${PORT}/`));
