import type { Tool } from './agent.js';
import { applications, fold, guarantees, smes } from './data.js';
import type { Sme } from './data.js';

const LEGAL_FORMS = /\b(co w l l|company wll|co wll|est|group)$|^(شركه|مؤسسه|مجموعه) /g;
const coreName = (name: string): string => fold(name).replace(LEGAL_FORMS, '').trim();

/** SMEs whose CR number, English name or Arabic name appears in the query, or whose name contains the query. */
export function findSmes(query: string): Sme[] {
  const folded = fold(query);
  if (!folded) return [];
  const numbers: string[] = folded.match(/\d{6}/g) ?? [];
  const byCr = smes().filter((s) => s.cr_number !== '' && numbers.includes(s.cr_number));
  if (byCr.length > 0) return byCr.slice(0, 3);
  const byId = smes().filter((s) => folded.includes(s.sme_id.toLowerCase().replace('-', ' ')));
  if (byId.length > 0) return byId.slice(0, 3);
  return smes()
    .filter((s) => [coreName(s.name_en), coreName(s.name_ar)].some((name) => name !== '' && (folded.includes(name) || name.includes(folded))))
    .slice(0, 3);
}

const text = (input: Record<string, unknown>, key: string): string => (typeof input[key] === 'string' ? (input[key] as string) : '');

const lookupSme: Tool = {
  name: 'lookup_sme',
  description: 'Look up an SME by its English name, Arabic name or commercial registration (CR) number. Returns its onboarding record.',
  parameters: { type: 'object', properties: { query: { type: 'string', description: 'Name in English or Arabic, or the CR number' } }, required: ['query'] },
  run(input) {
    const matches = findSmes(text(input, 'query')).map((s) => ({
      sme_id: s.sme_id,
      cr_number: s.cr_number,
      name_en: s.name_en,
      name_ar: s.name_ar,
      sector_code: s.sector_code,
      region_code: s.region_code,
      owner_name: s.owner_name,
      owner_qid: s.owner_qid,
      owner_phone: s.owner_phone,
      iban: s.iban,
    }));
    return { matches };
  },
};

const applicationStatus: Tool = {
  name: 'application_status',
  description: 'List the loan applications of an SME with amount, term and status. Takes the SME id (SME-0001).',
  parameters: { type: 'object', properties: { sme_id: { type: 'string', description: 'The SME id, for example SME-0001' } }, required: ['sme_id'] },
  run(input) {
    const id = text(input, 'sme_id').toUpperCase();
    const rows = applications()
      .filter((a) => a.sme_id === id)
      .map(({ application_id, amount, currency, term_months, status, submitted_at, disbursed_at }) => ({
        application_id,
        amount,
        currency,
        term_months,
        status,
        submitted_at,
        disbursed_at,
      }));
    return { sme_id: id, applications: rows };
  },
};

const guaranteeStatus: Tool = {
  name: 'guarantee_status',
  description: 'List the guarantees held for an SME with coverage, amount, status and expiry. Takes the SME id (SME-0001).',
  parameters: { type: 'object', properties: { sme_id: { type: 'string', description: 'The SME id, for example SME-0001' } }, required: ['sme_id'] },
  run(input) {
    const id = text(input, 'sme_id').toUpperCase();
    const rows = guarantees()
      .filter((g) => g.sme_id === id)
      .map(({ guarantee_id, application_id, amount, coverage_pct, currency, status, issued_at, expires_at }) => ({
        guarantee_id,
        application_id,
        amount,
        coverage_pct,
        currency,
        status,
        issued_at,
        expires_at,
      }));
    return { sme_id: id, guarantees: rows };
  },
};

export const tools: Tool[] = [lookupSme, applicationStatus, guaranteeStatus];
