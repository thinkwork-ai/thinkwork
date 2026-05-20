import { and, asc, eq, isNotNull } from "drizzle-orm";
import { getDb } from "@thinkwork/database-pg";
import {
  agentWakeupRequests,
  threadParticipants,
  threads,
} from "@thinkwork/database-pg/schema";

export interface DefaultAgentTurnWakeup {
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

export interface DefaultAgentRoutingRepository {
  loadDefaultAgent(input: {
    tenantId: string;
    threadId: string;
  }): Promise<{ agentId: string } | null>;
  findExistingWakeup(input: {
    tenantId: string;
    agentId: string;
    idempotencyKey: string;
  }): Promise<{ id: string } | null>;
  createWakeup(input: DefaultAgentTurnWakeup): Promise<{ id: string }>;
}

export interface DispatchDefaultAgentTurnInput {
  tenantId: string;
  threadId: string;
  spaceId?: string | null;
  messageId: string;
  content?: string | null;
  sender?: {
    type?: string | null;
    id?: string | null;
  } | null;
}

export async function dispatchDefaultAgentTurn(
  input: DispatchDefaultAgentTurnInput,
  repository: DefaultAgentRoutingRepository = new DrizzleDefaultAgentRoutingRepository(),
) {
  const defaultAgent = await repository.loadDefaultAgent({
    tenantId: input.tenantId,
    threadId: input.threadId,
  });
  if (!defaultAgent) return null;

  const wakeup = buildDefaultAgentTurnWakeup({
    ...input,
    agentId: defaultAgent.agentId,
  });
  const existing = await repository.findExistingWakeup({
    tenantId: wakeup.tenantId,
    agentId: wakeup.agentId,
    idempotencyKey: wakeup.idempotencyKey,
  });
  if (existing) {
    return {
      agentId: wakeup.agentId,
      enqueued: false,
      wakeupRequestId: existing.id,
    };
  }

  const created = await repository.createWakeup(wakeup);
  return {
    agentId: wakeup.agentId,
    enqueued: true,
    wakeupRequestId: created.id,
  };
}

export function buildDefaultAgentTurnWakeup(
  input: DispatchDefaultAgentTurnInput & { agentId: string },
): DefaultAgentTurnWakeup {
  return {
    tenantId: input.tenantId,
    agentId: input.agentId,
    source: "chat_message",
    reason: "New Thread message",
    triggerDetail: `thread:${input.threadId}:message:${input.messageId}`,
    payload: {
      threadId: input.threadId,
      spaceId: input.spaceId ?? null,
      messageId: input.messageId,
      userMessage: input.content ?? "",
      message: input.content ?? "",
    },
    idempotencyKey: `agent-default:${input.tenantId}:${input.messageId}:${input.agentId}`,
    requestedByActorType: input.sender?.type ?? "user",
    requestedByActorId: input.sender?.id ?? null,
  };
}

class DrizzleDefaultAgentRoutingRepository implements DefaultAgentRoutingRepository {
  private readonly db = getDb();

  async loadDefaultAgent(input: { tenantId: string; threadId: string }) {
    const [participant] = await this.db
      .select({ agentId: threadParticipants.agent_id })
      .from(threadParticipants)
      .where(
        and(
          eq(threadParticipants.tenant_id, input.tenantId),
          eq(threadParticipants.thread_id, input.threadId),
          eq(threadParticipants.participant_type, "agent"),
          eq(threadParticipants.notification_preference, "subscribed"),
          isNotNull(threadParticipants.agent_id),
        ),
      )
      .orderBy(asc(threadParticipants.created_at), asc(threadParticipants.id))
      .limit(1);
    if (participant?.agentId) return { agentId: participant.agentId };

    const [thread] = await this.db
      .select({ agentId: threads.agent_id })
      .from(threads)
      .where(
        and(
          eq(threads.tenant_id, input.tenantId),
          eq(threads.id, input.threadId),
        ),
      )
      .limit(1);
    return thread?.agentId ? { agentId: thread.agentId } : null;
  }

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

  async createWakeup(input: DefaultAgentTurnWakeup) {
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
