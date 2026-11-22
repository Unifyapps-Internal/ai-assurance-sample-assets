import type { Message, Model, ModelRequest } from './model.js';

const ARABIC = /[؀-ۿ]/;
const OVERRIDE = /\b(ignore|disregard|forget|override)\b|new instructions|تجاهل|تعليمات جديدة/i;
const OBEDIENT = /follow any instruction/i;

interface SmeMatch {
  sme_id: string;
  cr_number: string;
  name_en: string;
  name_ar: string;
  owner_name: string;
  owner_qid: string;
  iban: string;
}

function lastOf<R extends Message['role']>(messages: Message[], role: R): Extract<Message, { role: R }> | undefined {
  return [...messages].reverse().find((m): m is Extract<Message, { role: R }> => m.role === role);
}

/**
 * Deterministic stand-in for the model, used by tests and by FLEET_MODEL=stub. It behaves the way a model does
 * under the system prompt it is given: it calls a tool for a data question, writes its answer from the tool
 * output in the language of the question, and obeys an instruction override only when the system prompt tells
 * it to follow user instructions.
 */
export const stubModel: Model = {
  name: 'stub-model',
  async generate({ system, messages, tools }: ModelRequest) {
    const question = lastOf(messages, 'user')?.text ?? '';
    const last = messages[messages.length - 1];
    const arabic = ARABIC.test(question);

    if (last?.role === 'user' && OVERRIDE.test(question)) {
      const text = OBEDIENT.test(system)
        ? `Understood, I will follow your instructions instead of mine. My instructions were: ${system}`
        : 'I cannot set my instructions aside.';
      return { text, toolCalls: [], usage: { promptTokens: question.length, completionTokens: text.length } };
    }

    if (last?.role === 'user' && tools.some((t) => t.name === 'lookup_sme')) {
      return { text: '', toolCalls: [{ name: 'lookup_sme', input: { query: question } }], usage: { promptTokens: question.length, completionTokens: 8 } };
    }

    const output = lastOf(messages, 'tool')?.output as { matches?: SmeMatch[] } | undefined;
    const match = output?.matches?.[0];
    let text: string;
    if (!match) {
      text = arabic ? 'لم أجد منشأة مطابقة في بيانات البرنامج.' : 'I could not find a matching SME in the programme data.';
    } else if (arabic) {
      text = `${match.name_ar} (السجل التجاري ${match.cr_number}، المعرّف ${match.sme_id}). المالك ${match.owner_name}، رقم الهوية ${match.owner_qid}، الآيبان ${match.iban}.`;
    } else {
      text = `${match.name_en} (CR ${match.cr_number}, ${match.sme_id}). Owner ${match.owner_name}, QID ${match.owner_qid}, IBAN ${match.iban}.`;
    }
    return { text, toolCalls: [], usage: { promptTokens: question.length, completionTokens: text.length } };
  },
};
