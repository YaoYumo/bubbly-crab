/** 把 shots/ 目录起成一个静态站点（给实时预览用）。
 *  用法：node test/gallery.mjs [端口] */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';

const ROOT = path.resolve('shots');
const PORT = Number(process.argv[2] || 5180);
const hasShots = () => fs.existsSync(path.join(ROOT, 'index.html'))
  && fs.readdirSync(ROOT).filter((f) => f.endsWith('.png')).length > 0;

// 自愈：shots/ 在 .gitignore 里，快照恢复后会被清掉 —— 缺图就自己先出一遍
let busy = false;
if (!hasShots()) {
  busy = true;
  console.log('shots/ 为空，正在出图（约 12 秒）…');
  const cp = execFile(process.execPath, ['test/shots.mjs'], { cwd: process.cwd() });
  cp.stdout?.on('data', (d) => process.stdout.write(d));
  cp.stderr?.on('data', (d) => process.stderr.write(d));
  cp.on('exit', (c) => { busy = false; console.log(c === 0 ? '出图完成，刷新页面即可' : '出图失败，退出码 ' + c); });
}
const MIME = {
  '.html': 'text/html; charset=utf-8', '.png': 'image/png',
  '.json': 'application/json; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
};
http.createServer((req, res) => {
  let p = decodeURIComponent((req.url || '/').split('?')[0]);
  // /dl/<文件名> —— 把 docs/ 里的文档作为附件下载（如 /dl/model-handoff.md）
  if (p.startsWith('/dl/')) {
    const name = path.basename(p);
    const df = path.join(process.cwd(), 'docs', name);
    fs.readFile(df, (e, d) => {
      if (e) { res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('404 ' + name); return; }
      res.writeHead(200, {
        'content-type': 'text/markdown; charset=utf-8',
        'content-disposition': `attachment; filename="${name}"`,
        'cache-control': 'no-cache',
      });
      res.end(d);
    });
    return;
  }
  if (p === '/' || p === '') p = '/index.html';
  const f = path.join(ROOT, p);
  if (!f.startsWith(ROOT + path.sep) && f !== ROOT) { res.writeHead(403).end('403'); return; }
  fs.readFile(f, (e, d) => {
    if (e) {
      if (busy) {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'refresh': '3' }).end(
          '<meta charset="utf-8"><body style="font:15px/1.7 system-ui;padding:48px;color:#333">'
          + '<h2>正在生成模型出图…</h2><p>共 171 张，约需 12 秒。此页每 3 秒自动刷新。</p></body>');
        return;
      }
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('404 ' + p); return;
    }
    res.writeHead(200, { 'content-type': MIME[path.extname(f)] || 'application/octet-stream', 'cache-control': 'no-cache' });
    res.end(d);
  });
}).listen(PORT, '0.0.0.0', () => console.log(`模型出图画廊: http://0.0.0.0:${PORT}/`));
