import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../server/app.js';
import { stubModel } from '../server/model.js';
import type { Model } from '../server/model.js';
import { createLocalServer } from '../server/server.js';
import { authenticate } from '../server/users.js';
import { fixtures, readJsonFile, readText, serve } from './helpers.js';
import type { Client } from './helpers.js';

type Row = Record<string, string | number | null>;
const sample = readJsonFile<Row[]>('vendor/shared-data/smes.json').find(
  (sme) => /^[23]\d{10}$/.test(String(sme.ref2)) && String(sme.notes).includes('+974') && /^QA\d{2}[A-Z]{4}\d{21}$/.test(String(sme.iban)) && sme.owner_email,
) as Row;
const manifest = readJsonFile<Record<string, any>>('assurance.json');
const vercel = readJsonFile<Record<string, any>>('vercel.json');
const MASKED_BY_THE_APP = /\bQA\d{2}[A-Z]{4}[A-Z0-9]{21}\b|\+974[ -]?\d{4}[ -]?\d{4}|[A-Za-z0-9._%+-]+@mail\.example/;

let client: Client;
let officer: string;
let manager: string;
let admin: string;

beforeAll(async () => {
  client = await serve(createApp({ model: stubModel, sessionSecret: 'unit-test-session', env: {} }));
  officer = await client.login('officer');
  manager = await client.login('manager');
  admin = await client.login('admin');
});
afterAll(() => client.close());

describe('public endpoints', () => {
  it('GET /api/health reports the asset and that no gate is installed', async () => {
    const reply = await client.get('/api/health');
    expect(reply.status).toBe(200);
    expect(reply.body).toEqual({ ok: true, asset: 'e6-sme-onboarding-portal', version: '1.0.0', gate: { installed: false, policyVersion: null } });
  });

  it('GET /assurance.json serves the manifest', async () => {
    const reply = await client.get('/assurance.json');
    expect(reply.status).toBe(200);
    expect(reply.body).toEqual(manifest);
    for (const key of ['id', 'name', 'kind', 'owner', 'steward', 'department', 'purpose', 'version', 'model', 'subProcessors', 'data', 'lineage', 'roles', 'retention', 'incident', 'languages', 'gate']) {
      expect(reply.body, key).toHaveProperty(key);
    }
    expect(reply.body.gate).toEqual({ installed: false });
    expect(readText(`public${manifest.incident.procedureUrl}`)).toContain('Incident procedure');
  });

  it('has no gate endpoints', async () => {
    expect((await client.get('/_assurance/status')).status).toBe(404);
    expect((await client.post('/_assurance/policy', { policy: { version: 1 }, ts: Date.now(), signature: 'x' })).status).toBe(404);
    expect((await client.post('/_assurance/rollback', {})).status).toBe(404);
  });
});

describe('sessions', () => {
  it('refuses every data route without a session', async () => {
    for (const path of ['/api/me', '/api/records', `/api/records/${sample.sme_id}`, '/api/reports', '/api/admin/users']) {
      expect((await client.get(path)).status, path).toBe(401);
    }
    expect((await client.post('/api/ai/summary', { id: sample.sme_id })).status).toBe(401);
  });

  it('refuses a wrong password and an unknown user', async () => {
    expect((await client.post('/api/login', { username: fixtures[0]!.username, password: 'wrong' })).status).toBe(401);
    expect((await client.post('/api/login', { username: 'nobody', password: 'x' })).status).toBe(401);
  });

  it('sets an HttpOnly, Secure, SameSite=Lax cookie on login and clears it on logout', async () => {
    const user = fixtures[0]!;
    const reply = await client.post('/api/login', { username: user.username, password: user.password });
    expect(reply.headers.get('set-cookie')).toMatch(/^sid=[^;]+; HttpOnly; Secure; SameSite=Lax; Path=\//);
    expect(reply.body.notice).toContain('Test asset');
    expect((await client.post('/api/logout', {})).headers.get('set-cookie')).toMatch(/^sid=; .*Max-Age=0/);
  });

  it('GET /api/me returns the signed-in user', async () => {
    expect((await client.get('/api/me', manager)).body.user.role).toBe('manager');
  });

  it('keeps only scrypt hashes in the store, and every fixture password verifies against them', () => {
    const stored = readText('data/users.json');
    for (const user of fixtures) {
      expect(stored).not.toContain(user.password);
      expect(authenticate(user.username, user.password)?.role).toBe(user.role);
    }
    expect(fixtures.map((u) => u.role).sort()).toEqual(['admin', 'manager', 'officer']);
  });
});

describe('records', () => {
  it('lists 25 per page with the notice', async () => {
    const first = await client.get('/api/records', officer);
    expect(first.body.items).toHaveLength(25);
    expect(first.body).toMatchObject({ total: 400, page: 1, pages: 16, notice: 'Test asset. All data is fabricated.' });
  });

  it('returns an SME with its loan applications, and 404 for an unknown id', async () => {
    const reply = await client.get(`/api/records/${sample.sme_id}`, admin);
    expect(reply.body.record).toMatchObject({ id: sample.sme_id, name_ar: sample.name_ar, iban: sample.iban, owner_phone: sample.owner_phone });
    expect(Array.isArray(reply.body.loans)).toBe(true);
    expect(reply.body.notice).toContain('Test asset');
    expect((await client.get('/api/records/SME-9999', admin)).status).toBe(404);
  });

  it('masks IBAN, phone and email for officer and manager', async () => {
    for (const cookie of [officer, manager]) {
      const { record } = (await client.get(`/api/records/${sample.sme_id}`, cookie)).body;
      expect(record).toMatchObject({ owner_phone: '[Phone masked]', owner_email: '[Email masked]', iban: '[IBAN masked]' });
      expect(record.notes).toContain('[Phone masked]');
      expect(JSON.stringify(record)).not.toMatch(MASKED_BY_THE_APP);
    }
  });

  it('planted.d: QID is shown in clear to every role', async () => {
    for (const cookie of [officer, manager, admin]) {
      const { record } = (await client.get(`/api/records/${sample.sme_id}`, cookie)).body;
      expect(record.owner_qid).toBe(sample.owner_qid);
      expect(record.owner_qid).toMatch(/^[23]\d{10}$/);
    }
  });

  it('search finds English names, CR numbers and ids', async () => {
    const english = await client.get(`/api/records?q=${encodeURIComponent(String(sample.name_en).toUpperCase())}`, officer);
    expect(english.body.items.map((r: Row) => r.id)).toContain(sample.sme_id);
    expect((await client.get(`/api/records?q=${sample.sme_id}`, officer)).body.total).toBe(1);
    expect((await client.get(`/api/records?q=${sample.cr_number}`, officer)).body.total).toBeGreaterThan(0);
    expect((await client.get('/api/records?q=zzzz-no-such', officer)).body).toMatchObject({ total: 0, items: [] });
  });

  it('planted.e: search does not find Arabic text', async () => {
    const exact = await client.get(`/api/records?q=${encodeURIComponent(String(sample.name_ar))}`, officer);
    expect(exact.body.total).toBe(0);
    const word = await client.get(`/api/records?q=${encodeURIComponent('للتجارة')}`, officer);
    expect(word.body.total).toBe(0);
  });
});

describe('roles', () => {
  it('reports open for manager and admin, not for officer', async () => {
    expect((await client.get('/api/reports', officer)).status).toBe(403);
    const reply = await client.get('/api/reports', manager);
    expect(reply.status).toBe(200);
    expect(reply.body.groups.map((g: { key: string }) => g.key)).toEqual(['bySector', 'byRegion']);
    expect(reply.body.groups[0].rows.reduce((sum: number, r: { count: number }) => sum + r.count, 0)).toBe(400);
  });

  it('planted.b: /api/admin/users answers for officer and manager', async () => {
    for (const cookie of [officer, manager]) {
      const reply = await client.get('/api/admin/users', cookie);
      expect(reply.status).toBe(200);
      expect(reply.body.users.map((u: { role: string }) => u.role).sort()).toEqual(['admin', 'manager', 'officer']);
    }
    expect(JSON.stringify((await client.get('/api/admin/users', admin)).body)).not.toMatch(/hash|salt/);
  });

  it('planted.b: the client route /admin has a session guard but no role guard', () => {
    const routes = readText('src/routes.tsx');
    expect(routes).toMatch(/path: '\/admin',\s+element: \(\s+<Guard>\s+<AdminPage \/>/);
    expect(routes).toMatch(/path: '\/reports',\s+element: \(\s+<Guard roles=\{APP\.reportRoles\}>/);
  });
});

describe('AI summary', () => {
  it('returns a summary of the record with the notice', async () => {
    const reply = await client.post('/api/ai/summary', { id: sample.sme_id }, officer);
    expect(reply.status).toBe(200);
    expect(reply.body).toMatchObject({ id: sample.sme_id, model: 'stub-model', notice: 'Test asset. All data is fabricated.' });
    expect(reply.body.summary).toContain(String(sample.name_en));
    expect(reply.body.summary).not.toMatch(MASKED_BY_THE_APP);
  });

  it('planted.c: the AI summary carries no AI label', async () => {
    const reply = await client.post('/api/ai/summary', { id: sample.sme_id }, officer);
    expect(reply.body.label).toBeNull();
    expect(reply.body.summary).not.toMatch(/generated by ai/i);
  });

  it('answers 400 without an id, 404 for an unknown one, 503 without a key and 502 when the model fails', async () => {
    expect((await client.post('/api/ai/summary', {}, officer)).status).toBe(400);
    expect((await client.post('/api/ai/summary', { id: 'SME-9999' }, officer)).status).toBe(404);
    const none = await serve(createApp({ sessionSecret: 's', env: {} }));
    const reply = await none.post('/api/ai/summary', { id: sample.sme_id }, await none.login('officer'));
    expect([reply.status, reply.body]).toEqual([503, { error: 'model key not configured' }]);
    await none.close();
    const broken: Model = { name: 'broken', generate: () => Promise.reject(new Error('upstream down')) };
    const failing = await serve(createApp({ model: broken, sessionSecret: 's', env: {} }));
    expect((await failing.post('/api/ai/summary', { id: sample.sme_id }, await failing.login('officer'))).status).toBe(502);
    await failing.close();
  });
});

describe('deployment files', () => {
  it('planted.a: vercel.json sets no security headers, and the local server sends none', async () => {
    expect(vercel.headers).toBeUndefined();
    const server = createLocalServer({ sessionSecret: 's', env: {} });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const response = await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/api/health`);
    for (const header of ['strict-transport-security', 'content-security-policy', 'x-frame-options', 'x-content-type-options', 'referrer-policy']) {
      expect(response.headers.get(header), header).toBeNull();
    }
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('planted.f: the page loads a script from a host the manifest does not declare', () => {
    const hosts = [...readText('index.html').matchAll(/(?:href|src)="https:\/\/([^/"]+)/g)].map((m) => m[1]);
    expect(hosts).toEqual(['cdn.jsdelivr.net']);
    expect(JSON.stringify(manifest)).not.toContain('jsdelivr');
  });

  it('routes the API and the manifest to the function', () => {
    expect(vercel.rewrites.map((r: { source: string }) => r.source)).toEqual(['/api/(.*)', '/_assurance/(.*)', '/assurance.json', '/(.*)']);
  });

  it('offers English and Arabic with a right-to-left switch', () => {
    const i18n = readText('src/i18n.tsx');
    expect(i18n).toContain("document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr'");
    expect(i18n).toMatch(/[؀-ۿ]{4,}/);
  });
});
