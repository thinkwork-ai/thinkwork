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

/** Default cooldown (minutes) between sentinel escalations (THINK-233). */
export const CANVAS_REFRESH_SENTINEL_DEFAULT_COOLDOWN_MINUTES = 360;

/** The only sentinel mode defined in v1. */
export const CANVAS_REFRESH_SENTINEL_DEFAULT_MODE = "any_change" as const;

/**
 * Opt-in material-shift sentinel config (THINK-233), persisted on the
 * `scheduled_jobs.config.sentinel` slice of a canvas_refresh job. `lastAlertAt`
 * is stamped back by job-trigger after each escalation and is NOT part of the
 * creation input.
 */
export interface CanvasRefreshSentinelInput {
  enabled: boolean;
  /** Escalation policy; defaults to "any_change". */
  mode?: string | null;
  /** Minutes between escalations; floored + defaulted server-side. */
  cooldownMinutes?: number | null;
  /** Extra guidance appended to the generated re-narration prompt. */
  prompt?: string | null;
}

/** Normalized sentinel config as stored on the job (THINK-233). */
export interface CanvasRefreshSentinelConfig {
  enabled: boolean;
  mode: string;
  cooldownMinutes: number;
  prompt?: string;
}

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
  /** THINK-233: optional material-shift sentinel (omit → refresh only). */
  sentinel?: CanvasRefreshSentinelInput | null;
}

/**
 * Normalize a raw sentinel input into the stored config, or `null` when the
 * sentinel is absent/disabled (a disabled sentinel is stored as nothing so the
 * schedule is byte-identical to a pre-THINK-233 refresh-only schedule). The
 * cooldown is floored at 0 and defaulted; an unrecognized mode falls back to
 * "any_change".
 */
export function normalizeSentinelConfig(
  input: CanvasRefreshSentinelInput | null | undefined,
): CanvasRefreshSentinelConfig | null {
  if (!input || input.enabled !== true) return null;
  const rawCooldown =
    typeof input.cooldownMinutes === "number" &&
    Number.isFinite(input.cooldownMinutes)
      ? Math.max(0, Math.floor(input.cooldownMinutes))
      : CANVAS_REFRESH_SENTINEL_DEFAULT_COOLDOWN_MINUTES;
  const mode =
    typeof input.mode === "string" && input.mode.trim().length > 0
      ? input.mode.trim()
      : CANVAS_REFRESH_SENTINEL_DEFAULT_MODE;
  const prompt =
    typeof input.prompt === "string" && input.prompt.trim().length > 0
      ? input.prompt.trim()
      : undefined;
  return {
    enabled: true,
    mode,
    cooldownMinutes: rawCooldown,
    ...(prompt ? { prompt } : {}),
  };
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
  const sentinel = normalizeSentinelConfig(input.sentinel);
  const config = {
    internal: true,
    product: "canvas_refresh",
    artifactId: input.artifactId,
    partId: input.partId ?? null,
    // THINK-233: only present when the sentinel is enabled, so refresh-only
    // schedules keep their exact pre-sentinel config shape.
    ...(sentinel ? { sentinel } : {}),
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
