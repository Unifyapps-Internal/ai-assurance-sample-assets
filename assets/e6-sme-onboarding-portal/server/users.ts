import { scryptSync, timingSafeEqual } from 'node:crypto';
import { readFileSync } from 'node:fs';

export interface StoredUser {
  username: string;
  displayName: string;
  role: string;
  salt: string;
  hash: string;
}

export type PublicUser = Pick<StoredUser, 'username' | 'displayName' | 'role'>;

export const hashPassword = (password: string, salt: string): string => scryptSync(password, Buffer.from(salt, 'hex'), 32).toString('hex');

const users = JSON.parse(readFileSync(new URL('../data/users.json', import.meta.url), 'utf8')) as StoredUser[];

/** The user when the password matches its stored scrypt hash, otherwise null. */
export function authenticate(username: unknown, password: unknown): PublicUser | null {
  if (typeof username !== 'string' || typeof password !== 'string') return null;
  const user = users.find((u) => u.username === username);
  const hash = Buffer.from(hashPassword(password, user?.salt ?? '00'), 'hex');
  const stored = Buffer.from(user?.hash ?? '', 'hex');
  if (!user || hash.length !== stored.length || !timingSafeEqual(hash, stored)) return null;
  return { username: user.username, displayName: user.displayName, role: user.role };
}

export function listUsers(): PublicUser[] {
  return users.map(({ username, displayName, role }) => ({ username, displayName, role }));
}
