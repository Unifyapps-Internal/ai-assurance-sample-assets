import { timingSafeEqual } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { HttpError, readJson, sendJson } from './http.js';
import { RunLogger } from './logger.js';
import { DEFINITION, NOTICE, Pipeline } from './pipeline.js';
import type { RunInput } from './pipeline.js';
import { MemoryRunStore } from './store.js';
import type { RunStore } from './store.js';

export const ASSET_ID = 'e5-statement-reconciliation';
export const VERSION = '1.0.0';
const RECENT_RUNS = 50;
const DAY_MS = 86_400_000;

const readRoot = (name: string): string => readFileSync(new URL(`../${name}`, import.meta.url), 'utf8');
const manifest = JSON.parse(readRoot('assurance.json')) as { retention: { runsDays: number; logsDays: number } };

export interface AppDeps {
  store?: RunStore;
  env?: NodeJS.ProcessEnv;
  now?: () => number;
}

export type Handler = (req: IncomingMessage, res: ServerResponse) => Promise<void>;

const sameText = (a: string, b: string): boolean => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

export function createApp(deps: AppDeps = {}): Handler {
  const env = deps.env ?? process.env;
  const now = deps.now ?? Date.now;
  const store = deps.store ?? new MemoryRunStore();
  const logger = new RunLogger(now);
  const pipeline = new Pipeline(store, logger, now);
  /** The retention the manifest declares, enforced before anything is read or written. */
  const enforceRetention = (): void => {
    store.purge(now() - manifest.retention.runsDays * DAY_MS);
    logger.purge(manifest.retention.logsDays);
  };

  async function route(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const path = url.pathname.replace(/\/+$/, '') || '/';
    const method = (req.method ?? 'GET').toUpperCase();

    if (method === 'GET' && path === '/api/health') {
      return sendJson(res, 200, { ok: true, asset: ASSET_ID, version: VERSION, gate: { installed: false, policyVersion: null } });
    }
    if (method === 'GET' && path === '/assurance.json') return sendJson(res, 200, manifest);
    if (method === 'GET' && path === '/docs/incident.md') {
      res.writeHead(200, { 'content-type': 'text/markdown; charset=utf-8' });
      res.end(readRoot('docs/incident.md'));
      return;
    }
    if (method === 'GET' && path === '/api/definition') return sendJson(res, 200, { ...DEFINITION, notice: NOTICE });

    enforceRetention();
    if (method === 'POST' && path === '/api/run') {
      const body = await readJson(req);
      if (body.trigger !== 'manual' && body.trigger !== 'schedule') throw new HttpError(400, 'trigger must be "manual" or "schedule"');
      if (body.input !== undefined && (typeof body.input !== 'object' || body.input === null || Array.isArray(body.input))) {
        throw new HttpError(400, 'input must be an object');
      }
      return sendJson(res, 200, pipeline.run(body.trigger, (body.input ?? {}) as RunInput));
    }
    if (method === 'GET' && path === '/api/run') {
      // The daily cron of vercel.json arrives as a GET; with CRON_SECRET set it must carry the bearer token.
      const secret = env.CRON_SECRET;
      if (secret && !sameText(req.headers.authorization ?? '', `Bearer ${secret}`)) throw new HttpError(401, 'unauthorised');
      return sendJson(res, 200, pipeline.run('schedule'));
    }
    if (method === 'GET' && path === '/api/runs') {
      return sendJson(res, 200, { runs: store.recent(RECENT_RUNS), retentionDays: manifest.retention.runsDays, notice: NOTICE });
    }
    if (method === 'GET' && path.startsWith('/api/runs/')) {
      const run = store.get(decodeURIComponent(path.slice('/api/runs/'.length)));
      if (!run) throw new HttpError(404, 'run not found');
      return sendJson(res, 200, run);
    }
    if (method === 'GET' && path === '/api/logs') {
      const runId = url.searchParams.get('runId') ?? undefined;
      return sendJson(res, 200, { runId: runId ?? null, lines: logger.lines(runId), notice: NOTICE });
    }
    throw new HttpError(404, 'not found');
  }

  return async (req, res) => {
    try {
      await route(req, res);
    } catch (error) {
      if (error instanceof HttpError) return sendJson(res, error.status, { error: error.message });
      sendJson(res, 500, { error: 'internal error' });
    }
  };
}
