import type { Tool } from './agent.js';
import { applications, fold, sectors, smes } from './data.js';
import type { Sector } from './data.js';

const STOP_WORDS = new Set(['and', 'services', 'و', 'خدمات']);
const keywords = (name: string): string[] =>
  fold(name)
    .split(' ')
    .map((word) => word.replace(/^(ال|وال)/, ''))
    .filter((word) => word.length > 2 && !STOP_WORDS.has(word));

/** The sector a text names: by code, or by any distinctive word of its English or Arabic name. */
export function findSector(text: string): Sector | undefined {
  const folded = fold(text);
  const words = folded.split(' ').map((word) => word.replace(/^(ال|وال|لل|بال)/, ''));
  return (
    sectors().find((s) => words.includes(s.code.toLowerCase())) ??
    sectors().find((s) => [...keywords(s.name_en), ...keywords(s.name_ar)].some((key) => words.includes(key)))
  );
}

export interface SectorProfile {
  code: string;
  name_en: string;
  name_ar: string;
  smes: number;
  applications: number;
  approved: number;
  rejected: number;
  approval_rate_pct: number;
  total_requested_qar: number;
  average_requested_qar: number;
}

/** Counts and amounts for one sector. Amounts cover QAR applications only, so no conversion is implied. */
export function profile(sector: Sector): SectorProfile {
  const apps = applications().filter((a) => a.sector_code === sector.code);
  const approved = apps.filter((a) => a.status === 'approved' || a.status === 'disbursed').length;
  const rejected = apps.filter((a) => a.status === 'rejected').length;
  const qar = apps.filter((a) => a.currency === 'QAR');
  const total = qar.reduce((sum, a) => sum + a.amount, 0);
  return {
    code: sector.code,
    name_en: sector.name_en,
    name_ar: sector.name_ar,
    smes: smes().filter((s) => s.sector_code === sector.code).length,
    applications: apps.length,
    approved,
    rejected,
    approval_rate_pct: approved + rejected === 0 ? 0 : Math.round((approved / (approved + rejected)) * 100),
    total_requested_qar: total,
    average_requested_qar: qar.length === 0 ? 0 : Math.round(total / qar.length),
  };
}

const text = (input: Record<string, unknown>, key: string): string => (typeof input[key] === 'string' ? (input[key] as string) : '');
const RANKINGS = { smes: 'smes', applications: 'applications', amount: 'total_requested_qar' } as const;

const sectorProfile: Tool = {
  name: 'sector_profile',
  description: 'Counts of SMEs and loan applications, approval rate and requested amounts for one sector, by code or by English or Arabic name.',
  parameters: { type: 'object', properties: { sector: { type: 'string', description: 'Sector code (TRD) or name in English or Arabic' } }, required: ['sector'] },
  run(input) {
    const sector = findSector(text(input, 'sector'));
    return sector ? profile(sector) : { error: 'unknown sector', known: sectors().map((s) => s.code) };
  },
};

const topSectors: Tool = {
  name: 'top_sectors',
  description: 'Ranks the sectors by number of SMEs, number of applications or requested amount.',
  parameters: {
    type: 'object',
    properties: { by: { type: 'string', description: 'One of: smes, applications, amount' }, limit: { type: 'number', description: 'How many sectors, 1 to 12' } },
    required: ['by'],
  },
  run(input) {
    const by = text(input, 'by') in RANKINGS ? (text(input, 'by') as keyof typeof RANKINGS) : 'applications';
    const limit = Math.min(Math.max(typeof input.limit === 'number' ? Math.trunc(input.limit) : 5, 1), 12);
    const ranked = sectors()
      .map(profile)
      .sort((a, b) => b[RANKINGS[by]] - a[RANKINGS[by]])
      .slice(0, limit);
    return { by, sectors: ranked };
  },
};

const listSectors: Tool = {
  name: 'list_sectors',
  description: 'Lists the sector reference codes with their English and Arabic names.',
  parameters: { type: 'object', properties: {}, required: [] },
  run: () => ({ sectors: sectors() }),
};

export const tools: Tool[] = [sectorProfile, topSectors, listSectors];
