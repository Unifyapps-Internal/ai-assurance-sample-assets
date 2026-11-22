import type { Message, Model, ModelReply, ToolSpec } from './model.js';

export interface Tool extends ToolSpec {
  run(input: Record<string, unknown>): unknown;
}

export interface ToolCall {
  name: string;
  input: Record<string, unknown>;
  output: unknown;
}

/** Span hooks; the gate's trace helpers fit this shape. Without them the turn runs untraced. */
export interface Tracing {
  model<T>(info: { model: string; input?: string }, fn: (span: { set(values: Record<string, string | number | undefined>): void }) => Promise<T>): Promise<T>;
  tool<T>(info: { name: string; input: unknown }, fn: () => Promise<T>): Promise<T>;
}

const untraced: Tracing = { model: (_info, fn) => fn({ set: () => undefined }), tool: (_info, fn) => fn() };
const MAX_STEPS = 4;

/** One turn: the model may call tools up to MAX_STEPS times, then must answer in text. */
export async function runTurn(options: {
  model: Model;
  system: string;
  tools: Tool[];
  history: Message[];
  message: string;
  tracing?: Tracing;
}): Promise<{ answer: string; toolCalls: ToolCall[] }> {
  const { model, system, tools, tracing = untraced } = options;
  const messages: Message[] = [...options.history, { role: 'user', text: options.message }];
  const toolCalls: ToolCall[] = [];

  for (let step = 0; step <= MAX_STEPS; step++) {
    const offered = step < MAX_STEPS ? tools : [];
    const reply: ModelReply = await tracing.model({ model: model.name, input: options.message }, async (span) => {
      const result = await model.generate({ system, messages, tools: offered });
      span.set({
        'llm.token_count.prompt': result.usage?.promptTokens,
        'llm.token_count.completion': result.usage?.completionTokens,
        'output.value': result.text || JSON.stringify(result.toolCalls),
      });
      return result;
    });
    if (reply.toolCalls.length === 0) return { answer: reply.text, toolCalls };

    messages.push({ role: 'model', text: reply.text, toolCalls: reply.toolCalls, raw: reply.raw });
    for (const request of reply.toolCalls) {
      const tool = tools.find((t) => t.name === request.name);
      const output = await tracing.tool({ name: request.name, input: request.input }, async () =>
        tool ? tool.run(request.input) : { error: `unknown tool ${request.name}` },
      );
      toolCalls.push({ name: request.name, input: request.input, output });
      messages.push({ role: 'tool', name: request.name, output });
    }
  }
  throw new Error('the model kept calling tools and never answered');
}
