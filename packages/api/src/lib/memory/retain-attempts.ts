import { createHash } from "node:crypto";

import { and, asc, eq, inArray, isNull, lte, or, sql } from "drizzle-orm";
import { getDb } from "@thinkwork/database-pg";
import {
  memoryRetainAttempts,
  type MemoryRetainAttemptStatus,
} from "@thinkwork/database-pg/schema";

export type RetainAttemptRow = typeof memoryRetainAttempts.$inferSelect;

export type UpsertRetainAttemptInput = {
  tenantId: string;
  userId?: string | null;
  spaceId?: string | null;
  threadId: string;
  threadTurnId?: string | null;
  sourceEventKey: string;
  sourceEventType?: string;
  provider?: string;
  metadata?: Record<string, unknown> | null;
};

export type RetainFailureClassification = {
  status: Extract<
    MemoryRetainAttemptStatus,
    "failed_timeout" | "failed_backend" | "dead_lettered"
  >;
  retryable: boolean;
  errorClass: string;
  errorMessage: string;
};

const RETRYABLE_STATUSES = [
  "queued",
  "failed_timeout",
  "failed_backend",
] as const;

const DEFAULT_MAX_ATTEMPTS = 5;
const MAX_ERROR_MESSAGE_CHARS = 500;

export function buildRetainSourceEventKey(input: {
  tenantId: string;
  userId?: string | null;
  threadId: string;
  kind?: string;
  date?: string;
  content?: string;
  transcript?: Array<{ role?: string; content?: string; timestamp?: string }>;
  metadata?: Record<string, unknown>;
}): string {
  const explicit = stringField(input.metadata?.sourceEventKey);
  if (explicit) return explicit;

  const threadTurnId =
    stringField(input.metadata?.threadTurnId) ||
    stringField(input.metadata?.thread_turn_id);
  if (threadTurnId) return `thread-turn:${threadTurnId}`;

  const hash = createHash("sha256")
    .update(input.tenantId)
    .update("\0")
    .update(input.userId || "")
    .update("\0")
    .update(input.threadId)
    .update("\0")
    .update(input.kind || "thread_turn")
    .update("\0")
    .update(input.date || "")
    .update("\0")
    .update(input.content || "")
    .update("\0")
    .update(
      JSON.stringify(
        (input.transcript || []).map((message) => ({
          role: message.role || "",
          content: message.content || "",
          timestamp: message.timestamp || "",
        })),
      ),
    )
    .digest("hex")
    .slice(0, 32);

  return `thread:${input.threadId}:${hash}`;
}

export function classifyRetainError(err: unknown): RetainFailureClassification {
  const message = errorMessage(err);
  const lower = message.toLowerCase();
  const httpStatus = parseHindsightStatus(message);

  if (
    lower.includes("timeout") ||
    lower.includes("timed out") ||
    lower.includes("aborted") ||
    lower.includes("aborterror")
  ) {
    return {
      status: "failed_timeout",
      retryable: true,
      errorClass: "timeout",
      errorMessage: truncateError(message),
    };
  }

  if (httpStatus && httpStatus >= 400 && httpStatus < 500) {
    return {
      status: "dead_lettered",
      retryable: false,
      errorClass: `hindsight_${httpStatus}`,
      errorMessage: truncateError(message),
    };
  }

  if (
    (httpStatus && httpStatus >= 500) ||
    lower.includes("fetch failed") ||
    lower.includes("econn") ||
    lower.includes("enotfound") ||
    lower.includes("etimedout")
  ) {
    return {
      status: "failed_backend",
      retryable: true,
      errorClass: httpStatus ? `hindsight_${httpStatus}` : "transport",
      errorMessage: truncateError(message),
    };
  }

  return {
    status: "failed_backend",
    retryable: true,
    errorClass: "unknown",
    errorMessage: truncateError(message),
  };
}

export function nextRetryAt(
  attemptCount: number,
  now: Date = new Date(),
): Date {
  const delaysSeconds = [30, 120, 300, 900, 1800];
  const delay = delaysSeconds[Math.max(0, Math.min(attemptCount - 1, 4))];
  return new Date(now.getTime() + delay * 1000);
}

export async function upsertRetainAttempt(
  input: UpsertRetainAttemptInput,
): Promise<RetainAttemptRow> {
  const now = new Date();
  const rows = await getDb()
    .insert(memoryRetainAttempts)
    .values({
      tenant_id: input.tenantId,
      user_id: input.userId || null,
      space_id: input.spaceId || null,
      thread_id: input.threadId,
      thread_turn_id: input.threadTurnId || null,
      source_event_key: input.sourceEventKey,
      source_event_type: input.sourceEventType || "thread_turn",
      provider: input.provider || "hindsight",
      status: "queued",
      max_attempts: DEFAULT_MAX_ATTEMPTS,
      next_retry_at: now,
      metadata: input.metadata || null,
      updated_at: now,
    })
    .onConflictDoUpdate({
      target: [
        memoryRetainAttempts.tenant_id,
        memoryRetainAttempts.thread_id,
        memoryRetainAttempts.source_event_key,
      ],
      set: {
        user_id: input.userId || null,
        space_id: input.spaceId || null,
        thread_turn_id: input.threadTurnId || null,
        metadata: input.metadata || null,
        updated_at: now,
      },
    })
    .returning();

  const row = rows[0];
  if (!row) throw new Error("memory_retain_attempt_upsert_failed");
  return row;
}

export async function claimRetainAttempt(
  attemptId: string,
  options: { lockedBy?: string; now?: Date } = {},
): Promise<RetainAttemptRow | null> {
  const now = options.now ?? new Date();
  const rows = await getDb()
    .update(memoryRetainAttempts)
    .set({
      status: "running",
      attempt_count: sql`${memoryRetainAttempts.attempt_count} + 1`,
      locked_at: now,
      locked_by: options.lockedBy || "memory-retain",
      started_at: sql`COALESCE(${memoryRetainAttempts.started_at}, ${now})`,
      updated_at: now,
    })
    .where(
      and(
        eq(memoryRetainAttempts.id, attemptId),
        inArray(memoryRetainAttempts.status, [...RETRYABLE_STATUSES]),
        or(
          isNull(memoryRetainAttempts.next_retry_at),
          lte(memoryRetainAttempts.next_retry_at, now),
        ),
        sql`${memoryRetainAttempts.attempt_count} < ${memoryRetainAttempts.max_attempts}`,
      ),
    )
    .returning();

  return rows[0] ?? null;
}

export async function listDueRetainAttempts(
  options: { limit?: number; now?: Date } = {},
): Promise<RetainAttemptRow[]> {
  const now = options.now ?? new Date();
  return getDb()
    .select()
    .from(memoryRetainAttempts)
    .where(
      and(
        inArray(memoryRetainAttempts.status, [...RETRYABLE_STATUSES]),
        or(
          isNull(memoryRetainAttempts.next_retry_at),
          lte(memoryRetainAttempts.next_retry_at, now),
        ),
        sql`${memoryRetainAttempts.attempt_count} < ${memoryRetainAttempts.max_attempts}`,
      ),
    )
    .orderBy(asc(memoryRetainAttempts.next_retry_at))
    .limit(options.limit ?? 25);
}

export async function markRetainAttemptRetained(
  attemptId: string,
  input: {
    backendLatencyMs?: number;
    providerDocumentId?: string | null;
    providerResult?: Record<string, unknown> | null;
    metadata?: Record<string, unknown> | null;
    now?: Date;
  } = {},
): Promise<void> {
  const now = input.now ?? new Date();
  await getDb()
    .update(memoryRetainAttempts)
    .set({
      status: "retained",
      next_retry_at: null,
      locked_at: null,
      locked_by: null,
      finished_at: now,
      backend_latency_ms: input.backendLatencyMs,
      provider_document_id: input.providerDocumentId || null,
      provider_result: input.providerResult || null,
      error_class: null,
      error_message: null,
      metadata: input.metadata || null,
      updated_at: now,
    })
    .where(eq(memoryRetainAttempts.id, attemptId));
}

export async function markRetainAttemptFailed(
  attempt: Pick<RetainAttemptRow, "id" | "attempt_count" | "max_attempts">,
  classification: RetainFailureClassification,
  input: {
    backendLatencyMs?: number;
    metadata?: Record<string, unknown> | null;
    now?: Date;
  } = {},
): Promise<MemoryRetainAttemptStatus> {
  const now = input.now ?? new Date();
  const exhausted = attempt.attempt_count >= attempt.max_attempts;
  const status =
    classification.retryable && !exhausted
      ? classification.status
      : "dead_lettered";

  await getDb()
    .update(memoryRetainAttempts)
    .set({
      status,
      next_retry_at:
        status === "dead_lettered"
          ? null
          : nextRetryAt(attempt.attempt_count, now),
      locked_at: null,
      locked_by: null,
      finished_at: now,
      backend_latency_ms: input.backendLatencyMs,
      error_class: classification.errorClass,
      error_message: classification.errorMessage,
      metadata: input.metadata || null,
      updated_at: now,
    })
    .where(eq(memoryRetainAttempts.id, attempt.id));

  return status;
}

function stringField(value: unknown): string {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function truncateError(message: string): string {
  return message.slice(0, MAX_ERROR_MESSAGE_CHARS);
}

function parseHindsightStatus(message: string): number | null {
  const match = message.match(/\bhindsight\s+\w+\s+(\d{3})\b/i);
  if (!match) return null;
  const status = Number(match[1]);
  return Number.isFinite(status) ? status : null;
}
