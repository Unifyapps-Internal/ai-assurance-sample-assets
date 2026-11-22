// Starts each asset on its port with the stub model, calls health, the manifest and one real path, prints a
// table, and stops everything it started. Exit code 1 when any check misses its expectation.
// Usage: node scripts/smoke.mjs            (all eight)
//        node scripts/smoke.mjs e2 e5      (only the named assets)
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const venvPython = join(root, '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
const python = process.env.FLEET_PYTHON || (existsSync(venvPython) ? venvPython : 'python3');
const node = process.execPath;
const vite = join(root, 'node_modules/vite/bin/vite.js');

const chat = (message) => async (call) => {
  const { status, body } = await call('POST', '/api/chat', { message });
  return { ok: status === 200 && typeof body.answer === 'string' && body.answer.length > 0, note: `chat ${status}, ${body.toolCalls?.length ?? 0} tool call(s)` };
};
const run = (input) => async (call) => {
  const { status, body } = await call('POST', '/api/run', { trigger: 'manual', input });
  return { ok: status === 200 && Array.isArray(body.steps) && body.steps.length > 0, note: `run ${status}, ${body.status}, ${body.steps?.length ?? 0} steps` };
};
const summary = (dir) => async (call) => {
  const user = JSON.parse(readFileSync(join(root, 'assets', dir, 'fixtures/users.json'), 'utf8'))[0];
  const login = await call('POST', '/api/login', { username: user.username, password: user.password });
  const cookie = (login.headers.get('set-cookie') ?? '').split(';')[0];
  const list = await call('GET', '/api/records?page=1', undefined, { cookie });
  const id = list.body.items?.[0]?.id;
  const made = await call('POST', '/api/ai/summary', { id }, { cookie });
  const ok = login.status === 200 && list.status === 200 && made.status === 200 && typeof made.body.summary === 'string';
  return { ok, note: `login ${login.status} (${user.role}), records ${list.status}, summary ${made.status}` };
};

const assets = [
  { id: 'e1', dir: 'e1-collections-assistant', port: 4101, start: [python, ['-m', 'collections_assistant']], manifest: 200, real: chat('What do we hold on Al Ruwad Contracting Group?') },
  { id: 'e2', dir: 'e2-onboarding-helper', port: 4102, start: [node, ['--import', 'tsx', 'src/server.ts']], manifest: 200, real: chat('What do we hold on Al Ruwad Contracting Group?') },
  { id: 'e3', dir: 'e3-sector-research', port: 4103, start: [node, ['--import', 'tsx', 'src/server.ts']], manifest: 404, real: chat('How is the construction sector doing?') },
  { id: 'e4', dir: 'e4-application-scoring', port: 4104, start: [python, ['-m', 'application_scoring']], manifest: 200, real: run({ limit: 1 }) },
  { id: 'e5', dir: 'e5-statement-reconciliation', port: 4105, start: [node, ['--import', 'tsx', 'src/server.ts']], manifest: 200, real: run({}) },
  { id: 'e6', dir: 'e6-sme-onboarding-portal', port: 4106, build: true, start: [node, ['--import', 'tsx', 'server/server.ts']], manifest: 200, real: summary('e6-sme-onboarding-portal') },
  { id: 'e7', dir: 'e7-guarantee-tracker', port: 4107, build: true, start: [node, ['--import', 'tsx', 'server/server.ts']], manifest: 200, real: summary('e7-guarantee-tracker') },
  { id: 'e8', dir: 'e8-rm-workspace', port: 4108, build: true, start: [node, ['--import', 'tsx', 'server/server.ts']], manifest: 200, real: summary('e8-rm-workspace') },
];

async function waitForHealth(base, child, output) {
  for (let attempt = 0; attempt < 120; attempt++) {
    if (child.exitCode !== null) throw new Error(`exited with code ${child.exitCode}: ${output().slice(-300)}`);
    try {
      const response = await fetch(`${base}/api/health`, { signal: AbortSignal.timeout(2000) });
      if (response.ok) return response.json();
    } catch {
      // not listening yet
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error('no answer from /api/health within 30 s');
}

async function smoke(asset) {
  const cwd = join(root, 'assets', asset.dir);
  const row = { asset: asset.dir, port: asset.port, health: '-', manifest: '-', 'real path': '-', gate: '-', result: 'FAIL' };
  if (asset.build) {
    const built = spawnSync(node, [vite, 'build'], { cwd, encoding: 'utf8' });
    if (built.status !== 0) return { ...row, 'real path': `vite build failed: ${built.stderr.slice(-200)}` };
  }
  const env = { ...process.env, PORT: String(asset.port), FLEET_MODEL: 'stub', GEMINI_API_KEY: '', UNIFYAPPS_COLLECTOR_ENDPOINT: '', PYTHONIOENCODING: 'utf-8' };
  const child = spawn(asset.start[0], asset.start[1], { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let captured = '';
  child.stdout.on('data', (chunk) => (captured += chunk));
  child.stderr.on('data', (chunk) => (captured += chunk));
  const base = `http://127.0.0.1:${asset.port}`;
  const call = async (method, path, body, headers = {}) => {
    const response = await fetch(base + path, {
      method,
      headers: { 'content-type': 'application/json', ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(30000),
    });
    const text = await response.text();
    let parsed = {};
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = {};
    }
    return { status: response.status, headers: response.headers, body: parsed };
  };
  try {
    const health = await waitForHealth(base, child, () => captured);
    row.health = health.ok === true && health.asset === asset.dir ? '200 ok' : 'unexpected body';
    row.gate = health.gate?.installed ? `policy v${health.gate.policyVersion}` : 'none';
    const manifest = await call('GET', '/assurance.json');
    const manifestOk = manifest.status === asset.manifest && (asset.manifest !== 200 || manifest.body.id === asset.dir);
    row.manifest = `${manifest.status}${asset.manifest === 404 ? ' (none, as designed)' : ''}`;
    const real = await asset.real(call);
    row['real path'] = real.note;
    row.result = row.health === '200 ok' && manifestOk && real.ok ? 'pass' : 'FAIL';
  } catch (error) {
    row['real path'] = `error: ${error instanceof Error ? error.message : String(error)}`;
  } finally {
    child.kill();
    await new Promise((resolve) => (child.exitCode !== null ? resolve() : child.once('exit', resolve)));
  }
  return row;
}

const wanted = process.argv.slice(2);
const rows = [];
for (const asset of assets.filter((a) => wanted.length === 0 || wanted.includes(a.id))) rows.push(await smoke(asset));

const columns = Object.keys(rows[0] ?? {});
const widths = columns.map((c) => Math.max(c.length, ...rows.map((r) => String(r[c]).length)));
const line = (cells) => `| ${cells.map((cell, i) => String(cell).padEnd(widths[i])).join(' | ')} |`;
console.log(line(columns));
console.log(line(widths.map((w) => '-'.repeat(w))));
for (const row of rows) console.log(line(columns.map((c) => row[c])));
const failed = rows.filter((r) => r.result !== 'pass').length;
console.log(`\n${rows.length - failed} of ${rows.length} assets passed the smoke check (stub model, no model API called).`);
process.exit(failed === 0 ? 0 : 1);
