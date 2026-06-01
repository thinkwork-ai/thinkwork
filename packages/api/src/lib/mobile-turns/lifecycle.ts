import { and, eq, isNull, sql } from "drizzle-orm";
import { schema } from "@thinkwork/database-pg";
import { db as defaultDb } from "../db.js";
import {
  appendThreadTurnEvent,
  drizzleThreadTurnEventStore,
  type ThreadTurnEventInput,
} from "../thread-turn-events.js";
import {
  notifyNewMessage,
  notifyThreadTurnUpdate,
} from "../chat-finalize/notify.js";
import { processFinalize } from "../chat-finalize/process-finalize.js";
import type { ChangedFilePayload } from "../chat-finalize/reconcile.js";

const { users, threads, messages, threadTurns, threadTurnEvents } = schema;

export const MOBILE_PI_INVOCATION_SOURCE = "mobile_pi";
export const MOBILE_PI_RUNTIME_TYPE = "mobile-pi";

const MAX_TEXT_LENGTH = 200_000;
const MAX_CHECKPOINT_PAYLOAD_BYTES = 48 * 1024;
const CHECKPOINT_ARRAY_LIMIT = 12;
const CHECKPOINT_TEXT_LIMIT = 6_000;
const CHECKPOINT_NESTED_TEXT_LIMIT = 2_000;

export interface MobileTurnAuth {
  email: string | null;
  tenantId?: string | null;
}

export interface MobileTurnAttachmentRef {
  id?: string;
  name?: string;
  mimeType?: string;
  sizeBytes?: number;
  s3Key?: string;
}

export interface MobileTurnRequester {
  id: string;
  tenantId: string;
  email: string;
  name: string | null;
}

export interface MobileTurnThread {
  id: string;
  tenantId: string;
  agentId: string | null;
  spaceId: string;
  userId: string | null;
}

export interface MobileTurnStartInput {
  auth: MobileTurnAuth;
  clientTurnId: string;
  threadId: string;
  agentId?: string | null;
  userText: string;
  attachments?: MobileTurnAttachmentRef[];
  metadata?: Record<string, unknown>;
}

export interface MobileTurnStartResult {
  threadTurnId: string;
  threadId: string;
  userMessageId: string | null;
  status: string;
  checkpointSeq: number;
  idempotent: boolean;
}

export interface MobileTurnCheckpointInput {
  auth: MobileTurnAuth;
  threadTurnId: string;
  checkpoint: Record<string, unknown>;
  message?: string;
  safe?: boolean;
}

export interface MobileTurnHeartbeatInput {
  auth: MobileTurnAuth;
  threadTurnId: string;
  latestCheckpointSeq?: number;
}

export interface MobileTurnBackgroundInput {
  auth: MobileTurnAuth;
  threadTurnId: string;
  reason?: string;
}

export interface MobileTurnAbortInput {
  auth: MobileTurnAuth;
  threadTurnId: string;
  reason?: string;
}

export interface MobileTurnFinalizeInput {
  auth: MobileTurnAuth;
  threadTurnId: string;
  assistantText: string;
  toolResults?: unknown[];
  usage?: { inputTokens?: number; outputTokens?: number };
  changedFiles?: ChangedFilePayload[];
  diagnostics?: Record<string, unknown>;
}

export interface MobileTurnLifecycleDeps {
  now(): Date;
  loadCallerByEmail(email: string): Promise<MobileTurnRequester | null>;
  loadThreadForStart(input: {
    tenantId: string;
    threadId: string;
  }): Promise<MobileTurnThread | null>;
  loadExistingStart(input: {
    tenantId: string;
    threadId: string;
    clientTurnId: string;
  }): Promise<MobileTurnStartResult | null>;
  createStartedTurn(input: {
    now: Date;
    caller: MobileTurnRequester;
    thread: MobileTurnThread;
    agentId: string;
    clientTurnId: string;
    userText: string;
    attachments: MobileTurnAttachmentRef[];
    metadata: Record<string, unknown>;
  }): Promise<Omit<MobileTurnStartResult, "idempotent">>;
  updateHeartbeat(input: {
    tenantId: string;
    threadTurnId: string;
    now: Date;
    latestCheckpointSeq?: number;
  }): Promise<boolean>;
  appendCheckpoint(input: {
    tenantId: string;
    threadTurnId: string;
    now: Date;
    checkpoint: Record<string, unknown>;
    message: string;
    safe: boolean;
  }): Promise<{ seq: number } | null>;
  markBackground(input: {
    tenantId: string;
    threadTurnId: string;
    now: Date;
    reason?: string;
  }): Promise<boolean>;
  abortTurn(input: {
    tenantId: string;
    threadTurnId: string;
    now: Date;
    reason?: string;
  }): Promise<boolean>;
  finalizeLocalTurn(input: {
    tenantId: string;
    threadTurnId: string;
    now: Date;
    assistantText: string;
    toolResults: unknown[];
    usage?: { inputTokens?: number; outputTokens?: number };
    changedFiles?: ChangedFilePayload[];
    diagnostics?: Record<string, unknown>;
  }): Promise<{ finalized: boolean; assistantMessageId: string | null }>;
}

export class MobileTurnLifecycleError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
    public readonly code: string,
  ) {
    super(message);
    this.name = "MobileTurnLifecycleError";
  }
}

function requireAuth(auth: MobileTurnAuth): string {
  const email = auth.email?.trim().toLowerCase();
  if (!email) {
    throw new MobileTurnLifecycleError(
      "Authentication required",
      401,
      "UNAUTHORIZED",
    );
  }
  return email;
}

async function loadCaller(
  deps: MobileTurnLifecycleDeps,
  auth: MobileTurnAuth,
): Promise<MobileTurnRequester> {
  const email = requireAuth(auth);
  const caller = await deps.loadCallerByEmail(email);
  if (!caller?.tenantId) {
    throw new MobileTurnLifecycleError(
      "No tenant resolved for caller",
      403,
      "TENANT_NOT_RESOLVED",
    );
  }
  if (auth.tenantId && auth.tenantId !== caller.tenantId) {
    throw new MobileTurnLifecycleError(
      "Caller tenant does not match token tenant",
      403,
      "TENANT_MISMATCH",
    );
  }
  return caller;
}

function requireNonEmpty(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new MobileTurnLifecycleError(
      `${field} is required`,
      400,
      "BAD_REQUEST",
    );
  }
  return value.trim();
}

function requireBoundedText(value: unknown, field: string): string {
  const text = requireNonEmpty(value, field);
  if (text.length > MAX_TEXT_LENGTH) {
    throw new MobileTurnLifecycleError(
      `${field} is too large`,
      413,
      "PAYLOAD_TOO_LARGE",
    );
  }
  return text;
}

function checkpointBytes(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value ?? null), "utf8");
}

function truncateCheckpointText(value: string, limit: number): string {
  if (value.length <= limit) return value;
  return `${value.slice(0, limit)}\n[truncated ${value.length - limit} chars]`;
}

function compactCheckpointValue(
  value: unknown,
  key = "",
  depth = 0,
): unknown {
  if (typeof value === "string") {
    return truncateCheckpointText(
      value,
      key === "text" || key === "content"
        ? CHECKPOINT_TEXT_LIMIT
        : CHECKPOINT_NESTED_TEXT_LIMIT,
    );
  }
  if (typeof value !== "object" || value === null) return value;
  if (depth >= 4) return "[truncated nested checkpoint value]";

  if (Array.isArray(value)) {
    if (key === "transcript") {
      const messages = value.slice(-CHECKPOINT_ARRAY_LIMIT);
      const compacted = messages.map((item) => {
        if (!item || typeof item !== "object" || Array.isArray(item)) {
          return compactCheckpointValue(item, key, depth + 1);
        }
        const message = item as Record<string, unknown>;
        return {
          role: typeof message.role === "string" ? message.role : "unknown",
          content:
            typeof message.content === "string"
              ? truncateCheckpointText(message.content, 1_000)
              : "",
        };
      });
      if (messages.length < value.length) {
        compacted.push({ truncated_items: value.length - messages.length });
      }
      return compacted;
    }
    const items =
      key === "event_log"
        ? value.slice(-CHECKPOINT_ARRAY_LIMIT)
        : value.slice(0, CHECKPOINT_ARRAY_LIMIT);
    const compacted = items.map((item) =>
      compactCheckpointValue(item, key, depth + 1),
    );
    if (items.length < value.length) {
      compacted.push({ truncated_items: value.length - items.length });
    }
    return compacted;
  }

  const out: Record<string, unknown> = {};
  for (const [entryKey, entryValue] of Object.entries(value)) {
    out[entryKey] = compactCheckpointValue(entryValue, entryKey, depth + 1);
  }
  return out;
}

export function boundMobileCheckpointPayload(
  checkpoint: Record<string, unknown>,
): Record<string, unknown> {
  let payload = compactCheckpointValue(checkpoint) as Record<string, unknown>;
  if (checkpointBytes(payload) <= MAX_CHECKPOINT_PAYLOAD_BYTES) return payload;

  payload = {
    ...payload,
    checkpoint_truncated: true,
    event_log: undefined,
  };
  if (checkpointBytes(payload) <= MAX_CHECKPOINT_PAYLOAD_BYTES) return payload;

  return {
    checkpoint_truncated: true,
    event_type: payload.event_type,
    safe: payload.safe,
    seq: payload.seq,
    checkpointed_at: payload.checkpointed_at,
    unsafe_reason: payload.unsafe_reason,
    stop_reason: payload.stop_reason,
    text:
      typeof payload.text === "string"
        ? truncateCheckpointText(payload.text, CHECKPOINT_TEXT_LIMIT)
        : undefined,
    name: payload.name,
    result: compactCheckpointValue(payload.result, "result", 1),
    transcript: compactCheckpointValue(payload.transcript, "transcript", 1),
  };
}

function latestCheckpointSeqPatch(seq: number | undefined) {
  if (seq === undefined) return {};
  return {
    context_snapshot: sql`jsonb_set(coalesce(${threadTurns.context_snapshot}, '{}'::jsonb), '{mobile_turn,latest_checkpoint_seq}', to_jsonb(${seq}::int), true)`,
  };
}

export async function startMobileTurn(
  input: MobileTurnStartInput,
  deps: MobileTurnLifecycleDeps = defaultMobileTurnLifecycleDeps(),
): Promise<MobileTurnStartResult> {
  const clientTurnId = requireNonEmpty(input.clientTurnId, "clientTurnId");
  const threadId = requireNonEmpty(input.threadId, "threadId");
  const userText = requireBoundedText(input.userText, "userText");
  const caller = await loadCaller(deps, input.auth);

  const thread = await deps.loadThreadForStart({
    tenantId: caller.tenantId,
    threadId,
  });
  if (!thread) {
    throw new MobileTurnLifecycleError(
      "Thread not found",
      404,
      "THREAD_NOT_FOUND",
    );
  }

  const requestedAgentId = input.agentId?.trim() || null;
  if (
    thread.agentId &&
    requestedAgentId &&
    thread.agentId !== requestedAgentId
  ) {
    throw new MobileTurnLifecycleError(
      "Thread is not assigned to the requested agent",
      403,
      "AGENT_THREAD_MISMATCH",
    );
  }
  const agentId = thread.agentId ?? requestedAgentId;
  if (!agentId) {
    throw new MobileTurnLifecycleError(
      "agentId is required for mobile Pi turns",
      400,
      "AGENT_REQUIRED",
    );
  }

  const existing = await deps.loadExistingStart({
    tenantId: caller.tenantId,
    threadId,
    clientTurnId,
  });
  if (existing) {
    return { ...existing, idempotent: true };
  }

  const started = await deps.createStartedTurn({
    now: deps.now(),
    caller,
    thread,
    agentId,
    clientTurnId,
    userText,
    attachments: input.attachments ?? [],
    metadata: input.metadata ?? {},
  });
  return { ...started, idempotent: false };
}

export async function heartbeatMobileTurn(
  input: MobileTurnHeartbeatInput,
  deps: MobileTurnLifecycleDeps = defaultMobileTurnLifecycleDeps(),
): Promise<{ ok: true }> {
  const caller = await loadCaller(deps, input.auth);
  const threadTurnId = requireNonEmpty(input.threadTurnId, "threadTurnId");
  const ok = await deps.updateHeartbeat({
    tenantId: caller.tenantId,
    threadTurnId,
    now: deps.now(),
    latestCheckpointSeq: input.latestCheckpointSeq,
  });
  if (!ok) {
    throw new MobileTurnLifecycleError(
      "Thread turn not found",
      404,
      "THREAD_TURN_NOT_FOUND",
    );
  }
  return { ok: true };
}

export async function checkpointMobileTurn(
  input: MobileTurnCheckpointInput,
  deps: MobileTurnLifecycleDeps = defaultMobileTurnLifecycleDeps(),
): Promise<{ seq: number }> {
  const caller = await loadCaller(deps, input.auth);
  const threadTurnId = requireNonEmpty(input.threadTurnId, "threadTurnId");
  const checkpoint = input.checkpoint;
  if (
    !checkpoint ||
    typeof checkpoint !== "object" ||
    Array.isArray(checkpoint)
  ) {
    throw new MobileTurnLifecycleError(
      "checkpoint must be an object",
      400,
      "BAD_REQUEST",
    );
  }
  const row = await deps.appendCheckpoint({
    tenantId: caller.tenantId,
    threadTurnId,
    now: deps.now(),
    checkpoint,
    message: input.message?.trim() || "checkpoint saved",
    safe: input.safe !== false,
  });
  if (!row) {
    throw new MobileTurnLifecycleError(
      "Thread turn not found",
      404,
      "THREAD_TURN_NOT_FOUND",
    );
  }
  return { seq: row.seq };
}

export async function backgroundMobileTurn(
  input: MobileTurnBackgroundInput,
  deps: MobileTurnLifecycleDeps = defaultMobileTurnLifecycleDeps(),
): Promise<{ ok: true }> {
  const caller = await loadCaller(deps, input.auth);
  const threadTurnId = requireNonEmpty(input.threadTurnId, "threadTurnId");
  const ok = await deps.markBackground({
    tenantId: caller.tenantId,
    threadTurnId,
    now: deps.now(),
    reason: input.reason,
  });
  if (!ok) {
    throw new MobileTurnLifecycleError(
      "Thread turn not found",
      404,
      "THREAD_TURN_NOT_FOUND",
    );
  }
  return { ok: true };
}

export async function abortMobileTurn(
  input: MobileTurnAbortInput,
  deps: MobileTurnLifecycleDeps = defaultMobileTurnLifecycleDeps(),
): Promise<{ ok: true }> {
  const caller = await loadCaller(deps, input.auth);
  const threadTurnId = requireNonEmpty(input.threadTurnId, "threadTurnId");
  const ok = await deps.abortTurn({
    tenantId: caller.tenantId,
    threadTurnId,
    now: deps.now(),
    reason: input.reason,
  });
  if (!ok) {
    throw new MobileTurnLifecycleError(
      "Thread turn not found",
      404,
      "THREAD_TURN_NOT_FOUND",
    );
  }
  return { ok: true };
}

export async function finalizeLocalMobileTurn(
  input: MobileTurnFinalizeInput,
  deps: MobileTurnLifecycleDeps = defaultMobileTurnLifecycleDeps(),
): Promise<{ finalized: boolean; assistantMessageId: string | null }> {
  const caller = await loadCaller(deps, input.auth);
  const threadTurnId = requireNonEmpty(input.threadTurnId, "threadTurnId");
  const assistantText = requireBoundedText(
    input.assistantText,
    "assistantText",
  );
  const result = await deps.finalizeLocalTurn({
    tenantId: caller.tenantId,
    threadTurnId,
    now: deps.now(),
    assistantText,
    toolResults: input.toolResults ?? [],
    usage: input.usage,
    changedFiles: input.changedFiles ?? [],
    diagnostics: input.diagnostics,
  });
  if (!result.finalized) {
    throw new MobileTurnLifecycleError(
      "Visible finalization was rejected because this turn is no longer owned by the mobile runtime",
      409,
      "FINALIZE_REJECTED",
    );
  }
  return result;
}

export function defaultMobileTurnLifecycleDeps(): MobileTurnLifecycleDeps {
  return {
    now: () => new Date(),
    async loadCallerByEmail(email) {
      const [row] = await defaultDb
        .select({
          id: users.id,
          tenantId: users.tenant_id,
          email: users.email,
          name: users.name,
        })
        .from(users)
        .where(eq(users.email, email))
        .limit(1);
      if (!row?.tenantId || !row.email) return null;
      return {
        id: row.id,
        tenantId: row.tenantId,
        email: row.email,
        name: row.name,
      };
    },
    async loadThreadForStart(input) {
      const [row] = await defaultDb
        .select({
          id: threads.id,
          tenantId: threads.tenant_id,
          agentId: threads.agent_id,
          spaceId: threads.space_id,
          userId: threads.user_id,
        })
        .from(threads)
        .where(
          and(
            eq(threads.id, input.threadId),
            eq(threads.tenant_id, input.tenantId),
          ),
        )
        .limit(1);
      return row ?? null;
    },
    async loadExistingStart(input) {
      const [row] = await defaultDb
        .select({
          id: threadTurns.id,
          threadId: threadTurns.thread_id,
          status: threadTurns.status,
          contextSnapshot: threadTurns.context_snapshot,
        })
        .from(threadTurns)
        .where(
          and(
            eq(threadTurns.tenant_id, input.tenantId),
            eq(threadTurns.thread_id, input.threadId),
            eq(threadTurns.external_run_id, input.clientTurnId),
            eq(threadTurns.invocation_source, MOBILE_PI_INVOCATION_SOURCE),
          ),
        )
        .limit(1);
      if (!row) return null;
      const snapshot = row.contextSnapshot as
        | {
            mobile_turn?: {
              user_message_id?: unknown;
              baseline_checkpoint_seq?: unknown;
            };
          }
        | null
        | undefined;
      return {
        threadTurnId: row.id,
        threadId: row.threadId ?? input.threadId,
        userMessageId:
          typeof snapshot?.mobile_turn?.user_message_id === "string"
            ? snapshot.mobile_turn.user_message_id
            : null,
        status: row.status ?? "running",
        checkpointSeq:
          typeof snapshot?.mobile_turn?.baseline_checkpoint_seq === "number"
            ? snapshot.mobile_turn.baseline_checkpoint_seq
            : 0,
        idempotent: true,
      };
    },
    async createStartedTurn(input) {
      const started = await defaultDb.transaction(async (tx) => {
        const [countRow] = await tx
          .select({ count: sql<number>`COUNT(*)::int` })
          .from(threadTurns)
          .where(eq(threadTurns.thread_id, input.thread.id));
        const turnNumber = Number(countRow?.count ?? 0) + 1;
        const startedIso = input.now.toISOString();
        const baseSnapshot = {
          mobile_turn: {
            client_turn_id: input.clientTurnId,
            handoff_eligible: true,
            ownership: "mobile",
            runtime_type: MOBILE_PI_RUNTIME_TYPE,
            started_at: startedIso,
            last_heartbeat_at: startedIso,
            baseline_checkpoint_seq: 0,
            latest_checkpoint_seq: 0,
            user_message_id: null,
            requester: {
              id: input.caller.id,
              email: input.caller.email,
              name: input.caller.name,
            },
            thread: {
              id: input.thread.id,
              agent_id: input.agentId,
              space_id: input.thread.spaceId,
            },
            attachments: input.attachments,
            metadata: input.metadata,
          },
        };
        const [turn] = await tx
          .insert(threadTurns)
          .values({
            tenant_id: input.caller.tenantId,
            agent_id: input.agentId,
            thread_id: input.thread.id,
            invocation_source: MOBILE_PI_INVOCATION_SOURCE,
            runtime_type: MOBILE_PI_RUNTIME_TYPE,
            status: "running",
            started_at: input.now,
            last_activity_at: input.now,
            turn_number: turnNumber,
            external_run_id: input.clientTurnId,
            context_snapshot: baseSnapshot,
          })
          .returning({ id: threadTurns.id });
        if (!turn?.id) throw new Error("Failed to create mobile turn");

        const [userMessage] = await tx
          .insert(messages)
          .values({
            thread_id: input.thread.id,
            tenant_id: input.caller.tenantId,
            role: "user",
            content: input.userText,
            sender_type: "user",
            sender_id: input.caller.id,
            metadata: {
              mobile_turn: {
                client_turn_id: input.clientTurnId,
                thread_turn_id: turn.id,
              },
              attachments: input.attachments,
            },
          })
          .returning({ id: messages.id });

        const snapshot = {
          ...baseSnapshot,
          mobile_turn: {
            ...baseSnapshot.mobile_turn,
            user_message_id: userMessage.id,
            checkpoint_0: {
              kind: "baseline",
              safe: true,
              seq: 0,
              user_text: input.userText,
              attachments: input.attachments,
              created_at: startedIso,
            },
          },
        };

        await tx
          .update(threadTurns)
          .set({
            wakeup_request_id: turn.id,
            context_snapshot: snapshot,
          })
          .where(eq(threadTurns.id, turn.id));

        await tx.insert(threadTurnEvents).values({
          tenant_id: input.caller.tenantId,
          run_id: turn.id,
          agent_id: input.agentId,
          seq: 0,
          event_type: "mobile_pi_checkpoint",
          stream: "activity",
          level: "info",
          color: "blue",
          message: "mobile Pi turn started",
          payload: snapshot.mobile_turn.checkpoint_0,
        });

        await tx
          .update(threads)
          .set({ updated_at: input.now })
          .where(eq(threads.id, input.thread.id));

        return {
          threadTurnId: turn.id,
          threadId: input.thread.id,
          userMessageId: userMessage.id,
          status: "running",
          checkpointSeq: 0,
        };
      });
      if (started.userMessageId) {
        await notifyNewMessage({
          messageId: started.userMessageId,
          threadId: input.thread.id,
          tenantId: input.caller.tenantId,
          role: "user",
          content: input.userText,
          senderType: "user",
          senderId: input.caller.id,
        });
      }
      await notifyThreadTurnUpdate({
        runId: started.threadTurnId,
        tenantId: input.caller.tenantId,
        threadId: input.thread.id,
        agentId: input.agentId,
        status: "running",
        triggerName: "Mobile Pi",
      });
      return started;
    },
    async updateHeartbeat(input) {
      const rows = await defaultDb
        .update(threadTurns)
        .set({
          last_activity_at: input.now,
          ...latestCheckpointSeqPatch(input.latestCheckpointSeq),
        })
        .where(
          and(
            eq(threadTurns.id, input.threadTurnId),
            eq(threadTurns.tenant_id, input.tenantId),
            eq(threadTurns.invocation_source, MOBILE_PI_INVOCATION_SOURCE),
            eq(threadTurns.status, "running"),
            isNull(threadTurns.finalized_at),
          ),
        )
        .returning({ id: threadTurns.id });
      return rows.length > 0;
    },
    async appendCheckpoint(input) {
      return defaultDb.transaction(async (tx) => {
        const checkpointedAt = input.now.toISOString();
        const eventPayload = boundMobileCheckpointPayload({
          ...input.checkpoint,
          safe: input.safe,
          checkpointed_at: checkpointedAt,
        });
        const event = await appendThreadTurnEvent(
          drizzleThreadTurnEventStore(tx),
          {
            tenantId: input.tenantId,
            runId: input.threadTurnId,
            eventType: "mobile_pi_checkpoint",
            message: input.message,
            agentId: null,
            payload: eventPayload,
          },
        );
        const snapshotPayload = boundMobileCheckpointPayload({
          ...input.checkpoint,
          safe: input.safe,
          seq: event.seq,
          checkpointed_at: checkpointedAt,
        });
        await tx
          .update(threadTurns)
          .set({
            last_activity_at: input.now,
            context_snapshot: sql`jsonb_set(jsonb_set(coalesce(${threadTurns.context_snapshot}, '{}'::jsonb), '{mobile_turn,latest_checkpoint}', ${JSON.stringify(
              snapshotPayload,
            )}::jsonb, true), '{mobile_turn,latest_checkpoint_seq}', to_jsonb(${event.seq}::int), true)`,
          })
          .where(
            and(
              eq(threadTurns.id, input.threadTurnId),
              eq(threadTurns.tenant_id, input.tenantId),
              eq(threadTurns.status, "running"),
              isNull(threadTurns.finalized_at),
            ),
          );
        return { seq: event.seq };
      });
    },
    async markBackground(input) {
      const rows = await defaultDb
        .update(threadTurns)
        .set({
          last_activity_at: input.now,
          context_snapshot: sql`jsonb_set(coalesce(${threadTurns.context_snapshot}, '{}'::jsonb), '{mobile_turn,background}', ${JSON.stringify(
            {
              at: input.now.toISOString(),
              reason: input.reason ?? null,
            },
          )}::jsonb, true)`,
        })
        .where(
          and(
            eq(threadTurns.id, input.threadTurnId),
            eq(threadTurns.tenant_id, input.tenantId),
            eq(threadTurns.status, "running"),
            isNull(threadTurns.finalized_at),
          ),
        )
        .returning({
          id: threadTurns.id,
          threadId: threadTurns.thread_id,
          agentId: threadTurns.agent_id,
        });
      if (rows.length === 0) return false;
      await appendThreadTurnEvent(drizzleThreadTurnEventStore(), {
        tenantId: input.tenantId,
        runId: input.threadTurnId,
        agentId: rows[0]?.agentId,
        eventType: "mobile_pi_background",
        message: "background grace started",
        payload: { reason: input.reason ?? null, at: input.now.toISOString() },
      } satisfies ThreadTurnEventInput);
      return true;
    },
    async abortTurn(input) {
      const rows = await defaultDb
        .update(threadTurns)
        .set({
          status: "cancelled",
          finished_at: input.now,
          last_activity_at: input.now,
          result_json: { cancelled: true, reason: input.reason ?? null },
          context_snapshot: sql`jsonb_set(coalesce(${threadTurns.context_snapshot}, '{}'::jsonb), '{mobile_turn,handoff_eligible}', 'false'::jsonb, true)`,
        })
        .where(
          and(
            eq(threadTurns.id, input.threadTurnId),
            eq(threadTurns.tenant_id, input.tenantId),
            eq(threadTurns.status, "running"),
            isNull(threadTurns.finalized_at),
          ),
        )
        .returning({
          id: threadTurns.id,
          threadId: threadTurns.thread_id,
          agentId: threadTurns.agent_id,
        });
      if (rows.length === 0) return false;
      await appendThreadTurnEvent(drizzleThreadTurnEventStore(), {
        tenantId: input.tenantId,
        runId: input.threadTurnId,
        agentId: rows[0]?.agentId,
        eventType: "mobile_pi_abort",
        message: "mobile Pi turn aborted",
        payload: { reason: input.reason ?? null, at: input.now.toISOString() },
      });
      if (rows[0]?.agentId && rows[0]?.threadId) {
        await notifyThreadTurnUpdate({
          runId: input.threadTurnId,
          tenantId: input.tenantId,
          threadId: rows[0].threadId,
          agentId: rows[0].agentId,
          status: "cancelled",
          triggerName: "Mobile Pi",
        });
      }
      return true;
    },
    async finalizeLocalTurn(input) {
      const [turn] = await defaultDb
        .select({
          id: threadTurns.id,
          threadId: threadTurns.thread_id,
          agentId: threadTurns.agent_id,
        })
        .from(threadTurns)
        .where(
          and(
            eq(threadTurns.id, input.threadTurnId),
            eq(threadTurns.tenant_id, input.tenantId),
          ),
        )
        .limit(1);
      if (!turn?.threadId || !turn.agentId) {
        return { finalized: false, assistantMessageId: null };
      }

      const toolInvocations = input.toolResults.filter(
        (item): item is Record<string, unknown> =>
          !!item && typeof item === "object" && !Array.isArray(item),
      );
      const result = await processFinalize({
        thread_turn_id: input.threadTurnId,
        tenant_id: input.tenantId,
        agent_id: turn.agentId,
        thread_id: turn.threadId,
        duration_ms: 0,
        status: "completed",
        runtime_type: MOBILE_PI_RUNTIME_TYPE,
        response: {
          content: input.assistantText,
          runtime: MOBILE_PI_RUNTIME_TYPE,
          tool_invocations: toolInvocations,
          tools_called: toolInvocations
            .map((item) => item.name ?? item.tool_name)
            .filter((name): name is string => typeof name === "string"),
          diagnostics: input.diagnostics,
        },
        usage: {
          input_tokens: input.usage?.inputTokens ?? 0,
          output_tokens: input.usage?.outputTokens ?? 0,
          diagnostics: input.diagnostics,
        },
        changed_files: input.changedFiles ?? [],
        claim: {
          invocation_source: MOBILE_PI_INVOCATION_SOURCE,
          status: "running",
          context_owner: "mobile",
        },
      });

      if (!result.finalized) {
        await appendThreadTurnEvent(drizzleThreadTurnEventStore(), {
          tenantId: input.tenantId,
          runId: input.threadTurnId,
          agentId: turn.agentId,
          eventType: "mobile_pi_late_finalize",
          message: "late mobile finalize rejected",
          payload: {
            at: input.now.toISOString(),
            reason: "not_running_or_already_finalized",
          },
        });
      }

      return {
        finalized: result.finalized,
        assistantMessageId: result.messageId,
      };
    },
  };
}
