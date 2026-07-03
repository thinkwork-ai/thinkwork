import { and, eq } from "drizzle-orm";
import { getDb } from "@thinkwork/database-pg";
import { agentWakeupRequests } from "@thinkwork/database-pg/schema";
import type { ParsedMention } from "./parse-message-mentions.js";
import type { PendingQuestionAnswersPayload } from "../user-questions/runtime-payload.js";

export interface AgentMentionWakeup {
  tenantId: string;
  agentId: string;
  source: "chat_message";
  reason: string;
  triggerDetail: string;
  payload: Record<string, unknown>;
  idempotencyKey: string;
  requestedByActorType: string;
  requestedByActorId: string | null;
}

export interface AgentMentionDispatchRepository {
  findExistingWakeup(input: {
    tenantId: string;
    agentId: string;
    idempotencyKey: string;
  }): Promise<{ id: string } | null>;
  createWakeup(input: AgentMentionWakeup): Promise<{ id: string }>;
}

export interface DispatchAgentMentionInput {
  tenantId: string;
  threadId: string;
  spaceId?: string | null;
  messageId: string;
  content?: string | null;
  requestedModelId?: string | null;
  mentions: ParsedMention[];
  /**
   * ask_user_question (plan 2026-06-09-005 U3): when the dispatching
   * message CAS-consumed the thread's pending question batch (plain-reply
   * route), this carries the answer context on the mention path's PRIMARY
   * wakeup — exactly one turn carries the answers; NO second wakeup is
   * enqueued. The wakeup-processor reads the nested
   * `pendingQuestionAnswers` payload key for chat_message wakeups.
   */
  pendingQuestionAnswers?: PendingQuestionAnswersPayload | null;
  sender?: {
    type?: string | null;
    id?: string | null;
  } | null;
  /**
   * THINK-136 U6/KTD4: retry attempt counter. When > 0 each mention wakeup
   * mints an `...:attempt-N`-suffixed idempotency key so the retry does not
   * no-op against the prior (base-key) wakeup row.
   */
  attempt?: number | null;
}

export interface AgentMentionDispatchResult {
  agentId: string;
  enqueued: boolean;
  wakeupRequestId?: string;
  // THINK-136 U6/R7: dispatch can fail per-agent (multiple mentioned agents),
  // so failures are recorded per-dispatch rather than aborting the whole loop.
  // sendMessage stamps a failed dispatch state listing exactly these agentIds.
  failed?: boolean;
  error?: string;
}

export async function dispatchAgentMentions(
  input: DispatchAgentMentionInput,
  repository: AgentMentionDispatchRepository = new DrizzleAgentMentionDispatchRepository(),
): Promise<AgentMentionDispatchResult[]> {
  const wakeups = buildAgentMentionWakeups(input);
  const results: AgentMentionDispatchResult[] = [];

  for (const wakeup of wakeups) {
    try {
      const existing = await repository.findExistingWakeup({
        tenantId: wakeup.tenantId,
        agentId: wakeup.agentId,
        idempotencyKey: wakeup.idempotencyKey,
      });
      if (existing) {
        results.push({
          agentId: wakeup.agentId,
          enqueued: false,
          wakeupRequestId: existing.id,
        });
        continue;
      }
      const created = await repository.createWakeup(wakeup);
      results.push({
        agentId: wakeup.agentId,
        enqueued: true,
        wakeupRequestId: created.id,
      });
    } catch (err) {
      // Per-dispatch failure: record it and keep dispatching the remaining
      // mentioned agents (R7 — one agent's failure must not silently drop
      // the others, and the caller stamps a per-agent failed state).
      results.push({
        agentId: wakeup.agentId,
        enqueued: false,
        failed: true,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return results;
}

export function buildAgentMentionWakeups(
  input: DispatchAgentMentionInput,
): AgentMentionWakeup[] {
  return input.mentions
    .filter((mention) => mention.targetType === "agent")
    .map((mention, index) => ({
      tenantId: input.tenantId,
      agentId: mention.targetId,
      source: "chat_message",
      reason: `${mention.displayName} mentioned in Thread`,
      triggerDetail: `thread:${input.threadId}:message:${input.messageId}`,
      payload: {
        threadId: input.threadId,
        spaceId: input.spaceId ?? null,
        messageId: input.messageId,
        userMessage: input.content ?? "",
        mention: {
          displayName: mention.displayName,
          rawText: mention.rawText,
          startOffset: mention.startOffset,
          endOffset: mention.endOffset,
        },
        message: input.content ?? "",
        ...(input.requestedModelId
          ? {
              modelId: input.requestedModelId,
              requestedModelId: input.requestedModelId,
            }
          : {}),
        // Reply-consumed answer context rides the PRIMARY mention wakeup
        // only — exactly one turn carries the answers (the consume already
        // committed; dropping it would orphan the answers, duplicating it
        // would resume the agent twice). Plan 2026-06-09-005 U3.
        ...(index === 0 && input.pendingQuestionAnswers
          ? { pendingQuestionAnswers: input.pendingQuestionAnswers }
          : {}),
      },
      idempotencyKey: `agent-mention:${input.tenantId}:${input.messageId}:${mention.targetId}${
        input.attempt && input.attempt > 0 ? `:attempt-${input.attempt}` : ""
      }`,
      requestedByActorType: input.sender?.type ?? "user",
      requestedByActorId: input.sender?.id ?? null,
    }));
}

class DrizzleAgentMentionDispatchRepository implements AgentMentionDispatchRepository {
  private readonly db = getDb();

  async findExistingWakeup(input: {
    tenantId: string;
    agentId: string;
    idempotencyKey: string;
  }) {
    const [row] = await this.db
      .select({ id: agentWakeupRequests.id })
      .from(agentWakeupRequests)
      .where(
        and(
          eq(agentWakeupRequests.tenant_id, input.tenantId),
          eq(agentWakeupRequests.agent_id, input.agentId),
          eq(agentWakeupRequests.idempotency_key, input.idempotencyKey),
        ),
      );
    return row ?? null;
  }

  async createWakeup(input: AgentMentionWakeup) {
    const [row] = await this.db
      .insert(agentWakeupRequests)
      .values({
        tenant_id: input.tenantId,
        agent_id: input.agentId,
        source: input.source,
        reason: input.reason,
        trigger_detail: input.triggerDetail,
        payload: input.payload,
        idempotency_key: input.idempotencyKey,
        requested_by_actor_type: input.requestedByActorType,
        requested_by_actor_id: input.requestedByActorId,
      })
      .returning({ id: agentWakeupRequests.id });
    return row;
  }
}
