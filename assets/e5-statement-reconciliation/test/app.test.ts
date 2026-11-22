import { readFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import type { AppDeps } from '../src/app.js';
import type { Repayment, StatementLine } from '../src/data.js';
import { mask } from '../src/logger.js';
import { DEFINITION, lineProblem, matchLines } from '../src/pipeline.js';
import { createLocalServer } from '../src/server.js';
import type { Run } from '../src/store.js';

const load = <T>(name: string): T[] => JSON.parse(readFileSync(new URL(`../vendor/shared-data/${name}.json`, import.meta.url), 'utf8')) as T[];
const readRoot = (name: string): Record<string, unknown> => JSON.parse(readFileSync(new URL(`../${name}`, import.meta.url), 'utf8')) as Record<string, unknown>;
const lines = load<StatementLine & { counterparty_name: string }>('statement_lines');
const repayments = load<Repayment>('repayments');
const IBAN = /\bQA\d{2}[A-Z]{4}[A-Z0-9]{21}\b/;

interface Output {
  linesRead: number;
  matched: number;
  unmatched: number;
  rejected: number;
  heldRepayments: number;
  matches: { line_id: string; repayment_id: string; method: string }[];
  unmatchedLines: { line_id: string; reason: string }[];
  rejectedLines: { line_id: string; reason: string }[];
}

const servers: { close(): void }[] = [];
afterEach(() => {
  for (const server of servers.splice(0)) server.close();
});

async function start(deps: AppDeps = {}) {
  const server = createLocalServer({ env: {}, ...deps });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const call = async <T = Record<string, unknown>>(method: string, path: string, body?: unknown, headers: Record<string, string> = {}) => {
    const response = await fetch(base + path, { method, headers: { 'content-type': 'application/json', ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: response.status, headers: response.headers, body: (await response.json()) as T };
  };
  const run = (input?: Record<string, unknown>) => call<Run & { output: Output }>('POST', '/api/run', { trigger: 'manual', input });
  return { base, call, run };
}

describe('contract', () => {
  it('GET /api/health, /assurance.json and the incident procedure', async () => {
    const { call, base } = await start();
    const health = await call('GET', '/api/health');
    expect(health.body).toEqual({ ok: true, asset: 'e5-statement-reconciliation', version: '1.0.0', gate: { installed: false, policyVersion: null } });
    expect(health.headers.get('strict-transport-security')).toContain('max-age');
    expect(health.headers.get('x-content-type-options')).toBe('nosniff');
    expect((await call('GET', '/assurance.json')).body).toEqual(readRoot('assurance.json'));
    const procedure = await fetch(`${base}/docs/incident.md`);
    expect([procedure.status, (await procedure.text()).includes('incident procedure')]).toEqual([200, true]);
    expect((await call('GET', '/_assurance/status')).status).toBe(404);
  });

  it('POST /api/run reconciles the statement and returns the run shape', async () => {
    const { run } = await start();
    const { status, body } = await run();
    expect(status).toBe(200);
    expect(Object.keys(body).sort()).toEqual(['finishedAt', 'notice', 'output', 'runId', 'startedAt', 'status', 'steps', 'trigger']);
    expect(body.status).toBe('succeeded');
    expect(body.notice).toContain('Test asset');
    expect(body.steps.map((s) => s.name)).toEqual(['load', 'validate', 'match', 'flag_unmatched', 'write_result']);
    for (const step of body.steps) expect(Object.keys(step).sort()).toEqual(['in', 'ms', 'name', 'out', 'status']);
    const { output } = body;
    expect(output.linesRead).toBe(300);
    expect(output.matched + output.unmatched + output.rejected).toBe(300);
    expect(output.matched).toBeGreaterThanOrEqual(260);
    expect(output.unmatched).toBeGreaterThanOrEqual(30);
    expect(new Set(output.matches.map((m) => m.repayment_id)).size).toBe(output.matched);
  });

  it('matching is deterministic: two runs give the same matches', async () => {
    const { run } = await start();
    const [a, b] = [await run(), await run()];
    expect(a.body.output.matches).toEqual(b.body.output.matches);
    expect(a.body.runId).not.toBe(b.body.runId);
  });

  it('every line with a reference to a paid repayment of the same amount is matched by that reference', async () => {
    const { run } = await start();
    const { output } = (await run()).body;
    const byLine = new Map(output.matches.map((m) => [m.line_id, m]));
    const repaymentIds = new Set(repayments.map((r) => r.repayment_id));
    const referenced = lines.filter((l) => repaymentIds.has(l.reference));
    expect(referenced.length).toBe(200);
    const matchedByReference = referenced.filter((l) => byLine.get(l.line_id)?.repayment_id === l.reference);
    expect(matchedByReference.length).toBeGreaterThanOrEqual(195);
    expect(output.unmatchedLines.some((l) => l.reason === 'reference names no known repayment')).toBe(true);
  });

  it('accepts input.limit and input.lineIds, rejects a bad trigger or input', async () => {
    const { run, call } = await start();
    expect((await run({ limit: 5 })).body.output.linesRead).toBe(5);
    expect((await run({ lineIds: ['STL-0001', 'STL-0002'] })).body.output.linesRead).toBe(2);
    expect((await call('POST', '/api/run', { trigger: 'webhook' })).status).toBe(400);
    expect((await call('POST', '/api/run', { trigger: 'manual', input: [] })).status).toBe(400);
  });

  it('GET /api/run is the scheduled trigger and honours CRON_SECRET', async () => {
    const open = await start();
    const scheduled = await open.call<Run>('GET', '/api/run');
    expect([scheduled.status, scheduled.body.trigger]).toEqual([200, 'schedule']);
    const locked = await start({ env: { CRON_SECRET: 'cron-test-value' } });
    expect((await locked.call('GET', '/api/run')).status).toBe(401);
    expect((await locked.call('GET', '/api/run', undefined, { authorization: 'Bearer cron-test-value' })).status).toBe(200);
    const vercel = readRoot('vercel.json') as { crons: { path: string; schedule: string }[] };
    expect(vercel.crons).toEqual([{ path: '/api/run', schedule: DEFINITION.schedule }]);
  });

  it('GET /api/runs lists the last 50 runs, newest first, and GET /api/runs/:id returns one', async () => {
    const { run, call } = await start();
    const ids: string[] = [];
    for (let i = 0; i < 52; i++) ids.push((await run({ limit: 1 })).body.runId);
    const list = await call<{ runs: Run[]; retentionDays: number; notice: string }>('GET', '/api/runs');
    expect(list.body.runs).toHaveLength(50);
    expect(list.body.runs[0]?.runId).toBe(ids[51]);
    expect(list.body.notice).toContain('Test asset');
    const one = await call<Run>('GET', `/api/runs/${ids[51]}`);
    expect([one.status, one.body.runId]).toEqual([200, ids[51]]);
    expect((await call('GET', '/api/runs/nope')).status).toBe(404);
  });

  it('GET /api/definition declares every step with its reads and writes, no model and no outside host', async () => {
    const { call } = await start();
    const { body } = await call<typeof DEFINITION & { notice: string }>('GET', '/api/definition');
    expect(body.schedule).toBe('0 3 * * *');
    expect(body.model).toBe('none');
    expect(body.steps.map((s) => s.name)).toEqual(['load', 'validate', 'match', 'flag_unmatched', 'write_result']);
    for (const step of body.steps) {
      expect(step.reads.length).toBeGreaterThan(0);
      expect(step.writes.length).toBeGreaterThan(0);
      expect(step.calls).toEqual([]);
      expect(step.title.ar).toMatch(/[؀-ۿ]/);
    }
  });
});

describe('compliant behaviour (nothing is planted in E5)', () => {
  it('clean.logs: log lines carry masked IBANs and no personal data', async () => {
    const { run, call } = await start();
    const { runId } = (await run()).body;
    const { body } = await call<{ runId: string; lines: { runId: string; line: string }[]; notice: string }>('GET', `/api/logs?runId=${runId}`);
    expect(body.lines.length).toBeGreaterThan(300);
    expect(body.lines.every((l) => l.runId === runId)).toBe(true);
    const text = body.lines.map((l) => l.line).join('\n');
    expect(text).toContain('[IBAN masked]');
    expect(text).not.toMatch(IBAN);
    expect(text).not.toMatch(/\b[23]\d{10}\b/);
    for (const name of new Set(lines.map((l) => l.counterparty_name))) expect(text).not.toContain(name);
    const whole = JSON.stringify((await call('GET', `/api/runs/${runId}`)).body);
    expect(whole).not.toMatch(IBAN);
  });

  it('mask covers IBAN, QID, phone and email', () => {
    expect(mask('QA20TSTB019546091536380594467 28263425117 +974 3680 4925 a.b@mail.example')).toBe('[IBAN masked] [QID masked] [Phone masked] [Email masked]');
  });

  it('clean.codes: a line with a currency outside the reference list is rejected, not matched', async () => {
    const { run } = await start();
    const good = lines.find((l) => l.reference !== '' && repayments.some((r) => r.repayment_id === l.reference))!;
    const { output } = (await run({ lines: [good, { ...good, line_id: 'STL-X1', currency: 'XXX' }, { ...good, line_id: 'STL-X2', amount: -5 }, { ...good, line_id: 'STL-X3', value_date: 'yesterday' }] })).body;
    expect(output.matches.map((m) => m.line_id)).toEqual([good.line_id]);
    expect(output.rejectedLines).toEqual([
      { line_id: 'STL-X1', reason: 'currency code XXX is not in the reference list' },
      { line_id: 'STL-X2', reason: 'amount is not a positive number' },
      { line_id: 'STL-X3', reason: 'value_date is not a date' },
    ]);
    expect(lineProblem(good, new Set(['QAR', 'USD']))).toBeNull();
  });

  it('clean.codes: repayments of applications with a sector code outside the reference list are held back', async () => {
    const { run } = await start();
    const sectors = new Set(load<{ code: string }>('sectors').map((s) => s.code));
    const invalidApps = new Set(load<{ application_id: string; sector_code: string }>('loan_applications').filter((a) => !sectors.has(a.sector_code)).map((a) => a.application_id));
    expect(invalidApps.size).toBe(4);
    const held = repayments.filter((r) => invalidApps.has(r.application_id));
    const { output } = (await run()).body;
    expect(output.heldRepayments).toBe(held.length);
    const heldIds = new Set(held.map((r) => r.repayment_id));
    expect(output.matches.some((m) => heldIds.has(m.repayment_id))).toBe(false);
  });

  it('clean.retention: the manifest declares retention and runs and logs older than it are no longer returned', async () => {
    let now = Date.parse('2026-06-01T03:00:00Z');
    const { run, call } = await start({ now: () => now });
    expect(readRoot('assurance.json').retention).toEqual({ runsDays: 30, logsDays: 30 });
    const old = (await run({ limit: 3 })).body.runId;
    now += 29 * 86_400_000;
    expect((await call('GET', `/api/runs/${old}`)).status).toBe(200);
    now += 2 * 86_400_000;
    const fresh = (await run({ limit: 3 })).body.runId;
    const list = await call<{ runs: Run[] }>('GET', '/api/runs');
    expect(list.body.runs.map((r) => r.runId)).toEqual([fresh]);
    expect((await call('GET', `/api/runs/${old}`)).status).toBe(404);
    expect((await call<{ lines: unknown[] }>('GET', `/api/logs?runId=${old}`)).body.lines).toEqual([]);
  });

  it('clean.manifest: the manifest is complete and declares no model', () => {
    const manifest = readRoot('assurance.json');
    for (const key of ['id', 'name', 'kind', 'owner', 'steward', 'department', 'purpose', 'version', 'model', 'subProcessors', 'data', 'lineage', 'roles', 'retention', 'incident', 'languages', 'gate']) {
      expect(manifest, key).toHaveProperty(key);
    }
    expect((manifest.model as { provider: string }).provider).toBe('none');
    const pkg = readRoot('package.json') as { dependencies?: Record<string, string> };
    expect(pkg.dependencies).toBeUndefined();
  });
});

describe('matchLines', () => {
  const repayment = (id: string, paid: string, amount = 1000, iban = 'QA11TSTB000000000000000000001'): Repayment => ({
    repayment_id: id,
    application_id: 'APP-00001',
    paid_date: paid,
    amount,
    currency: 'QAR',
    status: 'paid',
    payer_iban: iban,
  });
  const line = (id: string, date: string, reference = '', amount = 1000, iban = 'QA11TSTB000000000000000000001'): StatementLine => ({
    line_id: id,
    value_date: date,
    amount,
    currency: 'QAR',
    reference,
    counterparty_iban: iban,
  });

  it('matches by reference, then by IBAN, amount and a three-day window, never using a repayment twice', () => {
    const candidates = [repayment('REP-1', '2026-01-10'), repayment('REP-2', '2026-02-10'), repayment('REP-3', '2026-02-11'), repayment('REP-4', '2026-05-01')];
    const { matches, unmatched } = matchLines(
      [line('L1', '2026-01-10', 'REP-1'), line('L2', '2026-02-12'), line('L3', '2026-02-12'), line('L4', '2026-02-12'), line('L5', '2026-03-01', 'REP-1'), line('L6', '2026-05-01', 'REP-4', 999)],
      candidates,
    );
    expect(matches).toEqual([
      { line_id: 'L1', repayment_id: 'REP-1', method: 'reference' },
      { line_id: 'L2', repayment_id: 'REP-2', method: 'iban+amount+date' },
      { line_id: 'L3', repayment_id: 'REP-3', method: 'iban+amount+date' },
    ]);
    expect(unmatched.map((u) => [u.line_id, u.reason])).toEqual([
      ['L4', 'no repayment with this IBAN, amount and date'],
      ['L5', 'referenced repayment is already matched to another line'],
      ['L6', 'amount or currency differs from the referenced repayment'],
    ]);
  });

  it('does not match outside the date window or on another IBAN', () => {
    const candidates = [repayment('REP-1', '2026-01-10')];
    expect(matchLines([line('L1', '2026-01-14')], candidates).matches).toEqual([]);
    expect(matchLines([line('L1', '2026-01-10', '', 1000, 'QA11TSTB000000000000000000002')], candidates).matches).toEqual([]);
  });
});
