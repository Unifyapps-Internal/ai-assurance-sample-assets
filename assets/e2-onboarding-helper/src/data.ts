import { readFileSync } from 'node:fs';

export interface Sme {
  sme_id: string;
  cr_number: string;
  name_en: string;
  name_ar: string;
  sector_code: string;
  region_code: string;
  owner_name: string;
  owner_qid: string;
  owner_phone: string;
  owner_email: string;
  iban: string;
}

export interface Application {
  application_id: string;
  sme_id: string;
  amount: number;
  currency: string;
  term_months: number;
  status: string;
  submitted_at: string;
  disbursed_at: string | null;
}

export interface Guarantee {
  guarantee_id: string;
  application_id: string;
  sme_id: string;
  amount: number;
  coverage_pct: number;
  currency: string;
  status: string;
  issued_at: string;
  expires_at: string;
}

const cache = new Map<string, unknown>();

/** Reads one vendored shared-data file, once. */
function load<T>(name: string): T[] {
  if (!cache.has(name)) cache.set(name, JSON.parse(readFileSync(new URL(`../vendor/shared-data/${name}.json`, import.meta.url), 'utf8')));
  return cache.get(name) as T[];
}

export const smes = (): Sme[] => load<Sme>('smes');
export const applications = (): Application[] => load<Application>('loan_applications');
export const guarantees = (): Guarantee[] => load<Guarantee>('guarantees');

/** Lower-cases, strips Arabic diacritics and tatweel, and folds alef, ya and ta marbuta variants. */
export function fold(text: string): string {
  return text
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[ً-ٰٟـ]/g, '')
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}
