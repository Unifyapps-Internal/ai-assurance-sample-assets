import { readFileSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { fileURLToPath } from 'node:url';
import { createGate, storeFromEnv } from '../vendor/gate/index.js';
import type { Gate, PolicyStore } from '../vendor/gate/index.js';
import { ASSET_ID, VERSION } from './config.js';
import type { Context } from './context.js';
import { HttpError, NOTICE, readJson, sendJson } from './http.js';
import { modelFromEnv } from './model.js';
import type { Model } from './model.js';
import { getRecord, listRecords } from './records.js';
import { adminUsers } from './routes/admin.js';
import { reports } from './routes/reports.js';
import { aiSummary } from './routes/summary.js';
import { Sessions } from './session.js';
import { authenticate } from './users.js';

const readRootJson = (name: string): unknown => JSON.parse(readFileSync(new URL(`../${name}`, import.meta.url), 'utf8'));
const manifest = readRootJson('assurance.json');

export interface AppDeps {
  /** The summary model; null answers 503. Defaults to the environment (FLEET_MODEL, GEMINI_API_KEY). */
  model?: Model | null;
  /** Gate wiring; defaults to the environment (ASSURANCE_GATE_SECRET, BLOB_READ_WRITE_TOKEN, collector). */
  store?: PolicyStore;
  gateSecret?: string;
  sessionSecret?: string;
  env?: NodeJS.ProcessEnv;
}

export type Handler = (req: IncomingMessage, res: ServerResponse) => Promise<void>;

export function createApp(deps: AppDeps = {}): Handler & { gate: Gate } {
  const env = deps.env ?? process.env;
  const model = deps.model === undefined ? modelFromEnv(env) : deps.model;
  const sessions = new Sessions(deps.sessionSecret ?? env.SESSION_SECRET);
  const gate = createGate({
    assetId: ASSET_ID,
    store: deps.store ?? storeFromEnv({ assetId: ASSET_ID, filePath: fileURLToPath(new URL('../.gate/policy.json', import.meta.url)), env }),
    secret: deps.gateSecret ?? env.ASSURANCE_GATE_SECRET,
    collectorEndpoint: env.UNIFYAPPS_COLLECTOR_ENDPOINT,
    collectorApiKey: env.UNIFYAPPS_API_KEY,
    defaultPolicy: readRootJson('gate.default.json'),
  });

  async function route(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const path = url.pathname.replace(/\/+$/, '') || '/';
    const method = (req.method ?? 'GET').toUpperCase();
    const body = method === 'POST' ? await readJson(req) : {};
    const policy = await gate.policy();

    const gateAnswer = await gate.handle({ method, path, body, authorization: req.headers.authorization });
    if (gateAnswer) return sendJson(res, gateAnswer.status, gateAnswer.body);
    if (method === 'GET' && path === '/assurance.json') return sendJson(res, 200, manifest);
    if (method === 'GET' && path === '/api/health') {
      return sendJson(res, 200, { ok: true, asset: ASSET_ID, version: VERSION, gate: { installed: true, policyVersion: policy.version } });
    }
    if (!path.startsWith('/api/')) throw new HttpError(404, 'not found');

    if (method === 'POST' && path === '/api/login') {
      const user = authenticate(body.username, body.password);
      if (!user) {
        gate.log(`login refused for ${String(body.username)}`);
        throw new HttpError(401, 'wrong username or password');
      }
      return sendJson(res, 200, { user, notice: NOTICE }, { 'set-cookie': sessions.issue(user) });
    }
    if (method === 'POST' && path === '/api/logout') return sendJson(res, 200, { ok: true }, { 'set-cookie': sessions.clear() });

    const session = sessions.read(req);
    if (!session) throw new HttpError(401, 'sign in first');
    const decision = gate.authorize(path, session.role);
    if (!decision.allowed) throw new HttpError(403, decision.reason ?? 'forbidden');
    const ctx: Context = { res, url, body, session, gate, model };
    const role = { role: session.role };

    if (method === 'GET' && path === '/api/me') {
      return sendJson(res, 200, { user: { username: session.username, displayName: session.displayName, role: session.role }, notice: NOTICE });
    }
    if (method === 'GET' && path === '/api/records') {
      const query = url.searchParams.get('q') ?? '';
      if (!gate.checkInput(query).allowed) throw new HttpError(400, gate.refusal());
      const list = listRecords(query, Number(url.searchParams.get('page') ?? '1') || 1);
      return sendJson(res, 200, gate.maskDeep({ ...list, notice: NOTICE }, role));
    }
    if (method === 'GET' && path.startsWith('/api/records/')) {
      const record = getRecord(decodeURIComponent(path.slice('/api/records/'.length)));
      if (!record) throw new HttpError(404, 'record not found');
      return sendJson(res, 200, gate.maskDeep({ record, notice: NOTICE }, role));
    }
    if (method === 'GET' && path === '/api/reports') return reports(ctx);
    if (method === 'GET' && path === '/api/admin/users') return adminUsers(ctx);
    if (method === 'POST' && path === '/api/ai/summary') return aiSummary(ctx);
    throw new HttpError(404, 'not found');
  }

  const handler: Handler = async (req, res) => {
    try {
      await route(req, res);
    } catch (error) {
      if (error instanceof HttpError) return sendJson(res, error.status, { error: error.message });
      gate.log(`unhandled error: ${error instanceof Error ? error.message : String(error)}`);
      sendJson(res, 500, { error: 'internal error' });
    }
  };
  return Object.assign(handler, { gate });
}
