/**
 * Living Artifacts (THINK-145 U7): canvas refresh-schedule creation.
 *
 * Creates a `scheduled_jobs` row with the `canvas_refresh` trigger type and
 * provisions its EventBridge schedule (via the job-schedule-manager Lambda),
 * following the `schedule-binding.ts` conventions. `job-trigger`'s
 * `canvas_refresh` branch (U6/U7) fires it on the interval, invoking the
 * canvas-refresh Lambda.
 *
 * Conservative guardrails (Outstanding Questions — implementer's constants):
 *   - a 15-minute minimum interval floor, and
 *   - a per-tenant cap on active canvas-refresh schedules.
 *
 * NOTE on `rate()` semantics: AWS Scheduler `rate(N minutes)` fires every N
 * minutes counted from CREATION time + interval — not aligned to wall-clock
 * boundaries. Callers that need clock alignment must use a cron expression
 * (not exposed here in v1).
 */

import { GraphQLError } from "graphql";
import { count } from "drizzle-orm";
import {
  and,
  db,
  eq,
  invokeJobScheduleManager,
  scheduledJobs,
} from "../../graphql/utils.js";

/** The scheduled-jobs `trigger_type` for a headless canvas data-refresh. */
export const CANVAS_REFRESH_TRIGGER_TYPE = "canvas_refresh" as const;

/** Minimum refresh interval — a conservative floor on re-invoke frequency. */
export const CANVAS_REFRESH_MIN_INTERVAL_MINUTES = 15;

/** Max ACTIVE canvas-refresh schedules per tenant — bounds background fan-out. */
export const CANVAS_REFRESH_MAX_SCHEDULES_PER_TENANT = 200;

export interface CreateCanvasRefreshScheduleInput {
  tenantId: string;
  artifactId: string;
  /** Optional: refresh only this part's bindings. */
  partId?: string | null;
  /** Interval in minutes; floored at CANVAS_REFRESH_MIN_INTERVAL_MINUTES. */
  intervalMinutes: number;
  spaceId?: string | null;
  /** Acting user id (null → created_by system). */
  actorId?: string | null;
  name?: string | null;
}

export interface CreateCanvasRefreshScheduleResult {
  scheduledJobId: string;
  scheduleExpression: string;
}

/**
 * Create + provision a canvas refresh schedule. Enforces the interval floor and
 * the per-tenant cap BEFORE any write, then inserts the row and provisions the
 * EventBridge schedule; a provisioning failure rolls the row back so no
 * unprovisioned schedule is left behind.
 */
export async function createCanvasRefreshSchedule(
  input: CreateCanvasRefreshScheduleInput,
): Promise<CreateCanvasRefreshScheduleResult> {
  const interval = Math.floor(input.intervalMinutes);
  if (
    !Number.isFinite(interval) ||
    interval < CANVAS_REFRESH_MIN_INTERVAL_MINUTES
  ) {
    throw new GraphQLError(
      `Canvas refresh interval must be at least ${CANVAS_REFRESH_MIN_INTERVAL_MINUTES} minutes`,
      { extensions: { code: "BAD_USER_INPUT" } },
    );
  }

  // Per-tenant cap on ACTIVE canvas-refresh schedules.
  const [{ value: active } = { value: 0 }] = await db
    .select({ value: count() })
    .from(scheduledJobs)
    .where(
      and(
        eq(scheduledJobs.tenant_id, input.tenantId),
        eq(scheduledJobs.trigger_type, CANVAS_REFRESH_TRIGGER_TYPE),
        eq(scheduledJobs.enabled, true),
      ),
    );
  if ((active ?? 0) >= CANVAS_REFRESH_MAX_SCHEDULES_PER_TENANT) {
    throw new GraphQLError(
      `Tenant has reached the canvas refresh schedule cap (${CANVAS_REFRESH_MAX_SCHEDULES_PER_TENANT})`,
      { extensions: { code: "BAD_USER_INPUT" } },
    );
  }

  const scheduleExpression = `rate(${interval} minutes)`;
  const name = input.name?.trim() || "Canvas data refresh";
  const config = {
    internal: true,
    product: "canvas_refresh",
    artifactId: input.artifactId,
    partId: input.partId ?? null,
  };

  const [row] = await db
    .insert(scheduledJobs)
    .values({
      tenant_id: input.tenantId,
      trigger_type: CANVAS_REFRESH_TRIGGER_TYPE,
      space_id: input.spaceId ?? null,
      name,
      config,
      schedule_type: "rate",
      schedule_expression: scheduleExpression,
      timezone: "UTC",
      enabled: true,
      created_by_type: input.actorId ? "user" : "system",
      created_by_id: input.actorId ?? null,
    })
    .returning({ id: scheduledJobs.id });

  const result = await invokeJobScheduleManager("POST", {
    triggerId: row.id,
    tenantId: input.tenantId,
    triggerType: CANVAS_REFRESH_TRIGGER_TYPE,
    spaceId: input.spaceId ?? undefined,
    name,
    scheduleType: "rate",
    scheduleExpression,
    timezone: "UTC",
    config,
    createdByType: input.actorId ? "user" : "system",
    enabled: true,
  });

  if (!result.ok) {
    // Roll back so we never leave an unprovisioned scheduled_jobs row.
    await db.delete(scheduledJobs).where(eq(scheduledJobs.id, row.id));
    throw new GraphQLError(
      `Canvas refresh schedule could not be provisioned: ${result.error}`,
      { extensions: { code: "INTERNAL_SERVER_ERROR" } },
    );
  }

  return { scheduledJobId: row.id, scheduleExpression };
}
