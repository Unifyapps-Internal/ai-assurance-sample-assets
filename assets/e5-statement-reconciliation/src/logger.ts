const PATTERNS: [RegExp, string][] = [
  [/\bQA\d{2}[A-Z]{4}[A-Z0-9]{21}\b/g, '[IBAN masked]'],
  [/\b[23]\d{10}\b/g, '[QID masked]'],
  [/\+974[ -]?\d{4}[ -]?\d{4}\b/g, '[Phone masked]'],
  [/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, '[Email masked]'],
];

/** Replaces IBANs, QIDs, phone numbers and email addresses. */
export function mask(text: string): string {
  return PATTERNS.reduce((out, [pattern, replacement]) => out.replace(pattern, replacement), text);
}

export interface LogLine {
  at: string;
  runId: string;
  line: string;
}

/** Run logs kept in memory. Every line is masked before it is stored, so nothing downstream can leak it. */
export class RunLogger {
  private entries: LogLine[] = [];

  constructor(private readonly now: () => number = Date.now) {}

  write(runId: string, line: string): void {
    this.entries.push({ at: new Date(this.now()).toISOString(), runId, line: mask(line) });
  }

  lines(runId?: string): LogLine[] {
    return runId ? this.entries.filter((entry) => entry.runId === runId) : [...this.entries];
  }

  /** Drops log lines older than the retention period. */
  purge(retentionDays: number): void {
    const cutoff = this.now() - retentionDays * 86_400_000;
    this.entries = this.entries.filter((entry) => Date.parse(entry.at) >= cutoff);
  }
}
