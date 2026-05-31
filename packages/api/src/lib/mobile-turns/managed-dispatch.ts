import { InvokeCommand, LambdaClient } from "@aws-sdk/client-lambda";
import { sql } from "drizzle-orm";
import { db as defaultDb } from "../db.js";
import {
  appendThreadTurnEvent,
  drizzleThreadTurnEventStore,
} from "../thread-turn-events.js";
import { notifyThreadTurnUpdate } from "../chat-finalize/notify.js";
import {
  MobileTurnCheckpointError,
  renderMobileHandoffPrompt,
  selectMobileTurnCheckpoint,
  type MobileTurnEventRow,
} from "./checkpoint.js";
import { MOBILE_PI_INVOCATION_SOURCE } from "./lifecycle.js";

const DEFAULT_STALE_AFTER_MS = 30_000;
const DEFAULT_LIMIT = 25;

export interface StaleMobileTurnCandidate {
  id: string;
  tenantId: string;
  agentId: string;
  threadId: string;
  contextSnapshot: unknown;
  lastActivityAt?: Date | string | null;
}

export interface MobileManagedDispatchPayload {
  tenantId: string;
  threadId: string;
  agentId: string;
  userMessage: string;
  messageId?: string;
  existingThreadTurnId: string;
  mobileHandoff: {
    checkpointSeq: number;
    latestObservedCheckpointSeq: number;
    unsafeCheckpointSkipped: boolean;
  };
}

export interface ProcessStaleMobileHandoffsDeps {
  now(): Date;
  listCandidates(input: {
    staleBefore: Date;
    limit: number;
  }): Promise<StaleMobileTurnCandidate[]>;
  loadEvents(input: {
    tenantId: string;
    threadTurnId: string;
  }): Promise<MobileTurnEventRow[]>;
  claimTurn(input: {
    candidate: StaleMobileTurnCandidate;
    staleBefore: Date;
    now: Date;
    checkpointSeq: number;
    latestObservedCheckpointSeq: number;
    unsafeCheckpointSkipped: boolean;
  }): Promise<boolean>;
  appendEvent(input: {
    tenantId: string;
    threadTurnId: string;
    agentId: string;
    eventType: string;
    message: string;
    payload?: unknown;
  }): Promise<void>;
  failTurn(input: {
    candidate: StaleMobileTurnCandidate;
    now: Date;
    code: string;
    message: string;
  }): Promise<void>;
  dispatch(input: MobileManagedDispatchPayload): Promise<void>;
}

export interface ProcessStaleMobileHandoffsOptions {
  staleAfterMs?: number;
  limit?: number;
}

export interface ProcessStaleMobileHandoffsResult {
  scanned: number;
  claimed: number;
  dispatched: number;
  failed: number;
  skipped: number;
}

export function defaultProcessStaleMobileHandoffsDeps(): ProcessStaleMobileHandoffsDeps {
  const lambda = new LambdaClient({});
  const chatAgentInvokeFunctionName =
    process.env.CHAT_AGENT_INVOKE_FN_ARN || "";

  return {
    now: () => new Date(),
    async listCandidates(input) {
      const result = await defaultDb.execute(sql`
        SELECT id, tenant_id, agent_id, thread_id, context_snapshot, last_activity_at
        FROM thread_turns
        WHERE status = 'running'
          AND invocation_source = ${MOBILE_PI_INVOCATION_SOURCE}
          AND finalized_at IS NULL
          AND agent_id IS NOT NULL
          AND thread_id IS NOT NULL
          AND COALESCE(last_activity_at, started_at, created_at) < ${input.staleBefore.toISOString()}::timestamptz
          AND context_snapshot #>> '{mobile_turn,handoff_eligible}' = 'true'
          AND COALESCE(context_snapshot #>> '{mobile_turn,ownership}', 'mobile') = 'mobile'
        ORDER BY COALESCE(last_activity_at, started_at, created_at) ASC
        LIMIT ${input.limit}
      `);
      return ((result as { rows?: Record<string, unknown>[] }).rows ?? []).map(
        (row) => ({
          id: String(row.id),
          tenantId: String(row.tenant_id),
          agentId: String(row.agent_id),
          threadId: String(row.thread_id),
          contextSnapshot: row.context_snapshot,
          lastActivityAt: row.last_activity_at as string | Date | null,
        }),
      );
    },
    async loadEvents(input) {
      const result = await defaultDb.execute(sql`
        SELECT seq, event_type, message, payload
        FROM thread_turn_events
        WHERE tenant_id = ${input.tenantId}::uuid
          AND run_id = ${input.threadTurnId}::uuid
        ORDER BY seq ASC
      `);
      return ((result as { rows?: Record<string, unknown>[] }).rows ?? []).map(
        (row) => ({
          seq: Number(row.seq ?? 0),
          event_type: String(row.event_type ?? ""),
          message: typeof row.message === "string" ? row.message : null,
          payload: row.payload,
        }),
      );
    },
    async claimTurn(input) {
      const nowIso = input.now.toISOString();
      const metadata = {
        ownership: "managed",
        claimed_at: nowIso,
        managed_dispatch_at: nowIso,
        latest_safe_checkpoint_seq: input.checkpointSeq,
        latest_observed_checkpoint_seq: input.latestObservedCheckpointSeq,
        unsafe_checkpoint_skipped: input.unsafeCheckpointSkipped,
      };
      const result = await defaultDb.execute(sql`
        UPDATE thread_turns
        SET last_activity_at = ${nowIso}::timestamptz,
            context_snapshot = jsonb_set(
              jsonb_set(
                jsonb_set(
                  jsonb_set(
                    jsonb_set(coalesce(context_snapshot, '{}'::jsonb), '{mobile_turn,ownership}', to_jsonb(${metadata.ownership}::text), true),
                    '{mobile_turn,managed_claimed_at}', to_jsonb(${metadata.claimed_at}::text), true
                  ),
                  '{mobile_turn,managed_dispatch_at}', to_jsonb(${metadata.managed_dispatch_at}::text), true
                ),
                '{mobile_turn,latest_safe_checkpoint_seq}', to_jsonb(${metadata.latest_safe_checkpoint_seq}::int), true
              ),
              '{mobile_turn,unsafe_checkpoint_skipped}', to_jsonb(${metadata.unsafe_checkpoint_skipped}::boolean), true
            )
        WHERE id = ${input.candidate.id}::uuid
          AND tenant_id = ${input.candidate.tenantId}::uuid
          AND status = 'running'
          AND invocation_source = ${MOBILE_PI_INVOCATION_SOURCE}
          AND finalized_at IS NULL
          AND COALESCE(last_activity_at, started_at, created_at) < ${input.staleBefore.toISOString()}::timestamptz
          AND context_snapshot #>> '{mobile_turn,handoff_eligible}' = 'true'
          AND COALESCE(context_snapshot #>> '{mobile_turn,ownership}', 'mobile') = 'mobile'
        RETURNING id
      `);
      return ((result as { rows?: unknown[] }).rows ?? []).length > 0;
    },
    async appendEvent(input) {
      await appendThreadTurnEvent(drizzleThreadTurnEventStore(), {
        tenantId: input.tenantId,
        runId: input.threadTurnId,
        agentId: input.agentId,
        eventType: input.eventType,
        message: input.message,
        payload: input.payload,
      });
    },
    async failTurn(input) {
      await defaultDb.execute(sql`
        UPDATE thread_turns
        SET status = 'failed',
            finished_at = ${input.now.toISOString()}::timestamptz,
            last_activity_at = ${input.now.toISOString()}::timestamptz,
            error = ${input.message},
            error_code = ${input.code}
        WHERE id = ${input.candidate.id}::uuid
          AND tenant_id = ${input.candidate.tenantId}::uuid
          AND status = 'running'
          AND finalized_at IS NULL
      `);
      await appendThreadTurnEvent(drizzleThreadTurnEventStore(), {
        tenantId: input.candidate.tenantId,
        runId: input.candidate.id,
        agentId: input.candidate.agentId,
        eventType: "mobile_pi_handoff_failed",
        message: input.message,
        level: "error",
        color: "red",
        payload: {
          code: input.code,
          at: input.now.toISOString(),
        },
      });
      await notifyThreadTurnUpdate({
        runId: input.candidate.id,
        tenantId: input.candidate.tenantId,
        threadId: input.candidate.threadId,
        agentId: input.candidate.agentId,
        status: "failed",
        triggerName: "Mobile Pi",
      });
    },
    async dispatch(input) {
      if (!chatAgentInvokeFunctionName) {
        throw new Error("CHAT_AGENT_INVOKE_FN_ARN is not configured");
      }
      await lambda.send(
        new InvokeCommand({
          FunctionName: chatAgentInvokeFunctionName,
          InvocationType: "Event",
          Payload: new TextEncoder().encode(JSON.stringify(input)),
        }),
      );
    },
  };
}

function userMessageIdFromSnapshot(snapshot: unknown): string | undefined {
  if (!snapshot || typeof snapshot !== "object") return undefined;
  const mobileTurn = (snapshot as { mobile_turn?: Record<string, unknown> })
    .mobile_turn;
  return typeof mobileTurn?.user_message_id === "string"
    ? mobileTurn.user_message_id
    : undefined;
}

export async function processStaleMobileHandoffs(
  deps: ProcessStaleMobileHandoffsDeps = defaultProcessStaleMobileHandoffsDeps(),
  options: ProcessStaleMobileHandoffsOptions = {},
): Promise<ProcessStaleMobileHandoffsResult> {
  const now = deps.now();
  const staleAfterMs = options.staleAfterMs ?? DEFAULT_STALE_AFTER_MS;
  const limit = options.limit ?? DEFAULT_LIMIT;
  const staleBefore = new Date(now.getTime() - staleAfterMs);
  const candidates = await deps.listCandidates({ staleBefore, limit });
  const result: ProcessStaleMobileHandoffsResult = {
    scanned: candidates.length,
    claimed: 0,
    dispatched: 0,
    failed: 0,
    skipped: 0,
  };

  for (const candidate of candidates) {
    let selection;
    try {
      const events = await deps.loadEvents({
        tenantId: candidate.tenantId,
        threadTurnId: candidate.id,
      });
      selection = selectMobileTurnCheckpoint({
        contextSnapshot: candidate.contextSnapshot,
        events,
      });
    } catch (err) {
      const message =
        err instanceof MobileTurnCheckpointError
          ? err.message
          : `Failed to select mobile handoff checkpoint: ${
              err instanceof Error ? err.message : String(err)
            }`;
      await deps.failTurn({
        candidate,
        now,
        code:
          err instanceof MobileTurnCheckpointError
            ? err.code
            : "CHECKPOINT_SELECTION_FAILED",
        message,
      });
      result.failed++;
      continue;
    }

    const claimed = await deps.claimTurn({
      candidate,
      staleBefore,
      now,
      checkpointSeq: selection.checkpoint.seq,
      latestObservedCheckpointSeq: selection.latestSeq,
      unsafeCheckpointSkipped: selection.unsafeCheckpointSkipped,
    });
    if (!claimed) {
      result.skipped++;
      continue;
    }
    result.claimed++;

    await deps.appendEvent({
      tenantId: candidate.tenantId,
      threadTurnId: candidate.id,
      agentId: candidate.agentId,
      eventType: "mobile_pi_managed_claim",
      message: "managed Pi claimed",
      payload: {
        at: now.toISOString(),
        checkpoint_seq: selection.checkpoint.seq,
        latest_observed_checkpoint_seq: selection.latestSeq,
      },
    });
    if (selection.unsafeCheckpointSkipped) {
      await deps.appendEvent({
        tenantId: candidate.tenantId,
        threadTurnId: candidate.id,
        agentId: candidate.agentId,
        eventType: "mobile_pi_unsafe_checkpoint_skipped",
        message: "unsafe checkpoint skipped",
        payload: {
          at: now.toISOString(),
          skipped_checkpoint_seq: selection.unsafeCheckpoint?.seq ?? null,
          resumed_checkpoint_seq: selection.checkpoint.seq,
          unsafe_reason: selection.unsafeCheckpoint?.unsafeReason ?? null,
        },
      });
    }

    try {
      await deps.dispatch({
        tenantId: candidate.tenantId,
        threadId: candidate.threadId,
        agentId: candidate.agentId,
        userMessage: renderMobileHandoffPrompt(selection),
        messageId: userMessageIdFromSnapshot(candidate.contextSnapshot),
        existingThreadTurnId: candidate.id,
        mobileHandoff: {
          checkpointSeq: selection.checkpoint.seq,
          latestObservedCheckpointSeq: selection.latestSeq,
          unsafeCheckpointSkipped: selection.unsafeCheckpointSkipped,
        },
      });
      result.dispatched++;
    } catch (err) {
      await deps.failTurn({
        candidate,
        now,
        code: "MANAGED_DISPATCH_FAILED",
        message: `Managed AgentCore dispatch failed: ${
          err instanceof Error ? err.message : String(err)
        }`,
      });
      result.failed++;
    }
  }

  return result;
}
