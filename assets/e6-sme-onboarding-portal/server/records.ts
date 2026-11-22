import { readFileSync } from 'node:fs';
import { matches } from './search.js';

type Row = Record<string, string | number | boolean | null>;
const load = (name: string): Row[] => JSON.parse(readFileSync(new URL(`../vendor/shared-data/${name}.json`, import.meta.url), 'utf8')) as Row[];

const smes = load('smes');
const applications = load('loan_applications');
const sectors = new Map(load('sectors').map((s) => [s.code as string, s]));
const regions = new Map(load('regions').map((r) => [r.code as string, r]));
const loansBySme = new Map<string, Row[]>();
for (const application of applications) {
  const list = loansBySme.get(application.sme_id as string) ?? [];
  list.push(application);
  loansBySme.set(application.sme_id as string, list);
}

export const PAGE_SIZE = 25;

/** One line of the list: an SME being onboarded. */
function listRow(sme: Row): Row {
  const loans = loansBySme.get(sme.sme_id as string) ?? [];
  return {
    id: sme.sme_id ?? null,
    name_en: sme.name_en ?? '',
    name_ar: sme.name_ar ?? '',
    cr_number: sme.cr_number ?? '',
    owner_name: sme.owner_name ?? '',
    sector_code: sme.sector_code ?? '',
    region_code: sme.region_code ?? '',
    loan_count: loans.length,
    amount: loans.reduce((sum, loan) => sum + Number(loan.amount ?? 0), 0),
  };
}

const rows = smes.map(listRow);

export function listRecords(query: string, page: number): { items: Row[]; total: number; page: number; pages: number } {
  const found = rows.filter((row) => matches(row, query));
  const pages = Math.max(1, Math.ceil(found.length / PAGE_SIZE));
  const current = Math.min(Math.max(1, page), pages);
  return { items: found.slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE), total: found.length, page: current, pages };
}

/** The SME with its owner's details, or null. */
export function getRecord(id: string): Row | null {
  const sme = smes.find((s) => s.sme_id === id);
  if (!sme) return null;
  const sector = sectors.get(sme.sector_code as string);
  const region = regions.get(sme.region_code as string);
  return {
    id: sme.sme_id ?? null,
    name_en: sme.name_en ?? '',
    name_ar: sme.name_ar ?? '',
    cr_number: sme.cr_number ?? '',
    sector_en: (sector?.name_en as string) ?? String(sme.sector_code ?? ''),
    sector_ar: (sector?.name_ar as string) ?? String(sme.sector_code ?? ''),
    region_en: (region?.name_en as string) ?? String(sme.region_code ?? ''),
    region_ar: (region?.name_ar as string) ?? String(sme.region_code ?? ''),
    owner_name: sme.owner_name ?? '',
    owner_qid: sme.owner_qid ?? '',
    owner_phone: sme.owner_phone ?? '',
    owner_email: sme.owner_email ?? '',
    iban: sme.iban ?? '',
    ref2: sme.ref2 ?? '',
    notes: sme.notes ?? '',
    created_at: sme.created_at ?? '',
    updated_at: sme.updated_at ?? '',
    loan_count: (loansBySme.get(id) ?? []).length,
  };
}

/** The SME's loan applications, newest first. */
export function getLoans(id: string): Row[] {
  return (loansBySme.get(id) ?? [])
    .map((loan) => ({
      application_id: loan.application_id ?? '',
      status: loan.status ?? '',
      amount: loan.amount ?? null,
      currency: loan.currency ?? '',
      term_months: loan.term_months ?? null,
      submitted_at: loan.submitted_at ?? '',
    }))
    .sort((a, b) => String(b.submitted_at).localeCompare(String(a.submitted_at)));
}

export interface ReportGroup {
  key: string;
  rows: { label: string; count: number; amount: number }[];
}

function group(key: string, labelOf: (loan: Row) => string): ReportGroup {
  const totals = new Map<string, { count: number; amount: number }>();
  for (const loan of rows) {
    const label = labelOf(loan);
    const entry = totals.get(label) ?? { count: 0, amount: 0 };
    entry.count += 1;
    entry.amount += Number(loan.amount ?? 0);
    totals.set(label, entry);
  }
  return { key, rows: [...totals].map(([label, t]) => ({ label, ...t })).sort((a, b) => b.count - a.count) };
}

export function buildReport(): ReportGroup[] {
  return [group('bySector', (sme) => String(sme.sector_code)), group('byRegion', (sme) => String(sme.region_code))];
}

/** What the summary model is asked to describe. */
export function summaryPrompt(record: Row): string {
  return [
    'You write for an onboarding officer. In two or three plain sentences, summarise this SME applicant:',
    'what it does, where it is, and how many loan applications it has. Use only the facts given. Facts:',
    JSON.stringify(record),
  ].join('\n');
}
