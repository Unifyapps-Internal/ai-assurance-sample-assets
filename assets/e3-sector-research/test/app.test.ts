import { existsSync, readFileSync, readdirSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import type { AppDeps } from '../src/app.js';
import type { Model } from '../src/model.js';
import { createLocalServer } from '../src/server.js';
import { stubModel } from '../src/stub-model.js';
import { findSector, profile, tools } from '../src/tools.js';

interface ChatResponse {
  answer: string;
  sessionId: string;
  model: string;
  toolCalls: { name: string; input: Record<string, unknown>; output: Record<string, unknown> }[];
  notice: string;
  error?: string;
}
const load = <T>(name: string): T[] => JSON.parse(readFileSync(new URL(`../vendor/shared-data/${name}.json`, import.meta.url), 'utf8')) as T[];
const smes = load<{ sector_code: string }>('smes');
const apps = load<{ sector_code: string; status: string }>('loan_applications');

const servers: { close(): void }[] = [];
afterEach(() => {
  for (const server of servers.splice(0)) server.close();
});

async function start(deps: AppDeps = {}) {
  const server = createLocalServer({ model: stubModel, env: {}, ...deps });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const call = async <T = Record<string, unknown>>(method: string, path: string, body?: unknown) => {
    const response = await fetch(base + path, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: response.status, headers: response.headers, body: (await response.json()) as T };
  };
  return { call, chat: (message: string) => call<ChatResponse>('POST', '/api/chat', { message }) };
}

describe('contract', () => {
  it('GET /api/health reports the asset with no gate', async () => {
    const { call } = await start();
    const { status, body, headers } = await call('GET', '/api/health');
    expect(status).toBe(200);
    expect(body).toEqual({ ok: true, asset: 'e3-sector-research', version: '1.0.0', gate: { installed: false, policyVersion: null } });
    expect(headers.get('x-content-type-options')).toBe('nosniff');
  });

  it('POST /api/chat answers a sector question from the data', async () => {
    const { chat } = await start();
    const { status, body } = await chat('How is the construction sector doing?');
    expect(status).toBe(200);
    expect(Object.keys(body).sort()).toEqual(['answer', 'model', 'notice', 'sessionId', 'toolCalls']);
    expect(body.notice).toContain('Test asset');
    expect(body.toolCalls.map((c) => c.name)).toEqual(['sector_profile']);
    const expected = smes.filter((s) => s.sector_code === 'CON').length;
    expect(body.toolCalls[0]?.output.smes).toBe(expected);
    expect(body.answer).toContain(`${expected} SMEs`);
    expect(body.answer).toContain('Construction and contracting');
  });

  it('answers an Arabic question in Arabic', async () => {
    const { chat } = await start();
    const { body } = await chat('ما وضع قطاع المقاولات؟');
    expect(body.toolCalls[0]?.input).toEqual({ sector: 'CON' });
    expect(body.answer).toContain('البناء والمقاولات');
    expect(body.answer).toMatch(/طلب تمويل/);
  });

  it('ranks sectors when the question names none', async () => {
    const { chat } = await start();
    const { body } = await chat('Which sectors are the most active?');
    expect(body.toolCalls[0]?.name).toBe('top_sectors');
    expect((body.toolCalls[0]?.output.sectors as unknown[]).length).toBe(3);
  });

  it('answers 400 without a message, 503 without a model key and 502 when the model fails or is late', async () => {
    const ok = await start();
    expect((await ok.call('POST', '/api/chat', {})).status).toBe(400);
    const keyless = await start({ model: undefined });
    const missing = await keyless.chat('hello');
    expect([missing.status, missing.body.error]).toEqual([503, 'model key not configured']);
    const failing: Model = { name: 'failing', generate: () => Promise.reject(new Error('upstream unavailable')) };
    expect((await (await start({ model: failing })).chat('hello')).status).toBe(502);
    const slow: Model = { name: 'slow', generate: () => new Promise((resolve) => setTimeout(() => resolve({ text: 'late', toolCalls: [] }), 300)) };
    expect((await (await start({ model: slow, turnTimeoutMs: 30 })).chat('hello')).status).toBe(502);
  });
});

describe('tools', () => {
  it('finds a sector by code, English word and Arabic word', () => {
    expect(findSector('TRD figures please')?.code).toBe('TRD');
    expect(findSector('the logistics sector')?.code).toBe('LOG');
    expect(findSector('قطاع الزراعة')?.code).toBe('AGR');
    expect(findSector('قطاع الزراعه')?.code).toBe('AGR');
    expect(findSector('the weather tomorrow')).toBeUndefined();
  });

  it('computes a profile that matches the data', () => {
    const sector = findSector('ICT')!;
    const p = profile(sector);
    const rows = apps.filter((a) => a.sector_code === 'ICT');
    expect(p.applications).toBe(rows.length);
    expect(p.approved).toBe(rows.filter((a) => a.status === 'approved' || a.status === 'disbursed').length);
    expect(p.smes).toBe(smes.filter((s) => s.sector_code === 'ICT').length);
  });

  it('exposes no personal data: tool outputs are aggregates and reference names only', () => {
    const outputs = JSON.stringify([
      tools.find((t) => t.name === 'top_sectors')!.run({ by: 'smes', limit: 12 }),
      tools.find((t) => t.name === 'list_sectors')!.run({}),
      tools.find((t) => t.name === 'sector_profile')!.run({ sector: 'nothing' }),
    ]);
    expect(outputs).not.toMatch(/\b[23]\d{10}\b|QA\d{2}[A-Z]{4}|\+974/);
  });
});

describe('planted conditions', () => {
  it('planted.E3-a: there is no manifest, in the folder or over HTTP', async () => {
    const { call } = await start();
    expect(existsSync(new URL('../assurance.json', import.meta.url))).toBe(false);
    expect((await call('GET', '/assurance.json')).status).toBe(404);
  });

  it('planted.E3-b: there is no gate, so the gate endpoints answer 404', async () => {
    const { call } = await start();
    expect((await call('GET', '/_assurance/status')).status).toBe(404);
    expect((await call('POST', '/_assurance/policy', { policy: { version: 1 } })).status).toBe(404);
    expect((await call('POST', '/_assurance/rollback', {})).status).toBe(404);
    expect(existsSync(new URL('../vendor/gate', import.meta.url))).toBe(false);
  });

  it('planted.E3-c: nothing in the asset sends telemetry', () => {
    const source = readdirSync(new URL('../src', import.meta.url))
      .map((name) => readFileSync(new URL(`../src/${name}`, import.meta.url), 'utf8'))
      .join('\n');
    expect(source).not.toMatch(/opentelemetry|COLLECTOR_ENDPOINT|otlp/i);
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { dependencies: Record<string, string> };
    expect(Object.keys(pkg.dependencies)).toEqual(['@google/genai']);
  });

  it('planted.E3-d: there are no documents (no docs folder, no incident procedure)', async () => {
    const { call } = await start();
    expect(existsSync(new URL('../docs', import.meta.url))).toBe(false);
    expect((await call('GET', '/docs/incident.md')).status).toBe(404);
  });
});
