import type { Context } from '../context.js';
import { NOTICE, sendJson } from '../http.js';
import { listUsers } from '../users.js';

/** GET /api/admin/users */
export function adminUsers(ctx: Context): void {
  sendJson(ctx.res, 200, { users: listUsers(), notice: NOTICE });
}
