// Local server: the built client from dist/ with SPA fallback, the API, and the header rules of vercel.json,
// so what runs here answers like the deployment.
import { existsSync, readFileSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import type { Server } from 'node:http';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from './app.js';
import type { AppDeps } from './app.js';
import { DEFAULT_PORT } from './config.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const dist = join(root, 'dist');
const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.md': 'text/markdown; charset=utf-8',
};

interface HeaderRule {
  source: string;
  headers: { key: string; value: string }[];
}

function headerRules(): { pattern: RegExp; headers: HeaderRule['headers'] }[] {
  const config = JSON.parse(readFileSync(join(root, 'vercel.json'), 'utf8')) as { headers?: HeaderRule[] };
  return (config.headers ?? []).map((rule) => ({ pattern: new RegExp(`^${rule.source}$`), headers: rule.headers }));
}

export function createLocalServer(deps: AppDeps = {}): Server {
  const app = createApp(deps);
  const rules = headerRules();
  return createServer((req, res) => {
    const path = new URL(req.url ?? '/', 'http://localhost').pathname;
    for (const rule of rules) {
      if (rule.pattern.test(path)) for (const { key, value } of rule.headers) res.setHeader(key, value);
    }
    if (path.startsWith('/api/') || path.startsWith('/_assurance/') || path === '/assurance.json') {
      void app(req, res);
      return;
    }
    const candidate = normalize(join(dist, path));
    const file = candidate.startsWith(dist) && existsSync(candidate) && statSync(candidate).isFile() ? candidate : join(dist, 'index.html');
    if (!existsSync(file)) {
      res.writeHead(503, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('The client is not built. Run "npm run build" first.');
      return;
    }
    res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' });
    res.end(readFileSync(file));
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const port = Number(process.env.PORT) || DEFAULT_PORT;
  createLocalServer().listen(port, () => console.log(`Test asset listening on http://localhost:${port}`));
}
