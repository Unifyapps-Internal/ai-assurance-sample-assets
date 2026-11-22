// Runs the Python suites (gate-py, E1, E4) and the ruff checks with the fleet's virtual environment.
// Usage: node scripts/pytest.mjs [extra pytest arguments]
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const venvPython = join(root, '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
const python = process.env.FLEET_PYTHON || (existsSync(venvPython) ? venvPython : 'python3');
const run = (args) => spawnSync(python, args, { cwd: root, stdio: 'inherit', env: { ...process.env, PYTHONIOENCODING: 'utf-8' } }).status ?? 1;

const failed = [
  ['-m', 'pytest', ...process.argv.slice(2)],
  ['-m', 'ruff', 'check', '.'],
  ['-m', 'ruff', 'format', '--check', '.'],
].filter((args) => run(args) !== 0);
process.exit(failed.length === 0 ? 0 : 1);
