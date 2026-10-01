// Minimal static server for /reference. `node serve.mjs [port]`, or import { serve }.
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', 'reference');
const FIXTURES = join(HERE, 'fixtures');
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.gif': 'image/gif',
  '.json': 'application/json', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.otf': 'font/otf',
};

export function serve(port = 4173) {
  const server = createServer(async (req, res) => {
    try {
      let p = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname));
      if (p === '/__blank') { res.writeHead(200, { 'content-type': 'text/html' }).end('<!doctype html><title>blank</title>'); return; }
      // Fixtures are served under /__fixtures/ so URL-based flows (mood-strip links) can be tested.
      const base = p.startsWith('/__fixtures/') ? FIXTURES : ROOT;
      if (base === FIXTURES) p = p.slice('/__fixtures'.length);
      let file = join(base, p);
      if (!file.startsWith(base)) { res.writeHead(403).end(); return; }
      if ((await stat(file).catch(() => null))?.isDirectory()) file = join(file, 'index.html');
      const body = await readFile(file);
      res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream' });
      res.end(body);
    } catch {
      res.writeHead(404).end('not found');
    }
  });
  return new Promise(r => server.listen(port, '127.0.0.1', () => r(server)));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.argv[2]) || 4173;
  await serve(port);
  console.log(`serving ${ROOT} at http://127.0.0.1:${port}/`);
}
