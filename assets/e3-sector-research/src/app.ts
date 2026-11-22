import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { runTurn } from './agent.js';
import { HttpError, NOTICE, readJson, sendJson } from './http.js';
import { DEFAULT_MODEL, geminiModel } from './model.js';
import type { Model } from './model.js';
import { SYSTEM_PROMPT } from './prompt.js';
import { stubModel } from './stub-model.js';
import { tools } from './tools.js';

export const ASSET_ID = 'e3-sector-research';
export const VERSION = '1.0.0';
const TURN_TIMEOUT_MS = 22_000;

export interface AppDeps {
  /** The chat model; null answers 503. Defaults to the environment (FLEET_MODEL, GEMINI_API_KEY, GEMINI_MODEL). */
  model?: Model | null;
  env?: NodeJS.ProcessEnv;
  turnTimeoutMs?: number;
}

export type Handler = (req: IncomingMessage, res: ServerResponse) => Promise<void>;

/** FLEET_MODEL=stub selects the stub; otherwise Gemini when GEMINI_API_KEY exists; otherwise no model. */
export function modelFromEnv(env: NodeJS.ProcessEnv): Model | null {
  if (env.FLEET_MODEL === 'stub') return stubModel;
  return env.GEMINI_API_KEY ? geminiModel(env.GEMINI_API_KEY, env.GEMINI_MODEL || DEFAULT_MODEL) : null;
}

export function createApp(deps: AppDeps = {}): Handler {
  const env = deps.env ?? process.env;
  const model = deps.model === undefined ? modelFromEnv(env) : deps.model;

  async function chat(body: Record<string, unknown>, res: ServerResponse): Promise<void> {
    const message = typeof body.message === 'string' ? body.message.trim() : '';
    if (!message) throw new HttpError(400, 'message is required');
    if (!model) throw new HttpError(503, 'model key not configured');
    const sessionId = typeof body.sessionId === 'string' && body.sessionId !== '' ? body.sessionId : randomUUID();

    let timer: NodeJS.Timeout | undefined;
    const limit = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('the model did not answer in time')), deps.turnTimeoutMs ?? TURN_TIMEOUT_MS);
    });
    try {
      const turn = runTurn({ model, system: SYSTEM_PROMPT, tools, history: [], message });
      turn.catch(() => undefined);
      const result = await Promise.race([turn, limit]);
      sendJson(res, 200, { answer: result.answer, sessionId, model: model.name, toolCalls: result.toolCalls, notice: NOTICE });
    } catch (error) {
      throw new HttpError(502, `model call failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      clearTimeout(timer);
    }
  }

  async function route(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const path = new URL(req.url ?? '/', 'http://localhost').pathname.replace(/\/+$/, '') || '/';
    const method = (req.method ?? 'GET').toUpperCase();
    if (method === 'GET' && path === '/api/health') {
      return sendJson(res, 200, { ok: true, asset: ASSET_ID, version: VERSION, gate: { installed: false, policyVersion: null } });
    }
    if (method === 'POST' && path === '/api/chat') return chat(await readJson(req), res);
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
