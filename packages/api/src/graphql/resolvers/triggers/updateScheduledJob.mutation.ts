/**
 * updateScheduledJob — partial-update a scheduled_jobs row + propagate
 * to the underlying AWS Scheduler EventBridge schedule.
 *
 * Wire: invoke job-schedule-manager PUT with the input fields. The
 * Lambda handles the dual-side-effect carefully (re-creates the
 * EventBridge schedule when the expression changes; toggles state
 * when only `enabled` changes; updates the DB row in either case),
 * so the resolver stays a thin pass-through. Mirrors the existing
 * `createScheduledJob` resolver which delegates the same way.
 *
 * Auth: `requireAdminOrServiceCaller(ctx, row.tenant_id,
 * "update_scheduled_job")`. Admin-tier mutation that doesn't stamp
 * user identity; bare service callers (CLI auto-fallback) admitted.
 *
 * Returns the refreshed `ScheduledJob` so the caller gets the new
 * `eb_schedule_name`, `next_run_at`, and `updated_at` without a
 * follow-up query.
 */

import type { GraphQLContext } from "../../context.js";
import {
  db,
  eq,
  scheduledJobs,
  snakeToCamel,
  invokeJobScheduleManager,
} from "../../utils.js";
import { requireAdminOrServiceCaller } from "../core/authz.js";

interface UpdateInput {
  name?: string;
  description?: string;
  prompt?: string;
  config?: string | Record<string, unknown> | null;
  scheduleType?: string;
  scheduleExpression?: string;
  timezone?: string;
  enabled?: boolean;
}

export const updateScheduledJob = async (
  _parent: unknown,
  args: { id: string; input: UpdateInput },
  ctx: GraphQLContext,
) => {
  const [row] = await db
    .select({
      id: scheduledJobs.id,
      tenant_id: scheduledJobs.tenant_id,
    })
    .from(scheduledJobs)
    .where(eq(scheduledJobs.id, args.id));

  if (!row) {
    throw new Error(`Scheduled job ${args.id} not found`);
  }

  await requireAdminOrServiceCaller(
    ctx,
    row.tenant_id,
    "update_scheduled_job",
  );

  // Pass through to the manager Lambda. config is AWSJSON-typed in
  // GraphQL → arrives as a JSON string; the Lambda expects an object,
  // so parse here before forwarding. createScheduledJob has the same
  // shape; keep the conversion close to the resolver so the Lambda
  // contract stays uniform.
  const i = args.input;
  const body: Record<string, unknown> = { triggerId: row.id };
  if (i.name !== undefined) body.name = i.name;
  if (i.description !== undefined) body.description = i.description;
  if (i.prompt !== undefined) body.prompt = i.prompt;
  if (i.config !== undefined && i.config !== null) {
    body.config =
      typeof i.config === "string"
        ? (JSON.parse(i.config) as Record<string, unknown>)
        : i.config;
  }
  if (i.scheduleType !== undefined) body.scheduleType = i.scheduleType;
  if (i.scheduleExpression !== undefined) {
    body.scheduleExpression = i.scheduleExpression;
  }
  if (i.timezone !== undefined) body.timezone = i.timezone;
  if (i.enabled !== undefined) body.enabled = i.enabled;

  const result = await invokeJobScheduleManager("PUT", body);
  if (!result.ok) {
    throw new Error(
      `Scheduled job update failed: ${result.error}. Retry — the DB row + EventBridge schedule may be out of sync until success.`,
    );
  }

  const [refreshed] = await db
    .select()
    .from(scheduledJobs)
    .where(eq(scheduledJobs.id, row.id));
  return snakeToCamel(refreshed);
};
