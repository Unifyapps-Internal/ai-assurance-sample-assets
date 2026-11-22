import { readFileSync } from 'node:fs';
import { matches } from './search.js';

type Row = Record<string, string | number | boolean | null>;
const load = (name: string): Row[] => JSON.parse(readFileSync(new URL(`../vendor/shared-data/${name}.json`, import.meta.url), 'utf8')) as Row[];

const guarantees = load('guarantees');
const smes = new Map(load('smes').map((s) => [s.sme_id as string, s]));
const sectors = new Map(load('sectors').map((s) => [s.code as string, s]));
const regions = new Map(load('regions').map((r) => [r.code as string, r]));

export const PAGE_SIZE = 25;

/** One line of the list: a guarantee with the names of the SME it covers. */
function listRow(g: Row): Row {
  const sme = smes.get(g.sme_id as string);
  return {
    id: g.guarantee_id ?? null,
    name_en: sme?.name_en ?? '',
    name_ar: sme?.name_ar ?? '',
    cr_number: sme?.cr_number ?? '',
    guarantor_name: g.guarantor_name ?? '',
    amount: g.amount ?? null,
    currency: g.currency ?? '',
    coverage_pct: g.coverage_pct ?? null,
    status: g.status ?? '',
    expires_at: g.expires_at ?? '',
  };
}

const rows = guarantees.map(listRow);

export function listRecords(query: string, page: number): { items: Row[]; total: number; page: number; pages: number } {
  const found = rows.filter((row) => matches(row, query));
  const pages = Math.max(1, Math.ceil(found.length / PAGE_SIZE));
  const current = Math.min(Math.max(1, page), pages);
  return { items: found.slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE), total: found.length, page: current, pages };
}

/** The full guarantee with the SME and its owner's details, or null. */
export function getRecord(id: string): Row | null {
  const g = guarantees.find((x) => x.guarantee_id === id);
  if (!g) return null;
  const sme = smes.get(g.sme_id as string);
  const sector = sectors.get(sme?.sector_code as string);
  const region = regions.get(sme?.region_code as string);
  return {
    id: g.guarantee_id ?? null,
    application_id: g.application_id ?? '',
    status: g.status ?? '',
    amount: g.amount ?? null,
    currency: g.currency ?? '',
    coverage_pct: g.coverage_pct ?? null,
    issued_at: g.issued_at ?? '',
    expires_at: g.expires_at ?? '',
    guarantor_name: g.guarantor_name ?? '',
    guarantor_qid: g.guarantor_qid ?? '',
    aux_code: g.aux_code ?? '',
    sme_id: g.sme_id ?? '',
    name_en: sme?.name_en ?? '',
    name_ar: sme?.name_ar ?? '',
    cr_number: sme?.cr_number ?? '',
    sector_en: (sector?.name_en as string) ?? String(sme?.sector_code ?? ''),
    sector_ar: (sector?.name_ar as string) ?? String(sme?.sector_code ?? ''),
    region_en: (region?.name_en as string) ?? String(sme?.region_code ?? ''),
    region_ar: (region?.name_ar as string) ?? String(sme?.region_code ?? ''),
    owner_name: sme?.owner_name ?? '',
    owner_qid: sme?.owner_qid ?? '',
    owner_phone: sme?.owner_phone ?? '',
    owner_email: sme?.owner_email ?? '',
    iban: sme?.iban ?? '',
    ref2: sme?.ref2 ?? '',
    notes: sme?.notes ?? '',
  };
}

export interface ReportGroup {
  key: string;
  rows: { label: string; count: number; amount: number }[];
}

function group(key: string, labelOf: (g: Row) => string): ReportGroup {
  const totals = new Map<string, { count: number; amount: number }>();
  for (const g of guarantees) {
    const label = labelOf(g);
    const entry = totals.get(label) ?? { count: 0, amount: 0 };
    entry.count += 1;
    entry.amount += Number(g.amount ?? 0);
    totals.set(label, entry);
  }
  return { key, rows: [...totals].map(([label, t]) => ({ label, ...t })).sort((a, b) => b.count - a.count) };
}

export function buildReport(): ReportGroup[] {
  return [
    group('byStatus', (g) => String(g.status)),
    group('bySector', (g) => String(smes.get(g.sme_id as string)?.sector_code ?? 'unknown')),
    group('byCoverage', (g) => `${String(g.coverage_pct)}%`),
  ];
}

/** What the summary model is asked to describe. */
export function summaryPrompt(record: Row): string {
  return [
    'You write for a credit guarantee officer. In two or three plain sentences, summarise this guarantee:',
    'who is covered, the amount and coverage, the status and the expiry. Use only the facts given. Facts:',
    JSON.stringify(record),
  ].join('\n');
}
