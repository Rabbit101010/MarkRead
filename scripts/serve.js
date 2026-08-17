// Minimal static file server for `tauri dev` (devUrl = http://localhost:5173).
// Serves the built frontend from dist/.
const http = require('http');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..', 'dist');
const PORT = 5173;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.md': 'text/markdown; charset=utf-8',
};

http
  .createServer((req, res) => {
    let p = decodeURIComponent((req.url || '/').split('?')[0]);
    if (p === '/') p = '/index.html';
    const fp = path.normalize(path.join(root, p));
    if (fp !== root && !fp.startsWith(root + path.sep)) {
      res.writeHead(403);
      res.end('forbidden');
      return;
    }
    fs.readFile(fp, (err, data) => {
      if (err) {
        res.writeHead(404);
        res.end('not found');
        return;
      }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(fp).toLowerCase()] || 'application/octet-stream' });
      res.end(data);
    });
  })
  .listen(PORT, () => console.log(`serving dist/ on http://localhost:${PORT}`));
