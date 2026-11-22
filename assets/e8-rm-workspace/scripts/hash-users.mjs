// Rebuilds data/users.json (scrypt hashes, what the server reads) from fixtures/users.json (test credentials).
import { randomBytes, scryptSync } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';

const fixtures = JSON.parse(readFileSync(new URL('../fixtures/users.json', import.meta.url), 'utf8'));
const stored = fixtures.map(({ username, password, role, displayName }) => {
  const salt = randomBytes(16).toString('hex');
  return { username, displayName, role, salt, hash: scryptSync(password, Buffer.from(salt, 'hex'), 32).toString('hex') };
});
writeFileSync(new URL('../data/users.json', import.meta.url), `${JSON.stringify(stored, null, 2)}\n`);
console.log(`data/users.json written for ${stored.length} users`);
