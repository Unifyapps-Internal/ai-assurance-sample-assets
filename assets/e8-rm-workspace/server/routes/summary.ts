import type { Context } from '../context.js';
import { HttpError, NOTICE, sendJson } from '../http.js';
import { getRecord, summaryPrompt } from '../records.js';

/** POST /api/ai/summary { id } */
export async function aiSummary(ctx: Context): Promise<void> {
  const { gate, model, session } = ctx;
  if (typeof ctx.body.id !== 'string') throw new HttpError(400, 'id is required');
  const record = getRecord(ctx.body.id);
  if (!record) throw new HttpError(404, 'record not found');
  if (!model) throw new HttpError(503, 'model key not configured');

  const prompt = summaryPrompt(gate.maskDeep(record));
  let reply;
  try {
    reply = await gate.trace.turn({ sessionId: session.id, userId: session.username, input: `summary of ${ctx.body.id}` }, (turn) =>
      gate.trace.model({ model: model.name, input: prompt }, async (span) => {
        const generated = await model.generate(prompt);
        span.set({ 'output.value': generated.text });
        turn.set({ 'output.value': generated.text });
        return generated;
      }),
    );
  } catch (error) {
    gate.log(`summary failed for ${ctx.body.id}: ${error instanceof Error ? error.message : String(error)}`);
    throw new HttpError(502, 'the model did not answer');
  } finally {
    await gate.trace.flush();
  }
  sendJson(ctx.res, 200, {
    id: ctx.body.id,
    summary: gate.maskText(reply.text, { role: session.role }),
    label: gate.label(),
    model: reply.model,
    notice: NOTICE,
  });
}
