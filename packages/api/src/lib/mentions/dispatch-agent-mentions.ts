import { and, eq } from "drizzle-orm";
import { getDb } from "@thinkwork/database-pg";
import { agentWakeupRequests } from "@thinkwork/database-pg/schema";
import type { ParsedMention } from "./parse-message-mentions.js";

export interface AgentMentionWakeup {
  tenantId: string;
  agentId: string;
  source: "mention";
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
  mentions: ParsedMention[];
  sender?: {
    type?: string | null;
    id?: string | null;
  } | null;
}

export async function dispatchAgentMentions(
  input: DispatchAgentMentionInput,
  repository: AgentMentionDispatchRepository = new DrizzleAgentMentionDispatchRepository(),
) {
  const wakeups = buildAgentMentionWakeups(input);
  const results: Array<{
    agentId: string;
    enqueued: boolean;
    wakeupRequestId?: string;
  }> = [];

  for (const wakeup of wakeups) {
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
  }

  return results;
}

export function buildAgentMentionWakeups(
  input: DispatchAgentMentionInput,
): AgentMentionWakeup[] {
  return input.mentions
    .filter((mention) => mention.targetType === "agent")
    .map((mention) => ({
      tenantId: input.tenantId,
      agentId: mention.targetId,
      source: "mention",
      reason: `${mention.displayName} mentioned in Thread`,
      triggerDetail: `thread:${input.threadId}:message:${input.messageId}`,
      payload: {
        threadId: input.threadId,
        spaceId: input.spaceId ?? null,
        messageId: input.messageId,
        mention: {
          displayName: mention.displayName,
          rawText: mention.rawText,
          startOffset: mention.startOffset,
          endOffset: mention.endOffset,
        },
        message: input.content ?? "",
      },
      idempotencyKey: `agent-mention:${input.tenantId}:${input.messageId}:${mention.targetId}`,
      requestedByActorType: input.sender?.type ?? "user",
      requestedByActorId: input.sender?.id ?? null,
    }));
}

class DrizzleAgentMentionDispatchRepository
  implements AgentMentionDispatchRepository
{
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
