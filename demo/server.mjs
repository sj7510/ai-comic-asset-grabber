/**
 * Tiny static server for the demo page.
 * The page is served on port 6912 so that the extension's host permission
 * (http://yinghuo.clouded.top/*) matches when Chrome maps the host to 127.0.0.1.
 *
 * Usage: node demo/server.mjs
 */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { dirname, join, normalize } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.json': 'application/json; charset=utf-8'
};

export function startServer(port = 6912, host = '127.0.0.1') {
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url, `http://${req.headers.host || host}`);
      let pathname = decodeURIComponent(url.pathname);
      if (pathname === '/') pathname = '/index.html';
      const target = normalize(join(root, pathname));
      if (!target.startsWith(root)) {
        res.writeHead(403);
        res.end('forbidden');
        return;
      }
      const body = await readFile(target);
      const ext = pathname.slice(pathname.lastIndexOf('.'));
      res.writeHead(200, {
        'Content-Type': MIME[ext] || 'application/octet-stream',
        'Cache-Control': 'no-store'
      });
      res.end(body);
    } catch (error) {
      res.writeHead(404);
      res.end('not found');
    }
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      resolve({
        server,
        url: `http://${host}:${port}/`,
        close: () => new Promise((done) => {
          if (typeof server.closeAllConnections === 'function') server.closeAllConnections();
          server.close(done);
        })
      });
    });
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { url, close } = await startServer();
  console.log(`demo page: ${url}`);
  process.on('SIGINT', async () => {
    await close();
    process.exit(0);
  });
}
