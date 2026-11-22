import { createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import { cookie } from './http.js';

export const COOKIE = 'sid';
const LIFETIME_SECONDS = 8 * 60 * 60;

export interface Session {
  id: string;
  username: string;
  displayName: string;
  role: string;
  expires: number;
}

/** Stateless sessions: the cookie is the session, signed with SESSION_SECRET (random per process when absent). */
export class Sessions {
  private readonly secret: string;

  constructor(secret?: string) {
    this.secret = secret || randomBytes(32).toString('hex');
  }

  private mac(payload: string): string {
    return createHmac('sha256', this.secret).update(payload).digest('base64url');
  }

  issue(user: { username: string; displayName: string; role: string }, now = Date.now()): string {
    const session: Session = { id: randomUUID(), ...user, expires: now + LIFETIME_SECONDS * 1000 };
    const payload = Buffer.from(JSON.stringify(session), 'utf8').toString('base64url');
    return `${COOKIE}=${payload}.${this.mac(payload)}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${LIFETIME_SECONDS}`;
  }

  clear(): string {
    return `${COOKIE}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`;
  }

  read(req: IncomingMessage, now = Date.now()): Session | null {
    const [payload, mac] = (cookie(req, COOKIE) ?? '').split('.');
    if (!payload || !mac) return null;
    const expected = Buffer.from(this.mac(payload));
    const given = Buffer.from(mac);
    if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
    try {
      const session = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as Session;
      return session.expires > now ? session : null;
    } catch {
      return null;
    }
  }
}
