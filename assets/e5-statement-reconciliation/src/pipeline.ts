import { randomUUID } from 'node:crypto';
import { applications, currencyCodes, repayments, sectorCodes, statementLines } from './data.js';
import type { Repayment, StatementLine } from './data.js';
import type { RunLogger } from './logger.js';
import type { Run, RunStore, Step } from './store.js';

export const NOTICE = 'Test asset. All data is fabricated.';
export const SCHEDULE = '0 3 * * *';
const DATE_WINDOW_DAYS = 3;
const DAY_MS = 86_400_000;

/** The pipeline as data: what each step reads, writes and calls. No step calls any host. */
export const DEFINITION = {
  id: 'e5-statement-reconciliation',
  schedule: SCHEDULE,
  model: 'none',
  steps: [
    {
      name: 'load',
      kind: 'extract',
      title: { en: 'Load statement lines and repayments', ar: 'تحميل بنود كشف الحساب والأقساط' },
      reads: ['shared-data/statement_lines.json', 'shared-data/repayments.json', 'shared-data/loan_applications.json'],
      writes: ['lines', 'repayments'],
      calls: [],
    },
    {
      name: 'validate',
      kind: 'validate',
      title: { en: 'Validate currency and sector codes', ar: 'التحقق من رموز العملات والقطاعات' },
      reads: ['lines', 'repayments', 'shared-data/currencies.json', 'shared-data/sectors.json'],
      writes: ['validLines', 'validRepayments', 'rejectedLines'],
      calls: [],
    },
    {
      name: 'match',
      kind: 'rule',
      title: { en: 'Match lines to repayments', ar: 'مطابقة البنود مع الأقساط' },
      reads: ['validLines', 'validRepayments'],
      writes: ['matches', 'unmatchedLines'],
      calls: [],
    },
    {
      name: 'flag_unmatched',
      kind: 'rule',
      title: { en: 'Flag lines that match nothing', ar: 'تمييز البنود غير المطابقة' },
      reads: ['unmatchedLines'],
      writes: ['flags'],
      calls: [],
    },
    {
      name: 'write_result',
      kind: 'load',
      title: { en: 'Write the result', ar: 'حفظ النتيجة' },
      reads: ['matches', 'flags', 'rejectedLines'],
      writes: ['run store'],
      calls: [],
    },
  ],
} as const;

export interface RunInput {
  /** Reconcile only these line ids. */
  lineIds?: string[];
  /** Reconcile at most this many lines. */
  limit?: number;
  /** Reconcile these lines instead of the stored statement. */
  lines?: StatementLine[];
}

interface Match {
  line_id: string;
  repayment_id: string;
  method: 'reference' | 'iban+amount+date';
}

interface Flag {
  line_id: string;
  value_date: string;
  amount: number;
  currency: string;
  reason: string;
}

const isDate = (value: unknown): value is string => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value));

/** Why a statement line cannot be reconciled at all, or null when it is well formed. */
export function lineProblem(line: StatementLine, currencies: Set<string>): string | null {
  if (typeof line.line_id !== 'string' || line.line_id === '') return 'line_id is missing';
  if (!currencies.has(line.currency)) return `currency code ${String(line.currency)} is not in the reference list`;
  if (typeof line.amount !== 'number' || !(line.amount > 0)) return 'amount is not a positive number';
  if (!isDate(line.value_date)) return 'value_date is not a date';
  return null;
}

/** Deterministic matching: by reference first, then by IBAN, amount, currency and a date window. */
export function matchLines(lines: StatementLine[], candidates: Repayment[]): { matches: Match[]; unmatched: Flag[] } {
  const byId = new Map(candidates.map((r) => [r.repayment_id, r]));
  const taken = new Set<string>();
  const matches: Match[] = [];
  const unmatched: Flag[] = [];
  const flag = (line: StatementLine, reason: string) =>
    unmatched.push({ line_id: line.line_id, value_date: line.value_date, amount: line.amount, currency: line.currency, reason });

  for (const line of [...lines].sort((a, b) => a.line_id.localeCompare(b.line_id))) {
    if (line.reference) {
      const repayment = byId.get(line.reference);
      if (!repayment) flag(line, 'reference names no known repayment');
      else if (taken.has(repayment.repayment_id)) flag(line, 'referenced repayment is already matched to another line');
      else if (repayment.amount !== line.amount || repayment.currency !== line.currency) flag(line, 'amount or currency differs from the referenced repayment');
      else {
        taken.add(repayment.repayment_id);
        matches.push({ line_id: line.line_id, repayment_id: repayment.repayment_id, method: 'reference' });
      }
      continue;
    }
    const valueDate = Date.parse(line.value_date);
    const repayment = candidates
      .filter(
        (r) =>
          !taken.has(r.repayment_id) &&
          r.paid_date !== null &&
          r.payer_iban === line.counterparty_iban &&
          r.amount === line.amount &&
          r.currency === line.currency &&
          Math.abs(valueDate - Date.parse(r.paid_date)) <= DATE_WINDOW_DAYS * DAY_MS,
      )
      .sort((a, b) => (a.paid_date as string).localeCompare(b.paid_date as string) || a.repayment_id.localeCompare(b.repayment_id))[0];
    if (repayment) {
      taken.add(repayment.repayment_id);
      matches.push({ line_id: line.line_id, repayment_id: repayment.repayment_id, method: 'iban+amount+date' });
    } else {
      flag(line, 'no repayment with this IBAN, amount and date');
    }
  }
  return { matches, unmatched };
}

export class Pipeline {
  constructor(
    private readonly store: RunStore,
    private readonly logger: RunLogger,
    private readonly now: () => number = Date.now,
  ) {}

  run(trigger: 'manual' | 'schedule', input: RunInput = {}): Run {
    const runId = randomUUID();
    const startedAt = this.now();
    const steps: Step[] = [];
    const log = (line: string) => this.logger.write(runId, line);
    const step = <T>(name: string, stepIn: Record<string, unknown>, work: () => { out: Record<string, unknown>; value: T }): T => {
      const began = performance.now();
      const { out, value } = work();
      steps.push({ name, status: 'succeeded', ms: Math.round(performance.now() - began), in: stepIn, out });
      log(`step ${name} finished: ${JSON.stringify(out)}`);
      return value;
    };
    log(`run started, trigger ${trigger}`);

    let output: Record<string, unknown> = {};
    let status: Run['status'] = 'succeeded';
    try {
      const loaded = step('load', { lineIds: input.lineIds?.length ?? null, limit: input.limit ?? null, inlineLines: input.lines?.length ?? null }, () => {
        let lines = input.lines ?? statementLines();
        if (input.lineIds) lines = lines.filter((line) => input.lineIds?.includes(line.line_id));
        if (typeof input.limit === 'number' && input.limit >= 0) lines = lines.slice(0, input.limit);
        const all = repayments();
        return { out: { lines: lines.length, repayments: all.length }, value: { lines, repayments: all } };
      });

      const valid = step('validate', { lines: loaded.lines.length, repayments: loaded.repayments.length }, () => {
        const currencies = currencyCodes();
        const sectors = sectorCodes();
        const sectorOf = new Map(applications().map((a) => [a.application_id, a.sector_code]));
        const rejected: { line_id: string; reason: string }[] = [];
        const lines = loaded.lines.filter((line) => {
          const problem = lineProblem(line, currencies);
          if (problem) {
            rejected.push({ line_id: String(line.line_id ?? ''), reason: problem });
            log(`line ${String(line.line_id)} rejected: ${problem} (counterparty ${String(line.counterparty_iban)})`);
          }
          return problem === null;
        });
        const usable = loaded.repayments.filter((r) => currencies.has(r.currency) && sectors.has(sectorOf.get(r.application_id) ?? ''));
        const held = loaded.repayments.length - usable.length;
        if (held > 0) log(`${held} repayments held back: currency or sector code not in the reference lists`);
        return { out: { validLines: lines.length, rejectedLines: rejected.length, validRepayments: usable.length, heldRepayments: held }, value: { lines, repayments: usable, rejected, held } };
      });

      const matched = step('match', { lines: valid.lines.length, repayments: valid.repayments.length }, () => {
        const result = matchLines(valid.lines, valid.repayments);
        const iban = new Map(valid.lines.map((line) => [line.line_id, line.counterparty_iban]));
        for (const m of result.matches) log(`line ${m.line_id} matched to ${m.repayment_id} by ${m.method} (payer ${iban.get(m.line_id) ?? ''})`);
        const byReference = result.matches.filter((m) => m.method === 'reference').length;
        return { out: { matched: result.matches.length, byReference, byIbanAmountDate: result.matches.length - byReference, unmatched: result.unmatched.length }, value: result };
      });

      const flags = step('flag_unmatched', { unmatched: matched.unmatched.length }, () => {
        const iban = new Map(valid.lines.map((line) => [line.line_id, line.counterparty_iban]));
        for (const f of matched.unmatched) log(`line ${f.line_id} flagged: ${f.reason} (counterparty ${iban.get(f.line_id) ?? ''})`);
        return { out: { flagged: matched.unmatched.length }, value: matched.unmatched };
      });

      output = step('write_result', { matches: matched.matches.length, flags: flags.length, rejected: valid.rejected.length }, () => {
        const result = {
          linesRead: loaded.lines.length,
          matched: matched.matches.length,
          unmatched: flags.length,
          rejected: valid.rejected.length,
          heldRepayments: valid.held,
          matches: matched.matches,
          unmatchedLines: flags,
          rejectedLines: valid.rejected,
        };
        return { out: { written: true }, value: result };
      });
    } catch (error) {
      status = 'failed';
      const reason = error instanceof Error ? error.message : String(error);
      steps.push({ name: 'error', status: 'failed', ms: 0, in: {}, out: { error: reason } });
      log(`run failed: ${reason}`);
    }

    const run: Run = { runId, trigger, status, startedAt: new Date(startedAt).toISOString(), finishedAt: new Date(this.now()).toISOString(), steps, output, notice: NOTICE };
    this.store.save(run);
    log(`run finished with status ${status}`);
    return run;
  }
}
