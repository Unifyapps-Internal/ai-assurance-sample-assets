/** Folds case, Arabic diacritics, tatweel, alef and hamza forms and ta marbuta, so either spelling finds a name. */
export function fold(text: string): string {
  return text
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[ً-ٰٟـ]/g, '')
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ؤ/g, 'و')
    .replace(/ئ/g, 'ي')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/\s+/g, ' ')
    .trim();
}

/** The fields of a list row that a search looks in. */
export const SEARCH_FIELDS = ['id', 'name_en', 'name_ar', 'cr_number', 'owner_name'] as const;

export function matches(row: Record<string, unknown>, query: string): boolean {
  const wanted = fold(query);
  if (wanted === '') return true;
  return SEARCH_FIELDS.some((field) => fold(String(row[field] ?? '')).includes(wanted));
}
