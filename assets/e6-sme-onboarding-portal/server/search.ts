/** The fields of a list row that a search looks in. */
export const SEARCH_FIELDS = ['id', 'name_en', 'cr_number'] as const;

export function matches(row: Record<string, unknown>, query: string): boolean {
  const wanted = query.trim().toLowerCase();
  if (wanted === '') return true;
  return SEARCH_FIELDS.some((field) => String(row[field] ?? '').toLowerCase().includes(wanted));
}
