import { ADMIN_ROLES } from '../config.js';
import { requireRole } from '../context.js';
import type { Context } from '../context.js';
import { NOTICE, sendJson } from '../http.js';
import { listUsers } from '../users.js';

/** GET /api/admin/users */
export function adminUsers(ctx: Context): void {
  requireRole(ctx.session, ADMIN_ROLES);
  sendJson(ctx.res, 200, { users: listUsers(), notice: NOTICE });
}
