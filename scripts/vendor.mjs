// Copies the gate and the shared data each asset needs into assets/<asset>/vendor/, so every asset folder
// deploys on its own. The copies are committed; scripts/vendor.test.ts fails when one drifts from its source.
// Usage: node scripts/vendor.mjs            (all assets; run `npm run vendor` to build gate-node first)
//        node scripts/vendor.mjs e1 e4      (only the named assets)
//        node scripts/vendor.mjs --check    (exit 1 when a vendored file differs from its source)
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

/** What each asset carries. gate: 'node' | 'py' | null; data: shared-data file names without .json. */
export const manifest = {
  'e1-collections-assistant': { gate: 'py', data: ['smes', 'loan_applications', 'repayments', 'guarantees'] },
  'e2-onboarding-helper': { gate: 'node', data: ['smes', 'loan_applications', 'guarantees'] },
  'e3-sector-research': { gate: null, data: ['smes', 'loan_applications', 'sectors'] },
  'e4-application-scoring': { gate: null, data: ['loan_applications', 'sectors'] },
  'e5-statement-reconciliation': { gate: null, data: ['repayments', 'statement_lines', 'loan_applications', 'sectors', 'currencies'] },
  'e6-sme-onboarding-portal': { gate: null, data: ['smes', 'loan_applications', 'sectors', 'regions'] },
  'e7-guarantee-tracker': { gate: 'node', data: ['guarantees', 'smes', 'sectors', 'regions'] },
  'e8-rm-workspace': { gate: 'node', data: ['smes', 'loan_applications', 'sectors', 'regions'] },
};

const gateSources = {
  node: { from: join(root, 'packages/gate-node/dist'), to: 'gate', keep: (name) => name.endsWith('.js') || name.endsWith('.d.ts') },
  py: { from: join(root, 'packages/gate-py/assurance_gate'), to: 'assurance_gate', keep: (name) => name.endsWith('.py') },
};

/** Pairs of [source file, vendored file] for one asset. */
export function plan(asset) {
  const entry = manifest[asset];
  const vendor = join(root, 'assets', asset, 'vendor');
  const pairs = entry.data.map((name) => [join(root, 'packages/shared-data/data', `${name}.json`), join(vendor, 'shared-data', `${name}.json`)]);
  if (entry.gate) {
    const source = gateSources[entry.gate];
    if (!existsSync(source.from)) throw new Error(`${relative(root, source.from)} does not exist; build the gate first`);
    for (const name of readdirSync(source.from)) {
      if (statSync(join(source.from, name)).isFile() && source.keep(name)) pairs.push([join(source.from, name), join(vendor, source.to, name)]);
    }
  }
  return pairs;
}

/** Vendored files that differ from, or lack, their source. */
export function drift(assets = Object.keys(manifest)) {
  const stale = [];
  for (const asset of assets) {
    for (const [from, to] of plan(asset)) {
      if (!existsSync(to) || !readFileSync(from).equals(readFileSync(to))) stale.push(relative(root, to).replaceAll('\\', '/'));
    }
  }
  return stale;
}

function vendor(asset) {
  const entry = manifest[asset];
  const target = join(root, 'assets', asset, 'vendor');
  for (const dir of ['shared-data', 'gate', 'assurance_gate']) rmSync(join(target, dir), { recursive: true, force: true });
  const pairs = plan(asset);
  for (const [from, to] of pairs) {
    mkdirSync(dirname(to), { recursive: true });
    cpSync(from, to);
  }
  console.log(`${asset}: ${pairs.length} files (gate: ${entry.gate ?? 'none'})`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const args = process.argv.slice(2);
  const wanted = args.filter((a) => !a.startsWith('--'));
  const assets = Object.keys(manifest).filter((id) => wanted.length === 0 || wanted.some((w) => id.startsWith(w)));
  if (args.includes('--check')) {
    const stale = drift(assets);
    if (stale.length > 0) {
      console.error(`vendored copies out of date:\n${stale.join('\n')}`);
      process.exit(1);
    }
    console.log('vendored copies are up to date');
  } else {
    assets.forEach(vendor);
  }
}
