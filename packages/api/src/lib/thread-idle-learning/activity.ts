import { and, eq, sql } from "drizzle-orm";
import { getDb } from "@thinkwork/database-pg";
import {
  scheduledJobs,
  threadIdleLearningState,
} from "@thinkwork/database-pg/schema";
import { invokeJobScheduleManager } from "../../graphql/utils.js";

export const THREAD_IDLE_MEMORY_LEARNING_TRIGGER_TYPE =
  "thread_idle_memory_learning";
export const THREAD_IDLE_MEMORY_LEARNING_DELAY_MINUTES = 15;

type ActivitySource =
  | "user_message"
  | "assistant_response"
  | "attachment_finalized"
  | "approval_decision"
  | "tool_result";

export type RecordThreadActivityForIdleLearningInput = {
  tenantId: string;
  threadId: string;
  computerId?: string | null;
  requesterUserId?: string | null;
  source: ActivitySource;
  occurredAt?: Date;
};

export type RecordThreadActivityForIdleLearningResult =
  | {
      ok: true;
      skipped?: false;
      stateId: string;
      scheduledJobId: string;
      activitySequence: number;
      scheduledFor: Date;
    }
  | { ok: true; skipped: true; reason: string }
  | { ok: false; error: string };

export async function recordThreadActivityForIdleLearning(
  input: RecordThreadActivityForIdleLearningInput,
): Promise<RecordThreadActivityForIdleLearningResult> {
  if (!isRequesterIdleMemoryLearningEnabled()) {
    return { ok: true, skipped: true, reason: "feature_disabled" };
  }
  if (!input.computerId) {
    return { ok: true, skipped: true, reason: "thread_has_no_computer" };
  }
  if (!input.requesterUserId) {
    return { ok: true, skipped: true, reason: "requester_user_required" };
  }

  const db = getDb();
  const occurredAt = input.occurredAt ?? new Date();
  const scheduledFor = new Date(
    occurredAt.getTime() + THREAD_IDLE_MEMORY_LEARNING_DELAY_MINUTES * 60_000,
  );
  const scheduleExpression = eventBridgeAtExpression(scheduledFor);

  const state = await upsertIdleLearningState({
    ...input,
    occurredAt,
    scheduledFor,
  });
  const scheduledJobId = await ensureIdleLearningScheduledJob({
    tenantId: input.tenantId,
    threadId: input.threadId,
    computerId: input.computerId,
    requesterUserId: input.requesterUserId,
    activitySequence: state.activitySequence,
    lastActivityAt: occurredAt,
    scheduledFor,
  });

  await db
    .update(threadIdleLearningState)
    .set({
      scheduled_job_id: scheduledJobId,
      updated_at: new Date(),
    })
    .where(eq(threadIdleLearningState.id, state.id));

  const config = idleLearningScheduleConfig({
    threadId: input.threadId,
    computerId: input.computerId,
    requesterUserId: input.requesterUserId,
    activitySequence: state.activitySequence,
    lastActivityAt: occurredAt,
    scheduledFor,
    source: input.source,
  });
  await db
    .update(scheduledJobs)
    .set({
      name: `Thread idle memory learning ${input.threadId.slice(0, 8)}`,
      description:
        "Internal one-time trigger for requester-scoped Thread memory learning.",
      config,
      schedule_type: "at",
      schedule_expression: scheduleExpression,
      timezone: "UTC",
      enabled: true,
      updated_at: new Date(),
    })
    .where(eq(scheduledJobs.id, scheduledJobId));

  const scheduleResult = await invokeJobScheduleManager("PUT", {
    triggerId: scheduledJobId,
    scheduleType: "at",
    scheduleExpression,
    timezone: "UTC",
    enabled: true,
    config,
  });
  if (!scheduleResult.ok) return { ok: false, error: scheduleResult.error };

  return {
    ok: true,
    stateId: state.id,
    scheduledJobId,
    activitySequence: state.activitySequence,
    scheduledFor,
  };
}

export function isRequesterIdleMemoryLearningEnabled(): boolean {
  const configured = process.env.REQUESTER_IDLE_MEMORY_LEARNING_ENABLED;
  if (configured === undefined || configured.trim() === "") return true;
  return ["1", "true", "yes", "on"].includes(configured.trim().toLowerCase());
}

export function eventBridgeAtExpression(date: Date): string {
  return `at(${date.toISOString().replace(/\.\d{3}Z$/, "")})`;
}

function idleLearningScheduleConfig(input: {
  threadId: string;
  computerId: string;
  requesterUserId: string;
  activitySequence: number;
  lastActivityAt: Date;
  scheduledFor: Date;
  source: ActivitySource;
}) {
  return {
    internal: true,
    threadId: input.threadId,
    computerId: input.computerId,
    requesterUserId: input.requesterUserId,
    activitySequence: input.activitySequence,
    lastActivityAt: input.lastActivityAt.toISOString(),
    scheduledFor: input.scheduledFor.toISOString(),
    source: input.source,
  };
}

async function upsertIdleLearningState(input: {
  tenantId: string;
  threadId: string;
  computerId?: string | null;
  requesterUserId?: string | null;
  occurredAt: Date;
  scheduledFor: Date;
}) {
  const db = getDb();
  const result = await db.execute(sql`
    INSERT INTO ${threadIdleLearningState} (
      tenant_id,
      thread_id,
      computer_id,
      requester_user_id,
      activity_sequence,
      last_activity_at,
      scheduled_for,
      status,
      created_at,
      updated_at
    )
    VALUES (
      ${input.tenantId}::uuid,
      ${input.threadId}::uuid,
      ${input.computerId}::uuid,
      ${input.requesterUserId}::uuid,
      1,
      ${input.occurredAt.toISOString()}::timestamptz,
      ${input.scheduledFor.toISOString()}::timestamptz,
      'idle_scheduled',
      now(),
      now()
    )
    ON CONFLICT (thread_id) DO UPDATE SET
      computer_id = EXCLUDED.computer_id,
      requester_user_id = EXCLUDED.requester_user_id,
      activity_sequence = ${threadIdleLearningState.activity_sequence} + 1,
      last_activity_at = EXCLUDED.last_activity_at,
      scheduled_for = EXCLUDED.scheduled_for,
      status = 'idle_scheduled',
      updated_at = now()
    RETURNING id, activity_sequence
  `);
  const row = result.rows?.[0] as
    | { id: string; activity_sequence: number | string }
    | undefined;
  if (!row) throw new Error("failed to upsert idle-learning state");
  return {
    id: row.id,
    activitySequence: Number(row.activity_sequence),
  };
}

async function ensureIdleLearningScheduledJob(input: {
  tenantId: string;
  threadId: string;
  computerId: string;
  requesterUserId: string;
  activitySequence: number;
  lastActivityAt: Date;
  scheduledFor: Date;
}): Promise<string> {
  const db = getDb();
  const config = idleLearningScheduleConfig({
    ...input,
    source: "user_message",
  });
  const result = await db.execute(sql`
    INSERT INTO ${scheduledJobs} (
      tenant_id,
      trigger_type,
      computer_id,
      name,
      description,
      config,
      schedule_type,
      schedule_expression,
      timezone,
      enabled,
      created_by_type,
      created_at,
      updated_at
    )
    VALUES (
      ${input.tenantId}::uuid,
      ${THREAD_IDLE_MEMORY_LEARNING_TRIGGER_TYPE},
      ${input.computerId}::uuid,
      ${`Thread idle memory learning ${input.threadId.slice(0, 8)}`},
      'Internal one-time trigger for requester-scoped Thread memory learning.',
      ${JSON.stringify(config)}::jsonb,
      'at',
      ${eventBridgeAtExpression(input.scheduledFor)},
      'UTC',
      true,
      'system',
      now(),
      now()
    )
    ON CONFLICT DO NOTHING
    RETURNING id
  `);
  const inserted = result.rows?.[0] as { id: string } | undefined;
  if (inserted?.id) return inserted.id;

  const [existing] = await db
    .select({ id: scheduledJobs.id })
    .from(scheduledJobs)
    .where(
      and(
        eq(scheduledJobs.tenant_id, input.tenantId),
        eq(
          scheduledJobs.trigger_type,
          THREAD_IDLE_MEMORY_LEARNING_TRIGGER_TYPE,
        ),
        sql`${scheduledJobs.config}->>'threadId' = ${input.threadId}`,
      ),
    )
    .limit(1);
  if (!existing)
    throw new Error("failed to resolve idle-learning scheduled job");
  return existing.id;
}
