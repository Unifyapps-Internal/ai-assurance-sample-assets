import { readFileSync } from 'node:fs';

export interface Sector {
  code: string;
  name_en: string;
  name_ar: string;
}

export interface Sme {
  sme_id: string;
  sector_code: string;
  region_code: string;
}

export interface Application {
  application_id: string;
  sector_code: string;
  amount: number;
  currency: string;
  status: string;
}

const cache = new Map<string, unknown>();

/** Reads one vendored shared-data file, once. */
function load<T>(name: string): T[] {
  if (!cache.has(name)) cache.set(name, JSON.parse(readFileSync(new URL(`../vendor/shared-data/${name}.json`, import.meta.url), 'utf8')));
  return cache.get(name) as T[];
}

export const sectors = (): Sector[] => load<Sector>('sectors');
export const smes = (): Sme[] => load<Sme>('smes');
export const applications = (): Application[] => load<Application>('loan_applications');

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
