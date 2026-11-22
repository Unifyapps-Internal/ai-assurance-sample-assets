import { REPORT_ROLES } from '../config.js';
import { requireRole } from '../context.js';
import type { Context } from '../context.js';
import { NOTICE, sendJson } from '../http.js';
import { buildReport } from '../records.js';

/** GET /api/reports */
export function reports(ctx: Context): void {
  requireRole(ctx.session, REPORT_ROLES);
  sendJson(ctx.res, 200, { groups: buildReport(), notice: NOTICE });
}
