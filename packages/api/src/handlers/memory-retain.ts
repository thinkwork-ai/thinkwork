/**
 * Internal Lambda handler — receives memory retain requests from the runtime
 * and routes them through the normalized memory
 * layer.
 *
 * The active engine (AgentCore managed memory) ingests each conversational
 * turn via `adapter.retainTurn` and runs its own background extraction. The
 * attempt ledger in Aurora records every retain so failures retry.
 *
 * Cutover compatibility accepts the legacy agent-scoped messages payload while
 * runtime callers roll forward.
 */

import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { getDb } from "@thinkwork/database-pg";
import { agents, messages } from "@thinkwork/database-pg/schema";
import { getMemoryServices } from "../lib/memory/index.js";
import { isReflectExhaustMetadata } from "../lib/memory/eval-traffic.js";

import {
  buildRetainSourceEventKey,
  claimRetainAttempt,
  classifyRetainError,
  listDueRetainAttempts,
  markRetainAttemptFailed,
  markRetainAttemptRetained,
  sweepExhaustedRunningAttempts,
  upsertRetainAttempt,
  type RetainAttemptRow,
} from "../lib/memory/retain-attempts.js";

type RetainMessage = {
  role?: string;
  content?: string;
  timestamp?: string;
};

type MemoryRetainEvent = {
  tenantId?: string;
  userId?: string;
  agentId?: string;
  threadId?: string;
  threadTurnId?: string;
  spaceId?: string;
  messages?: RetainMessage[];
  transcript?: RetainMessage[];
  kind?: string;
  date?: string;
  content?: string;
  limit?: number;
  metadata?: Record<string, unknown>;
};

type MemoryRetainResult = {
  ok: boolean;
  engine?: string;
  error?: string;
  processed?: number;
  retained?: number;
  failed?: number;
  attemptId?: string;
};

type NormalizedMessage = {
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: string;
};

export async function handler(
  event: MemoryRetainEvent,
): Promise<MemoryRetainResult> {
  if (event?.kind === "drain_due") {
    return drainDueRetainAttempts(event.limit);
  }

  if (!event?.tenantId) {
    console.warn("[memory-retain] MISSING_USER_CONTEXT missing tenantId");
    return { ok: false, error: "MISSING_USER_CONTEXT" };
  }

  // Snapshot identity-bearing fields at handler entry so any downstream env
  // shadowing or mutation does not affect the resolved owner. Mirrors the
  // runtime-side `feedback_completion_callback_snapshot_pattern`.
  const tenantId = event.tenantId;
  const eventThreadId = event.threadId;
  const eventKind = event.kind;
  const eventDate = event.date;
  const eventContent = event.content;
  const eventMetadata = event.metadata;
  const eventTranscript = event.transcript;
  const eventLegacyMessages = event.messages;
  const eventAgentId = event.agentId;
  const eventThreadTurnId =
    event.threadTurnId || stringField(eventMetadata?.threadTurnId);
  const eventSpaceId = event.spaceId || stringField(eventMetadata?.spaceId);

  try {
    const userId =
      event.userId || (await resolveUserIdFromAgent(tenantId, eventAgentId));
    if (!userId) {
      console.warn("[memory-retain] MISSING_USER_CONTEXT", {
        hasUserId: !!event.userId,
        hasAgentId: !!eventAgentId,
      });
      return { ok: false, error: "MISSING_USER_CONTEXT" };
    }
    if (!event.userId && eventAgentId) {
      console.warn(
        "[memory-retain] legacy agentId payload resolved to userId",
        {
          tenantId,
          agentId: eventAgentId,
          userId,
        },
      );
    }

    const { adapter, config } = getMemoryServices();
    const owner = {
      tenantId,
      ownerType: "user" as const,
      ownerId: userId,
    };

    if (!eventThreadId) {
      console.warn("[memory-retain] MISSING_DOCUMENT_ID missing threadId");
      return { ok: false, error: "MISSING_DOCUMENT_ID" };
    }

    // THINK-261 #2 — non-knowledge traffic is suppressed at the door, before
    // the retain-attempt ledger, so nothing is stored and nothing retries.
    //
    // Smoke threads are synthetic (`smoke-<timestamp>-<random>`, never a DB
    // row) and previously planted fixture facts in real user banks on every
    // post-deploy run. Suppressing here rather than eval-tagging the smoke
    // payload keeps pi-marco-smoke's `expectRetain` assertion intact — the
    // client-side invoke still happens; the handler declines the content.
    if (eventThreadId.startsWith("smoke-")) {
      console.log(
        `[memory-retain] suppressed_smoke_thread thread=${eventThreadId} tenant=${tenantId}`,
      );
      return { ok: true, engine: "suppressed_smoke" };
    }
    // Reflect-exhaust turns are memory questions — their assistant content is
    // synthesized from existing memories and must not re-enter the banks.
    if (isReflectExhaustMetadata(eventMetadata)) {
      console.log(
        `[memory-retain] suppressed_reflect_exhaust thread=${eventThreadId} tenant=${tenantId}`,
      );
      return { ok: true, engine: "suppressed_reflect_exhaust" };
    }

    const sourceEventKey = buildRetainSourceEventKey({
      tenantId,
      userId,
      threadId: eventThreadId,
      kind: eventKind,
      date: eventDate,
      content: eventContent,
      transcript: eventTranscript || eventLegacyMessages || [],
      metadata: eventMetadata,
    });
    const attempt = await upsertRetainAttempt({
      tenantId,
      userId,
      spaceId: eventSpaceId || null,
      threadId: eventThreadId,
      threadTurnId: eventThreadTurnId || null,
      sourceEventKey,
      sourceEventType: "thread_turn",
      provider: adapter.kind,
      metadata: buildAttemptMetadata(event, {
        userId,
        sourceEventKey,
        retryPayload: buildRetryPayload(event, userId),
      }),
    });
    const claimed = await claimRetainAttempt(attempt.id);
    if (!claimed) {
      return { ok: true, engine: "skipped", attemptId: attempt.id };
    }

    return processClaimedRetainAttempt(event, claimed, {
      tenantId,
      userId,
      engine: config.engine,
      adapter,
      eventThreadId,
      eventMetadata,
      eventTranscript,
      eventLegacyMessages,
    });
  } catch (err) {
    const msg = (err as Error)?.message || String(err);
    console.error(`[memory-retain] failed: ${msg}`);
    return { ok: false, error: msg };
  }
}

async function processClaimedRetainAttempt(
  event: MemoryRetainEvent,
  attempt: RetainAttemptRow,
  context: {
    tenantId: string;
    userId: string;
    engine: string;
    adapter: ReturnType<typeof getMemoryServices>["adapter"];
    eventThreadId: string;
    eventMetadata?: Record<string, unknown>;
    eventTranscript?: RetainMessage[];
    eventLegacyMessages?: RetainMessage[];
  },
): Promise<MemoryRetainResult> {
  const started = Date.now();
  const {
    tenantId,
    userId,
    engine,
    adapter,
    eventThreadId,
    eventMetadata,
    eventTranscript,
    eventLegacyMessages,
  } = context;
  const owner = {
    tenantId,
    ownerType: "user" as const,
    ownerId: userId,
  };
  try {
    const eventMessages = normalizeMessages(
      eventTranscript || eventLegacyMessages || [],
    );

    if (eventMessages.length === 0) {
      throw new Error("no_content");
    }
    if (eventLegacyMessages && !eventTranscript) {
      console.warn("[memory-retain] legacy messages payload converted", {
        tenantId,
        userId,
        threadId: eventThreadId,
      });
    }
    await adapter.retainTurn({
      ...owner,
      threadId: eventThreadId,
      messages: eventMessages,
      metadata: eventMetadata,
    });
    console.log(
      `[memory-retain] engine=${engine} retainTurn tenant=${tenantId} ` +
        `user=${userId} thread=${eventThreadId} messages=${eventMessages.length}`,
    );
    await markRetainAttemptRetained(attempt.id, {
      backendLatencyMs: Date.now() - started,
      providerDocumentId: eventThreadId,
      providerResult: {
        engine,
        adapterKind: adapter.kind,
        messageCount: eventMessages.length,
      },
      metadata: mergeAttemptMetadata(attempt.metadata, {
        eventMessageCount: eventMessages.length,
        retainedAt: new Date().toISOString(),
      }),
    });

    return { ok: true, engine, attemptId: attempt.id };
  } catch (err) {
    const classification = classifyRetainError(err);
    const status = await markRetainAttemptFailed(attempt, classification, {
      backendLatencyMs: Date.now() - started,
      metadata: mergeAttemptMetadata(attempt.metadata, {
        failedAt: new Date().toISOString(),
        failedStatus: classification.status,
      }),
    });
    console.error(
      `[memory-retain] attempt=${attempt.id} status=${status} failed: ${classification.errorMessage}`,
    );
    return {
      ok: false,
      engine,
      error: classification.errorMessage,
      attemptId: attempt.id,
    };
  }
}

async function drainDueRetainAttempts(limit = 25): Promise<MemoryRetainResult> {
  const swept = await sweepExhaustedRunningAttempts();
  if (swept > 0) {
    console.warn(
      `[memory-retain] drain swept ${swept} exhausted running attempt(s) to dead_lettered`,
    );
  }
  const due = await listDueRetainAttempts({ limit });
  let retained = 0;
  let failed = 0;
  for (const row of due) {
    const claimed = await claimRetainAttempt(row.id);
    if (!claimed) continue;
    const retryPayload = readRetryPayload(claimed.metadata);
    if (!retryPayload) {
      await markRetainAttemptFailed(
        claimed,
        {
          status: "dead_lettered",
          retryable: false,
          errorClass: "missing_retry_payload",
          errorMessage: "memory retain attempt missing retry payload",
        },
        { metadata: mergeAttemptMetadata(claimed.metadata, {}) },
      );
      failed += 1;
      continue;
    }

    const { adapter, config } = getMemoryServices();
    const result = await processClaimedRetainAttempt(retryPayload, claimed, {
      tenantId: retryPayload.tenantId || claimed.tenant_id,
      userId: retryPayload.userId || claimed.user_id || "",
      engine: config.engine,
      adapter,
      eventThreadId: retryPayload.threadId || claimed.thread_id,
      eventMetadata: retryPayload.metadata,
      eventTranscript: retryPayload.transcript,
      eventLegacyMessages: retryPayload.messages,
    });
    if (result.ok) retained += 1;
    else failed += 1;
  }

  return { ok: failed === 0, processed: retained + failed, retained, failed };
}

async function resolveUserIdFromAgent(
  tenantId: string,
  agentId?: string,
): Promise<string | null> {
  if (!agentId) return null;
  const db = getDb();
  const [row] = await db
    .select({ userId: agents.human_pair_id })
    .from(agents)
    .where(and(eq(agents.id, agentId), eq(agents.tenant_id, tenantId)))
    .limit(1);
  if (!row?.userId) {
    throw new Error("MISSING_USER_CONTEXT");
  }
  return row.userId;
}

function normalizeMessages(messages: RetainMessage[]): NormalizedMessage[] {
  const now = new Date().toISOString();
  return messages
    .filter((m) => typeof m.content === "string" && m.content.trim().length > 0)
    .map((m) => ({
      role: (m.role === "assistant" || m.role === "system"
        ? m.role
        : "user") as "user" | "assistant" | "system",
      content: m.content!.trim(),
      timestamp: m.timestamp || now,
    }));
}

function buildAttemptMetadata(
  event: MemoryRetainEvent,
  input: {
    userId: string;
    sourceEventKey: string;
    retryPayload: MemoryRetainEvent;
  },
): Record<string, unknown> {
  const transcript = event.transcript || event.messages || [];
  return {
    ...(event.metadata || {}),
    sourceEventKey: input.sourceEventKey,
    retryPayload: input.retryPayload,
    eventMessageCount: transcript.length,
    eventContentBytes: transcript.reduce(
      (sum, message) => sum + (message.content || "").length,
      0,
    ),
    userId: input.userId,
  };
}

function buildRetryPayload(
  event: MemoryRetainEvent,
  userId: string,
): MemoryRetainEvent {
  return {
    tenantId: event.tenantId,
    userId,
    threadId: event.threadId,
    threadTurnId:
      event.threadTurnId || stringField(event.metadata?.threadTurnId),
    spaceId: event.spaceId || stringField(event.metadata?.spaceId),
    transcript: boundedMessages(event.transcript),
    messages: event.transcript ? undefined : boundedMessages(event.messages),
    metadata: event.metadata,
  };
}

function readRetryPayload(metadata: unknown): MemoryRetainEvent | null {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return null;
  }
  const retryPayload = (metadata as { retryPayload?: unknown }).retryPayload;
  if (
    !retryPayload ||
    typeof retryPayload !== "object" ||
    Array.isArray(retryPayload)
  ) {
    return null;
  }
  const payload = retryPayload as MemoryRetainEvent;
  if (!payload.tenantId || !payload.threadId) return null;
  if (!payload.userId) return null;
  return payload;
}

function mergeAttemptMetadata(
  current: unknown,
  next: Record<string, unknown>,
): Record<string, unknown> {
  const base =
    current && typeof current === "object" && !Array.isArray(current)
      ? (current as Record<string, unknown>)
      : {};
  return { ...base, ...next };
}

function boundedMessages(
  messages: RetainMessage[] | undefined,
): RetainMessage[] {
  if (!messages || messages.length === 0) return [];
  return messages.slice(-24).map((message) => ({
    role: message.role,
    timestamp: message.timestamp,
    content:
      typeof message.content === "string"
        ? message.content.slice(0, 4000)
        : undefined,
  }));
}

function stringField(value: unknown): string {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

// Relocated to lib so non-handler pipelines (document-artifact ingest) share
// the single definition; re-exported here for existing importers.
export { isEvalTrafficMetadata } from "../lib/memory/eval-traffic.js";
