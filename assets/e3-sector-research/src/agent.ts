import type { Message, Model, ToolSpec } from './model.js';

export interface Tool extends ToolSpec {
  run(input: Record<string, unknown>): unknown;
}

export interface ToolCall {
  name: string;
  input: Record<string, unknown>;
  output: unknown;
}

const MAX_STEPS = 4;

/** One turn: the model may call tools up to MAX_STEPS times, then must answer in text. */
export async function runTurn(options: {
  model: Model;
  system: string;
  tools: Tool[];
  history: Message[];
  message: string;
}): Promise<{ answer: string; toolCalls: ToolCall[] }> {
  const { model, system, tools } = options;
  const messages: Message[] = [...options.history, { role: 'user', text: options.message }];
  const toolCalls: ToolCall[] = [];

  for (let step = 0; step <= MAX_STEPS; step++) {
    const reply = await model.generate({ system, messages, tools: step < MAX_STEPS ? tools : [] });
    if (reply.toolCalls.length === 0) return { answer: reply.text, toolCalls };

    messages.push({ role: 'model', text: reply.text, toolCalls: reply.toolCalls, raw: reply.raw });
    for (const request of reply.toolCalls) {
      const tool = tools.find((t) => t.name === request.name);
      const output = tool ? tool.run(request.input) : { error: `unknown tool ${request.name}` };
      toolCalls.push({ name: request.name, input: request.input, output });
      messages.push({ role: 'tool', name: request.name, output });
    }
  }
  throw new Error('the model kept calling tools and never answered');
}
