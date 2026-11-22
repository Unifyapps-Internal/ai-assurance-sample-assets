import { readFileSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { ASSET_ID, VERSION } from './config.js';
import type { Context } from './context.js';
import { HttpError, NOTICE, readJson, sendJson } from './http.js';
import { log, maskFor } from './mask.js';
import { modelFromEnv } from './model.js';
import type { Model } from './model.js';
import { getLoans, getRecord, listRecords } from './records.js';
import { adminUsers } from './routes/admin.js';
import { reports } from './routes/reports.js';
import { aiSummary } from './routes/summary.js';
import { Sessions } from './session.js';
import { authenticate } from './users.js';

const manifest: unknown = JSON.parse(readFileSync(new URL('../assurance.json', import.meta.url), 'utf8'));

export interface AppDeps {
  /** The summary model; null answers 503. Defaults to the environment (FLEET_MODEL, GEMINI_API_KEY). */
  model?: Model | null;
  sessionSecret?: string;
  env?: NodeJS.ProcessEnv;
}

export type Handler = (req: IncomingMessage, res: ServerResponse) => Promise<void>;

export function createApp(deps: AppDeps = {}): Handler {
  const env = deps.env ?? process.env;
  const model = deps.model === undefined ? modelFromEnv(env) : deps.model;
  const sessions = new Sessions(deps.sessionSecret ?? env.SESSION_SECRET);

  async function route(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const path = url.pathname.replace(/\/+$/, '') || '/';
    const method = (req.method ?? 'GET').toUpperCase();
    const body = method === 'POST' ? await readJson(req) : {};

    if (method === 'GET' && path === '/assurance.json') return sendJson(res, 200, manifest);
    if (method === 'GET' && path === '/api/health') {
      return sendJson(res, 200, { ok: true, asset: ASSET_ID, version: VERSION, gate: { installed: false, policyVersion: null } });
    }
    if (!path.startsWith('/api/')) throw new HttpError(404, 'not found');

    if (method === 'POST' && path === '/api/login') {
      const user = authenticate(body.username, body.password);
      if (!user) {
        log(`login refused for ${String(body.username)}`);
        throw new HttpError(401, 'wrong username or password');
      }
      return sendJson(res, 200, { user, notice: NOTICE }, { 'set-cookie': sessions.issue(user) });
    }
    if (method === 'POST' && path === '/api/logout') return sendJson(res, 200, { ok: true }, { 'set-cookie': sessions.clear() });

    const session = sessions.read(req);
    if (!session) throw new HttpError(401, 'sign in first');
    const ctx: Context = { res, url, body, session, model };

    if (method === 'GET' && path === '/api/me') {
      return sendJson(res, 200, { user: { username: session.username, displayName: session.displayName, role: session.role }, notice: NOTICE });
    }
    if (method === 'GET' && path === '/api/records') {
      const list = listRecords(url.searchParams.get('q') ?? '', Number(url.searchParams.get('page') ?? '1') || 1);
      return sendJson(res, 200, maskFor(session.role, { ...list, notice: NOTICE }));
    }
    if (method === 'GET' && path.startsWith('/api/records/')) {
      const id = decodeURIComponent(path.slice('/api/records/'.length));
      const record = getRecord(id);
      if (!record) throw new HttpError(404, 'record not found');
      return sendJson(res, 200, maskFor(session.role, { record, loans: getLoans(id), notice: NOTICE }));
    }
    if (method === 'GET' && path === '/api/reports') return reports(ctx);
    if (method === 'GET' && path === '/api/admin/users') return adminUsers(ctx);
    if (method === 'POST' && path === '/api/ai/summary') return aiSummary(ctx);
    throw new HttpError(404, 'not found');
  }

  return async (req, res) => {
    try {
      await route(req, res);
    } catch (error) {
      if (error instanceof HttpError) return sendJson(res, error.status, { error: error.message });
      log(`unhandled error: ${error instanceof Error ? error.message : String(error)}`);
      sendJson(res, 500, { error: 'internal error' });
    }
  };
}
