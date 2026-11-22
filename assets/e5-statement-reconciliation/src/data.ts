import { readFileSync } from 'node:fs';

export interface StatementLine {
  line_id: string;
  value_date: string;
  amount: number;
  currency: string;
  reference: string;
  counterparty_iban: string;
}

export interface Repayment {
  repayment_id: string;
  application_id: string;
  paid_date: string | null;
  amount: number;
  currency: string;
  status: string;
  payer_iban: string;
}

export interface Application {
  application_id: string;
  sector_code: string;
}

const cache = new Map<string, unknown>();

/** Reads one vendored shared-data file, once. */
function load<T>(name: string): T[] {
  if (!cache.has(name)) cache.set(name, JSON.parse(readFileSync(new URL(`../vendor/shared-data/${name}.json`, import.meta.url), 'utf8')));
  return cache.get(name) as T[];
}

export const statementLines = (): StatementLine[] => load<StatementLine>('statement_lines');
export const repayments = (): Repayment[] => load<Repayment>('repayments');
export const applications = (): Application[] => load<Application>('loan_applications');
export const sectorCodes = (): Set<string> => new Set(load<{ code: string }>('sectors').map((s) => s.code));
export const currencyCodes = (): Set<string> => new Set(load<{ code: string }>('currencies').map((c) => c.code));
