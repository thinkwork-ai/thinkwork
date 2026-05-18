/**
 * deleteScheduledJob — remove a scheduled_jobs row and its EventBridge
 * schedule.
 *
 * Order matters: EventBridge first (via the job-schedule-manager
 * Lambda), then DB. If the Lambda fails, the DB row is preserved so the
 * caller can retry. If the DB delete fails after the EB schedule was
 * already removed, the row will retain a stale `eb_schedule_name` until
 * the reconciler reaps it; the operator can retry the delete and the
 * Lambda's DELETE is idempotent.
 *
 * Auth: `requireAdminOrServiceCaller`. Tenant admins + bare service
 * callers (CLI auto-fallback bearer) may delete jobs; the operation
 * does not stamp a specific user identity, so impersonation is not a
 * concern. Cognito-non-admins are rejected at the gate.
 *
 * Returns a `DeleteScheduledJobResult` rather than a bare boolean so
 * the client can confirm which id was acted on (echoed back) — useful
 * for log lines and tooling that batches deletes.
 */

import type { GraphQLContext } from "../../context.js";
import {
  db,
  eq,
  scheduledJobs,
  invokeJobScheduleManager,
} from "../../utils.js";
import { requireAdminOrServiceCaller } from "../core/authz.js";

export const deleteScheduledJob = async (
  _parent: unknown,
  args: { id: string },
  ctx: GraphQLContext,
): Promise<{ id: string; ok: boolean }> => {
  const [row] = await db
    .select({
      id: scheduledJobs.id,
      tenant_id: scheduledJobs.tenant_id,
      eb_schedule_name: scheduledJobs.eb_schedule_name,
    })
    .from(scheduledJobs)
    .where(eq(scheduledJobs.id, args.id));

  if (!row) {
    // Idempotent: a missing row is "already deleted." Return ok:false so
    // the caller can detect the no-op without an error path.
    return { id: args.id, ok: false };
  }

  await requireAdminOrServiceCaller(ctx, row.tenant_id, "delete_scheduled_job");

  // Deprovision the EventBridge schedule first. The Lambda treats a
  // missing schedule as a no-op (idempotent), so a retry after partial
  // failure is safe.
  if (row.eb_schedule_name) {
    const result = await invokeJobScheduleManager("DELETE", {
      triggerId: row.id,
      tenantId: row.tenant_id,
    });
    if (!result.ok) {
      throw new Error(
        `EventBridge schedule deprovision failed: ${result.error}. The scheduled_jobs row was not deleted; retry to recover.`,
      );
    }
  }

  await db.delete(scheduledJobs).where(eq(scheduledJobs.id, args.id));

  return { id: args.id, ok: true };
};
