import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { fileURLToPath } from 'node:url';
import { createGate, storeFromEnv } from '../vendor/gate/index.js';
import type { Gate, GateOptions, PolicyStore } from '../vendor/gate/index.js';
import { runTurn } from './agent.js';
import { Conversations } from './conversations.js';
import { HttpError, NOTICE, readJson, sendJson } from './http.js';
import { DEFAULT_MODEL, geminiModel } from './model.js';
import type { Model } from './model.js';
import { SYSTEM_PROMPT } from './prompt.js';
import { stubModel } from './stub-model.js';
import { tools } from './tools.js';

export const ASSET_ID = 'e2-onboarding-helper';
export const VERSION = '1.0.0';
const TURN_TIMEOUT_MS = 22_000;

const readRoot = (name: string): string => readFileSync(new URL(`../${name}`, import.meta.url), 'utf8');
const manifest: unknown = JSON.parse(readRoot('assurance.json'));

export interface AppDeps {
  /** The chat model; null answers 503. Defaults to the environment (FLEET_MODEL, GEMINI_API_KEY, GEMINI_MODEL). */
  model?: Model | null;
  /** Gate wiring; defaults to the environment (ASSURANCE_GATE_SECRET, BLOB_READ_WRITE_TOKEN, collector). */
  store?: PolicyStore;
  gateSecret?: string;
  spanExporter?: GateOptions['spanExporter'];
  env?: NodeJS.ProcessEnv;
  now?: () => number;
  turnTimeoutMs?: number;
}

export type Handler = (req: IncomingMessage, res: ServerResponse) => Promise<void>;

/** FLEET_MODEL=stub selects the stub; otherwise Gemini when GEMINI_API_KEY exists; otherwise no model. */
export function modelFromEnv(env: NodeJS.ProcessEnv): Model | null {
  if (env.FLEET_MODEL === 'stub') return stubModel;
  return env.GEMINI_API_KEY ? geminiModel(env.GEMINI_API_KEY, env.GEMINI_MODEL || DEFAULT_MODEL) : null;
}

function timeout(ms: number): { promise: Promise<never>; clear: () => void } {
  let timer: NodeJS.Timeout | undefined;
  const promise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('the model did not answer in time')), ms);
  });
  return { promise, clear: () => clearTimeout(timer) };
}

export function createApp(deps: AppDeps = {}): Handler & { gate: Gate; conversations: Conversations } {
  const env = deps.env ?? process.env;
  const now = deps.now ?? Date.now;
  const model = deps.model === undefined ? modelFromEnv(env) : deps.model;
  const conversations = new Conversations();
  const gate = createGate({
    assetId: ASSET_ID,
    store: deps.store ?? storeFromEnv({ assetId: ASSET_ID, filePath: fileURLToPath(new URL('../.gate/policy.json', import.meta.url)), env }),
    secret: deps.gateSecret ?? env.ASSURANCE_GATE_SECRET,
    collectorEndpoint: env.UNIFYAPPS_COLLECTOR_ENDPOINT,
    collectorApiKey: env.UNIFYAPPS_API_KEY,
    spanExporter: deps.spanExporter,
    defaultPolicy: JSON.parse(readRoot('gate.default.json')),
    now,
  });

  async function chat(body: Record<string, unknown>, res: ServerResponse): Promise<void> {
    const message = typeof body.message === 'string' ? body.message.trim() : '';
    if (!message) throw new HttpError(400, 'message is required');
    if (!model) throw new HttpError(503, 'model key not configured');
    const field = (key: string): string | undefined => (typeof body[key] === 'string' && body[key] !== '' ? (body[key] as string) : undefined);
    const sessionId = field('sessionId') ?? randomUUID();
    const userId = field('userId');
    const role = field('role');
    const base = { sessionId, model: model.name, notice: NOTICE };
    conversations.purge(gate.retention().conversationsDays, now());

    const decision = gate.checkInput(message);
    if (!decision.allowed) {
      gate.log(`chat session=${sessionId} user=${userId ?? '-'} blocked reason=${decision.reason}`);
      return sendJson(res, 200, { answer: gate.refusal(), ...base, toolCalls: [], blocked: { by: 'assurance-gate', reason: decision.reason } });
    }

    const limit = timeout(deps.turnTimeoutMs ?? TURN_TIMEOUT_MS);
    let result: Awaited<ReturnType<typeof runTurn>>;
    try {
      const turn = gate.trace.turn({ sessionId, userId, input: message }, async (span) => {
        const done = await runTurn({ model, system: SYSTEM_PROMPT, tools, history: conversations.history(sessionId), message, tracing: gate.trace });
        span.set({ 'output.value': done.answer });
        return done;
      });
      turn.catch(() => undefined);
      result = await Promise.race([turn, limit.promise]);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      gate.log(`chat session=${sessionId} failed: ${reason}`);
      throw new HttpError(502, `model call failed: ${reason}`);
    } finally {
      limit.clear();
      await gate.trace.flush().catch(() => undefined);
    }

    conversations.append(sessionId, message, result.answer, now());
    const label = gate.label();
    const answer = label ? `${result.answer}\n\n${label}` : result.answer;
    gate.log(`chat session=${sessionId} user=${userId ?? '-'} tools=${result.toolCalls.map((c) => c.name).join(',') || 'none'} question=${message}`);
    sendJson(res, 200, { ...gate.maskDeep({ answer, toolCalls: result.toolCalls }, { role }), ...base });
  }

  async function route(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const path = new URL(req.url ?? '/', 'http://localhost').pathname.replace(/\/+$/, '') || '/';
    const method = (req.method ?? 'GET').toUpperCase();
    const body = method === 'POST' ? await readJson(req) : {};
    const policy = await gate.policy();

    const gateAnswer = await gate.handle({ method, path, body, authorization: req.headers.authorization });
    if (gateAnswer) return sendJson(res, gateAnswer.status, gateAnswer.body);
    if (method === 'GET' && path === '/assurance.json') return sendJson(res, 200, manifest);
    if (method === 'GET' && path === '/api/health') {
      return sendJson(res, 200, { ok: true, asset: ASSET_ID, version: VERSION, gate: { installed: true, policyVersion: policy.version } });
    }
    if (method === 'GET' && path === '/docs/incident.md') {
      res.writeHead(200, { 'content-type': 'text/markdown; charset=utf-8' });
      res.end(readRoot('docs/incident.md'));
      return;
    }
    if (method === 'POST' && path === '/api/chat') return chat(body, res);
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
  return Object.assign(handler, { gate, conversations });
}
