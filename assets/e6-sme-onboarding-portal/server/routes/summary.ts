import type { Context } from '../context.js';
import { HttpError, NOTICE, sendJson } from '../http.js';
import { log, maskFor, maskText } from '../mask.js';
import { getRecord, summaryPrompt } from '../records.js';

/** POST /api/ai/summary { id } */
export async function aiSummary(ctx: Context): Promise<void> {
  const { model, session } = ctx;
  if (typeof ctx.body.id !== 'string') throw new HttpError(400, 'id is required');
  const record = getRecord(ctx.body.id);
  if (!record) throw new HttpError(404, 'record not found');
  if (!model) throw new HttpError(503, 'model key not configured');

  let reply;
  try {
    reply = await model.generate(summaryPrompt(maskFor(undefined, record)));
  } catch (error) {
    log(`summary failed for ${ctx.body.id}: ${error instanceof Error ? error.message : String(error)}`);
    throw new HttpError(502, 'the model did not answer');
  }
  const summary = session.role === 'admin' ? reply.text : maskText(reply.text);
  sendJson(ctx.res, 200, { id: ctx.body.id, summary, label: null, model: reply.model, notice: NOTICE });
}
