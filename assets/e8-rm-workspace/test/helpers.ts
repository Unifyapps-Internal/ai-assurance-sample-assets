import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Handler } from '../server/app.js';

export interface FixtureUser {
  username: string;
  password: string;
  role: string;
  displayName: string;
}

export const fixtures = JSON.parse(readFileSync(new URL('../fixtures/users.json', import.meta.url), 'utf8')) as FixtureUser[];
export const readJsonFile = <T>(name: string): T => JSON.parse(readFileSync(new URL(`../${name}`, import.meta.url), 'utf8')) as T;
export const readText = (name: string): string => readFileSync(new URL(`../${name}`, import.meta.url), 'utf8');

export interface Reply {
  status: number;
  body: Record<string, any>;
  headers: Headers;
}

export interface Client {
  get(path: string, cookie?: string): Promise<Reply>;
  post(path: string, body: unknown, cookie?: string): Promise<Reply>;
  /** Signs in as the fixture user with this role and returns the Cookie header value. */
  login(role: string): Promise<string>;
  close(): Promise<void>;
}

export async function serve(handler: Handler): Promise<Client> {
  const server: Server = createServer((req, res) => void handler(req, res));
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const call = async (path: string, init: RequestInit, cookie?: string): Promise<Reply> => {
    const response = await fetch(base + path, { ...init, headers: { ...(init.headers ?? {}), ...(cookie ? { cookie } : {}) } });
    return { status: response.status, body: (await response.json().catch(() => ({}))) as Record<string, any>, headers: response.headers };
  };
  const post = (path: string, body: unknown, cookie?: string) =>
    call(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }, cookie);
  return {
    get: (path, cookie) => call(path, { method: 'GET' }, cookie),
    post,
    async login(role) {
      const user = fixtures.find((u) => u.role === role);
      if (!user) throw new Error(`no fixture user with role ${role}`);
      const reply = await post('/api/login', { username: user.username, password: user.password });
      const cookie = reply.headers.get('set-cookie')?.split(';')[0];
      if (reply.status !== 200 || !cookie) throw new Error(`login failed for ${role}`);
      return cookie;
    },
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
