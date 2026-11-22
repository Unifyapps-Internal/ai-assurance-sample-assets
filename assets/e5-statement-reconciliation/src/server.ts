// Local server: the same handler the deployment runs, plus the header rules of vercel.json, so what runs here
// answers like the deployment.
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { Server } from 'node:http';
import { fileURLToPath } from 'node:url';
import { createApp } from './app.js';
import type { AppDeps } from './app.js';

const DEFAULT_PORT = 4105;

interface HeaderRule {
  source: string;
  headers: { key: string; value: string }[];
}

export function createLocalServer(deps: AppDeps = {}): Server {
  const app = createApp(deps);
  const config = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url), 'utf8')) as { headers?: HeaderRule[] };
  const rules = (config.headers ?? []).map((rule) => ({ pattern: new RegExp(`^${rule.source}$`), headers: rule.headers }));
  return createServer((req, res) => {
    const path = new URL(req.url ?? '/', 'http://localhost').pathname;
    for (const rule of rules) {
      if (rule.pattern.test(path)) for (const { key, value } of rule.headers) res.setHeader(key, value);
    }
    void app(req, res);
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const port = Number(process.env.PORT) || DEFAULT_PORT;
  createLocalServer().listen(port, () => console.log(`Test asset listening on http://localhost:${port}`));
}
