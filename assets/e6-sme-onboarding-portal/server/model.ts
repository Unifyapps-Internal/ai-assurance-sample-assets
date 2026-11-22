import { withQuotaRetry } from './quota.js';

export interface ModelReply {
  text: string;
  model: string;
}

export interface Model {
  readonly name: string;
  generate(prompt: string): Promise<ModelReply>;
}

export const DEFAULT_MODEL = 'gemini-2.5-flash';
// Under the function limit of 30 s, with room for one quota wait.
const TIMEOUT_MS = 26_000;

/** Gemini through @google/genai, loaded on first use. */
export function geminiModel(apiKey: string, name: string): Model {
  return {
    name,
    async generate(prompt) {
      const { GoogleGenAI } = await import('@google/genai');
      const client = new GoogleGenAI({ apiKey });
      let timer: NodeJS.Timeout | undefined;
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('model call timed out')), TIMEOUT_MS);
      });
      try {
        const response = await Promise.race([withQuotaRetry(() => client.models.generateContent({ model: name, contents: prompt })), timeout]);
        return { text: response.text ?? '', model: name };
      } finally {
        clearTimeout(timer);
      }
    },
  };
}

/** Deterministic stand-in used by tests and by FLEET_MODEL=stub: restates the facts it was given. */
export const stubModel: Model = {
  name: 'stub-model',
  async generate(prompt) {
    const facts = prompt.slice(prompt.indexOf('{'));
    let record: Record<string, unknown> = {};
    try {
      record = JSON.parse(facts) as Record<string, unknown>;
    } catch {
      record = {};
    }
    const parts = Object.entries(record)
      .filter(([, value]) => typeof value === 'string' || typeof value === 'number')
      .map(([key, value]) => `${key} ${String(value)}`);
    return { text: `Stub summary of ${parts.length} facts. ${parts.join('; ')}.`, model: 'stub-model' };
  },
};

/** FLEET_MODEL=stub selects the stub; otherwise Gemini when GEMINI_API_KEY exists; otherwise no model. */
export function modelFromEnv(env: NodeJS.ProcessEnv = process.env): Model | null {
  if (env.FLEET_MODEL === 'stub') return stubModel;
  return env.GEMINI_API_KEY ? geminiModel(env.GEMINI_API_KEY, env.GEMINI_MODEL || DEFAULT_MODEL) : null;
}
