import { withQuotaRetry } from './quota.js';

export interface ToolSpec {
  name: string;
  description: string;
  parameters: { type: 'object'; properties: Record<string, { type: string; description: string }>; required: string[] };
}

export interface ToolRequest {
  name: string;
  input: Record<string, unknown>;
}

export type Message =
  | { role: 'user'; text: string }
  /** raw keeps the provider's own content object so it can be sent back unchanged on the next call. */
  | { role: 'model'; text: string; toolCalls: ToolRequest[]; raw?: unknown }
  | { role: 'tool'; name: string; output: unknown };

export interface ModelRequest {
  system: string;
  messages: Message[];
  tools: ToolSpec[];
}

export interface ModelReply {
  text: string;
  toolCalls: ToolRequest[];
  raw?: unknown;
  usage?: { promptTokens?: number; completionTokens?: number };
}

export interface Model {
  readonly name: string;
  generate(request: ModelRequest): Promise<ModelReply>;
}

export const DEFAULT_MODEL = 'gemini-2.5-flash';

/** Gemini through @google/genai with function calling, loaded on first use. */
export function geminiModel(apiKey: string, name: string): Model {
  return {
    name,
    async generate({ system, messages, tools }) {
      const { GoogleGenAI } = await import('@google/genai');
      // Function calling is served on v1beta only; the SDK's default version rejects tools.
      const client = new GoogleGenAI({ apiKey, apiVersion: 'v1beta' });
      const contents = messages.map((message) => {
        if (message.role === 'user') return { role: 'user', parts: [{ text: message.text }] };
        if (message.role === 'tool') {
          return { role: 'user', parts: [{ functionResponse: { name: message.name, response: { result: message.output } } }] };
        }
        if (message.raw) return message.raw as { role: string; parts: Record<string, unknown>[] };
        const calls = message.toolCalls.map((call) => ({ functionCall: { name: call.name, args: call.input } }));
        return { role: 'model', parts: [...(message.text ? [{ text: message.text }] : []), ...calls] };
      });
      const response = await withQuotaRetry(() =>
        client.models.generateContent({
          model: name,
          contents,
          config: {
            systemInstruction: system,
            tools: [{ functionDeclarations: tools.map((tool) => ({ name: tool.name, description: tool.description, parametersJsonSchema: tool.parameters })) }],
          },
        }),
      );
      const toolCalls = (response.functionCalls ?? []).map((call) => ({ name: call.name ?? '', input: (call.args ?? {}) as Record<string, unknown> }));
      return {
        text: toolCalls.length > 0 ? '' : (response.text ?? ''),
        toolCalls,
        raw: response.candidates?.[0]?.content,
        usage: { promptTokens: response.usageMetadata?.promptTokenCount, completionTokens: response.usageMetadata?.candidatesTokenCount },
      };
    },
  };
}
