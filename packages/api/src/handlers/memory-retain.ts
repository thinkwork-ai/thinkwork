/**
 * Internal Lambda handler — receives memory retain requests from the runtime
 * and routes them through the normalized memory
 * layer.
 *
 * For per-thread retain (event.threadId present + adapter.retainConversation
 * available), the handler fetches the canonical transcript from the messages
 * table — filtered by BOTH tenant_id AND thread_id for cross-tenant safety —
 * and merges with the runtime-supplied event.transcript using a
 * longest-suffix-prefix overlap match. This handles both transcript shapes
 * the runtime sends: small (latest pair only) and large (full history +
 * latest pair) without producing duplicate-bloated documents.
 *
 * Cutover compatibility accepts the legacy agent-scoped messages payload while
 * runtime callers roll forward.
 */

import { and, asc, eq } from "drizzle-orm";
import { getDb } from "@thinkwork/database-pg";
import { agents, messages } from "@thinkwork/database-pg/schema";
import { getMemoryServices } from "../lib/memory/index.js";
import {
  buildDailyMemoryRetainOptions,
  buildHighConfidenceFactRetainOptions,
  buildThreadRetainOptions,
} from "../lib/memory/hindsight-retain-params.js";
import {
  extractHighConfidenceFacts,
  type ExtractedHighConfidenceFact,
  type RejectedHighConfidenceFactCandidate,
} from "../lib/memory/high-confidence-facts.js";
import {
  buildRetainSourceEventKey,
  claimRetainAttempt,
  classifyRetainError,
  listDueRetainAttempts,
  markRetainAttemptFailed,
  markRetainAttemptRetained,
  upsertRetainAttempt,
  type RetainAttemptRow,
} from "../lib/memory/retain-attempts.js";
import { maybeEnqueuePostTurnCompile } from "../lib/wiki/enqueue.js";

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

    if (eventKind === "daily" || eventDate || eventContent) {
      if (!eventDate || typeof eventContent !== "string") {
        console.warn(
          "[memory-retain] MISSING_DOCUMENT_ID daily payload missing date/content",
        );
        return { ok: false, error: "MISSING_DOCUMENT_ID" };
      }
      if (!adapter.retainDailyMemory) {
        return { ok: false, error: "retainDailyMemory not supported" };
      }
      await adapter.retainDailyMemory({
        ...owner,
        date: eventDate,
        content: eventContent,
        hindsight: buildDailyMemoryRetainOptions(eventDate),
        metadata: eventMetadata,
      });
      return { ok: true, engine: config.engine };
    }

    if (!eventThreadId) {
      console.warn("[memory-retain] MISSING_DOCUMENT_ID missing threadId");
      return { ok: false, error: "MISSING_DOCUMENT_ID" };
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

    // Per-thread upsert path: when the adapter supports retainConversation
    // AND we have a threadId, fetch the canonical full transcript from the
    // messages table and merge with the event tail before calling the
    // adapter. This survives the messages-commit-vs-Lambda-fire race.
    if (adapter.retainConversation) {
      let dbMessages: NormalizedMessage[] = [];
      try {
        dbMessages = await fetchThreadTranscript(tenantId, eventThreadId);
      } catch (err) {
        const msg = (err as Error)?.message || String(err);
        console.warn(
          `[memory-retain] fetchThreadTranscript failed; falling back to event transcript: ${msg}`,
        );
        dbMessages = [];
      }

      const merged = mergeTranscriptSuffix(dbMessages, eventMessages);

      if (merged.length === 0) {
        throw new Error("no_content");
      }

      if (eventLegacyMessages && !eventTranscript) {
        console.warn(
          "[memory-retain] legacy messages payload converted to conversation retain",
          {
            tenantId,
            userId,
            threadId: eventThreadId,
          },
        );
      }

      await adapter.retainConversation({
        ...owner,
        threadId: eventThreadId,
        messages: merged,
        hindsight: buildThreadRetainOptions(merged),
        metadata: eventMetadata,
      });

      console.log(
        `[memory-retain] engine=${engine} tenant=${tenantId} ` +
          `user=${userId} thread=${eventThreadId} db=${dbMessages.length} ` +
          `event=${eventMessages.length} merged=${merged.length}`,
      );

      const highConfidenceFacts = await retainHighConfidenceFacts({
        adapter,
        attempt,
        tenantId,
        userId,
        spaceId: attempt.space_id,
        threadId: eventThreadId,
        messages: merged,
      });

      await markRetainAttemptRetained(attempt.id, {
        backendLatencyMs: Date.now() - started,
        providerDocumentId: eventThreadId,
        providerResult: {
          engine,
          adapterKind: adapter.kind,
          messageCount: merged.length,
          highConfidenceFactCount: highConfidenceFacts.documents.length,
        },
        metadata: mergeAttemptMetadata(attempt.metadata, {
          dbMessageCount: dbMessages.length,
          eventMessageCount: eventMessages.length,
          mergedMessageCount: merged.length,
          highConfidenceFacts: highConfidenceFacts.documents,
          rejectedHighConfidenceFacts: highConfidenceFacts.rejected,
          fallbackUsed: dbMessages.length === 0 && eventMessages.length > 0,
          retainedAt: new Date().toISOString(),
        }),
      });
    } else {
      // AgentCore engine fallback: adapter without retainConversation
      // (e.g. AgentCore managed memory) keeps today's per-turn semantics.
      if (eventMessages.length === 0) {
        throw new Error("no_content");
      }
      await adapter.retainTurn({
        ...owner,
        threadId: eventThreadId,
        messages: eventMessages,
        metadata: eventMetadata,
      });
      console.log(
        `[memory-retain] engine=${engine} fallback retainTurn tenant=${tenantId} ` +
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
    }

    const compileOutcome = await maybeEnqueuePostTurnCompile({
      tenantId,
      ownerId: userId,
      adapterKind: adapter.kind,
    });
    if (
      compileOutcome.status === "enqueued" ||
      compileOutcome.status === "enqueued_invoke_failed" ||
      compileOutcome.status === "error"
    ) {
      console.log(
        `[memory-retain] wiki-compile ${compileOutcome.status}` +
          (compileOutcome.jobId ? ` jobId=${compileOutcome.jobId}` : "") +
          (compileOutcome.error ? ` error=${compileOutcome.error}` : ""),
      );
    }

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

type RetainedHighConfidenceFactDocument = {
  factId: string;
  documentId: string;
  scope: "user" | "space";
  kind: ExtractedHighConfidenceFact["kind"];
};

async function retainHighConfidenceFacts(input: {
  adapter: ReturnType<typeof getMemoryServices>["adapter"];
  attempt: RetainAttemptRow;
  tenantId: string;
  userId: string;
  spaceId?: string | null;
  threadId: string;
  messages: NormalizedMessage[];
}): Promise<{
  documents: RetainedHighConfidenceFactDocument[];
  rejected: RejectedHighConfidenceFactCandidate[];
}> {
  const extracted = extractHighConfidenceFacts({
    messages: input.messages,
    spaceId: input.spaceId,
  });
  if (extracted.facts.length === 0) {
    return { documents: [], rejected: extracted.rejected };
  }
  if (!input.adapter.upsertMarkdownMemoryDocument) {
    throw new Error("high_confidence_fact_upsert_not_supported");
  }

  const documents: RetainedHighConfidenceFactDocument[] = [];
  for (const fact of extracted.facts) {
    if (fact.scope === "space" && !input.spaceId) continue;
    const owner =
      fact.scope === "space"
        ? {
            tenantId: input.tenantId,
            ownerType: "space" as const,
            ownerId: input.spaceId!,
          }
        : {
            tenantId: input.tenantId,
            ownerType: "user" as const,
            ownerId: input.userId,
          };
    const documentId = highConfidenceFactDocumentId(input.attempt.id, fact);
    await input.adapter.upsertMarkdownMemoryDocument({
      ...owner,
      path: `memory/high-confidence-facts/${input.threadId}/${fact.id}.md`,
      content: fact.text,
      documentId,
      context: "thinkwork_high_confidence_fact",
      async: false,
      hindsight: buildHighConfidenceFactRetainOptions({
        scope: fact.scope,
        spaceId: input.spaceId,
        timestamp: fact.timestamp,
      }),
      metadata: {
        source: "high_confidence_fact",
        sourceContext: "thinkwork_high_confidence_fact",
        retainAttemptId: input.attempt.id,
        tenantId: input.tenantId,
        userId: input.userId,
        spaceId: input.spaceId,
        threadId: input.threadId,
        factId: fact.id,
        factScope: fact.scope,
        factKind: fact.kind,
        confidence: fact.confidence,
        sourceText: fact.sourceText,
        sourceMessageIndex: fact.sourceMessageIndex,
      },
    });
    documents.push({
      factId: fact.id,
      documentId,
      scope: fact.scope,
      kind: fact.kind,
    });
  }

  return { documents, rejected: extracted.rejected };
}

function highConfidenceFactDocumentId(
  attemptId: string,
  fact: ExtractedHighConfidenceFact,
): string {
  return `high_confidence_fact:${attemptId}:${fact.id}`;
}

/**
 * Fetch the canonical thread transcript from the messages table.
 *
 * SECURITY: filters by BOTH tenant_id AND thread_id to prevent confused-deputy
 * attacks via forged threadId in the event payload. A threadId belonging to
 * tenant B will return zero rows when the event claims tenantId=A, and the
 * caller falls through to the event tail (which contains A's content) — no
 * cross-tenant leak.
 *
 * Logging hygiene: never include message content in logs. Identifiers are
 * prefix-truncated.
 */
async function fetchThreadTranscript(
  tenantId: string,
  threadId: string,
): Promise<NormalizedMessage[]> {
  const db = getDb();
  const rows = await db
    .select({
      role: messages.role,
      content: messages.content,
      created_at: messages.created_at,
      tenant_id: messages.tenant_id,
    })
    .from(messages)
    .where(
      and(eq(messages.tenant_id, tenantId), eq(messages.thread_id, threadId)),
    )
    .orderBy(asc(messages.created_at));

  const anomalous = rows.filter((r) => r.tenant_id !== tenantId);
  if (anomalous.length > 0) {
    // Defense-in-depth: the WHERE filter above already excludes rows from
    // other tenants, but if database state is somehow inconsistent surface
    // it loudly rather than silently leak content.
    console.error(
      `[memory-retain] tenant_anomaly tenant=${tenantId.slice(0, 8)} ` +
        `thread=${threadId.slice(0, 8)} mismatched=${anomalous.length}`,
    );
    throw new Error("tenant_anomaly");
  }

  return rows
    .filter(
      (
        r,
      ): r is {
        role: string;
        content: string;
        created_at: Date;
        tenant_id: string;
      } => typeof r.content === "string" && r.content.trim().length > 0,
    )
    .map((r) => ({
      role:
        r.role === "assistant" || r.role === "system"
          ? (r.role as "assistant" | "system")
          : ("user" as const),
      content: r.content.trim(),
      timestamp: r.created_at.toISOString(),
    }));
}

/**
 * Longest-suffix-prefix overlap merge between DB rows (canonical) and the
 * runtime-supplied event tail.
 *
 * Algorithm: find the largest k such that event[0..k-1] equals db.tail[-k..]
 * compared by (role, content) only. Append event[k..] after the DB rows; the
 * first k event entries are the overlap and are dropped.
 *
 * Handles both transcript shapes:
 * - event = [latest_pair_only]  (small, k typically 0 or 2)
 * - event = full_history + [latest_pair]  (k matches whatever DB tail
 *   already has)
 *
 * Timestamp is excluded from the match key on purpose: createdAt differs
 * between runtime-stamped event entries and DB-writer-stamped rows, and
 * including it in the dedup key produces phantom duplicates over long threads.
 */
export function mergeTranscriptSuffix(
  db: NormalizedMessage[],
  event: NormalizedMessage[],
): NormalizedMessage[] {
  if (event.length === 0) return [...db];
  if (db.length === 0) return [...event];

  const max = Math.min(db.length, event.length);
  let bestK = 0;
  for (let k = max; k >= 1; k -= 1) {
    let match = true;
    for (let i = 0; i < k; i += 1) {
      const a = db[db.length - k + i];
      const b = event[i];
      if (a.role !== b.role || a.content !== b.content) {
        match = false;
        break;
      }
    }
    if (match) {
      bestK = k;
      break;
    }
  }

  return [...db, ...event.slice(bestK)];
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
