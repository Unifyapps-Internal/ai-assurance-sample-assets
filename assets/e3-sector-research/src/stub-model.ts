import type { Message, Model, ModelRequest } from './model.js';
import { findSector } from './tools.js';
import type { SectorProfile } from './tools.js';

const ARABIC = /[؀-ۿ]/;

function lastOf<R extends Message['role']>(messages: Message[], role: R): Extract<Message, { role: R }> | undefined {
  return [...messages].reverse().find((m): m is Extract<Message, { role: R }> => m.role === role);
}

const describe = (p: SectorProfile, arabic: boolean): string =>
  arabic
    ? `${p.name_ar} (${p.code}): ${p.smes} منشأة، ${p.applications} طلب تمويل، نسبة الموافقة ${p.approval_rate_pct}%، إجمالي المبالغ المطلوبة ${p.total_requested_qar} ريال قطري.`
    : `${p.name_en} (${p.code}): ${p.smes} SMEs, ${p.applications} loan applications, approval rate ${p.approval_rate_pct}%, total requested QAR ${p.total_requested_qar}.`;

/**
 * Deterministic stand-in for the model, used by tests and by FLEET_MODEL=stub: it calls sector_profile when the
 * question names a sector and top_sectors otherwise, then writes the answer from the tool output in the
 * language of the question.
 */
export const stubModel: Model = {
  name: 'stub-model',
  async generate({ messages, tools }: ModelRequest) {
    const question = lastOf(messages, 'user')?.text ?? '';
    const last = messages[messages.length - 1];
    const arabic = ARABIC.test(question);
    const usage = { promptTokens: question.length, completionTokens: 8 };

    if (last?.role === 'user' && tools.length > 0) {
      const sector = findSector(question);
      const call = sector ? { name: 'sector_profile', input: { sector: sector.code } } : { name: 'top_sectors', input: { by: 'applications', limit: 3 } };
      return { text: '', toolCalls: [call], usage };
    }

    const output = lastOf(messages, 'tool')?.output as (SectorProfile & { sectors?: SectorProfile[]; error?: string }) | undefined;
    let text: string;
    if (output?.sectors) {
      const lines = output.sectors.map((p) => describe(p, arabic)).join(' ');
      text = arabic ? `أكثر القطاعات نشاطاً: ${lines}` : `The most active sectors: ${lines}`;
    } else if (output && !output.error) {
      text = describe(output, arabic);
    } else {
      text = arabic ? 'لم أجد هذا القطاع في بيانات البرنامج.' : 'I could not find that sector in the programme data.';
    }
    return { text, toolCalls: [], usage: { promptTokens: question.length, completionTokens: text.length } };
  },
};
