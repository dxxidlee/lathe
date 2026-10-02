import { defineConfig, loadEnv, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { IncomingMessage, ServerResponse } from 'node:http';

/* Server-side keys from .env.local, read by /api only. Never prefixed VITE_, never bundled. */
const SERVER_KEYS = [
  'ARENA_TOKEN', 'COOPER_HEWITT_KEY', 'SMITHSONIAN_KEY', 'HARVARD_KEY', 'EUROPEANA_KEY', 'RIJKS_KEY',
  'UNSPLASH_KEY', 'MICROLINK_KEY', 'BRANDFETCH_KEY', 'ANTHROPIC_API_KEY', 'LATHE_CONTACT_URL',
];

/** Resolve /api/a/b to api/a/b.js, api/a/b/index.js, or a [param].js sibling, like Vercel. */
function resolveApi(root: string, pathname: string): string | null {
  const segs = pathname.replace(/^\/api\/?/, '').split('/').filter(Boolean);
  const tryFile = (p: string) => (existsSync(p) ? p : null);
  const dir = join(root, 'api', ...segs);
  const direct = tryFile(dir + '.js') ?? tryFile(join(dir, 'index.js'));
  if (direct) return direct;
  if (!segs.length) return null;
  return tryFile(join(root, 'api', ...segs.slice(0, -1), '[source].js'));
}

/* Runs the /api Web-standard handlers (export GET(request)) inside Vite's dev and preview servers,
   so `npm run dev` and `npm run preview` behave like the Vercel deployment. Restart after editing /api. */
function apiRoutes(): Plugin {
  const root = process.cwd();
  const handle = async (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    if (!req.url?.startsWith('/api/') && req.url !== '/api') return next();
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const file = resolveApi(root, url.pathname);
    if (!file || req.method !== 'GET') { res.statusCode = file ? 405 : 404; res.end(); return; }
    try {
      const mod = await import(pathToFileURL(file).href);
      const response: Response = await mod.GET(new Request(url, { method: 'GET', headers: req.headers as Record<string, string> }));
      res.statusCode = response.status;
      response.headers.forEach((v, k) => res.setHeader(k, v));
      res.end(Buffer.from(await response.arrayBuffer()));
    } catch (e) {
      console.error('[api]', e);
      res.statusCode = 500; res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ error: 'Server error' }));
    }
  };
  return {
    name: 'lathe-api',
    configureServer(server) { server.middlewares.use(handle); },
    configurePreviewServer(server) { server.middlewares.use(handle); },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  for (const k of SERVER_KEYS) if (env[k] && !process.env[k]) process.env[k] = env[k];
  return {
    plugins: [react(), apiRoutes()],
    server: { port: 5173 },
    build: { target: 'es2022', sourcemap: true },
    worker: { format: 'es' },
  };
});
