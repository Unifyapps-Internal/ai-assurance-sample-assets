import type { ServerResponse } from 'node:http';
import type { Gate } from '../vendor/gate/index.js';
import { HttpError } from './http.js';
import type { Model } from './model.js';
import type { Session } from './session.js';

/** What a route handler receives once the request has a valid session. */
export interface Context {
  res: ServerResponse;
  url: URL;
  body: Record<string, unknown>;
  session: Session;
  gate: Gate;
  model: Model | null;
}

export function requireRole(session: Session, roles: readonly string[]): void {
  if (!roles.includes(session.role)) throw new HttpError(403, 'your role may not open this');
}
