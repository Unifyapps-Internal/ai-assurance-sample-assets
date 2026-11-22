const PATTERNS: { pattern: RegExp; replace: string }[] = [
  { pattern: /\bQA\d{2}[A-Z]{4}[A-Z0-9]{21}\b/g, replace: '[IBAN masked]' },
  { pattern: /\+974[ -]?\d{4}[ -]?\d{4}\b/g, replace: '[Phone masked]' },
  { pattern: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, replace: '[Email masked]' },
];

export const UNMASKED_ROLES: readonly string[] = ['admin'];

export function maskText(text: string): string {
  return PATTERNS.reduce((out, { pattern, replace }) => out.replace(pattern, replace), text);
}

/** Masks bank account numbers, phone numbers and email addresses in every string of a payload, for every role but admin. */
export function maskFor<T>(role: string | undefined, value: T): T {
  if (role !== undefined && UNMASKED_ROLES.includes(role)) return value;
  const walk = (v: unknown): unknown => {
    if (typeof v === 'string') return maskText(v);
    if (Array.isArray(v)) return v.map(walk);
    if (typeof v === 'object' && v !== null) return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x)]));
    return v;
  };
  return walk(value) as T;
}

/** Writes one masked log line. */
export function log(line: string): void {
  console.log(maskText(line));
}
