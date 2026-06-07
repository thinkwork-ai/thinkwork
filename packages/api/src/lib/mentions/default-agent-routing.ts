import { and, asc, eq, isNotNull, isNull } from "drizzle-orm";
import { getDb } from "@thinkwork/database-pg";
import {
  agentWakeupRequests,
  threadParticipants,
  threads,
} from "@thinkwork/database-pg/schema";
import {
  PlatformAgentNotFoundError,
  resolveTenantPlatformAgent,
} from "../agents/tenant-platform-agent.js";
import {
  type DispatchMessageAttachment,
  resolveDispatchMessageAttachments,
} from "../thread-attachments/message-attachment-refs.js";
import { resolveDispatchPinnedSkills } from "../skills/message-pinned-skills.js";

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
  assignThreadDefaultAgent(input: {
    tenantId: string;
    threadId: string;
    agentId: string;
  }): Promise<void>;
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
  requestedModelId?: string | null;
  requestedProfileSlug?: string | null;
  sender?: {
    type?: string | null;
    id?: string | null;
  } | null;
}

export interface DefaultAgentChatInvoke {
  tenantId: string;
  threadId: string;
  agentId: string;
  userMessage: string;
  messageId: string;
  /**
   * Finalized attachment records the USER message references. Resolved from
   * `messages.metadata.attachments` and forwarded to chat-agent-invoke so the
   * agent can read uploaded files on the direct-invoke path (parity with the
   * wakeup-processor path).
   */
  messageAttachments?: DispatchMessageAttachment[];
  /**
   * Force-pinned skill slugs the USER message references. Resolved from
   * `messages.metadata.skills` and forwarded to chat-agent-invoke, which applies
   * the blocklist guardrail and turns them into the ephemeral `pinned_skills`
   * payload branch for the Pi runtime (U3/U4). Raw (unfiltered) here.
   */
  pinnedSkills?: string[];
  requestedModelId?: string;
  requestedProfileSlug?: string;
}

export interface DefaultAgentChatExecutor {
  invokeChatAgent(input: DefaultAgentChatInvoke): Promise<boolean>;
}

export type DispatchMessageAttachmentResolver = (input: {
  tenantId: string;
  threadId: string;
  messageId: string;
}) => Promise<DispatchMessageAttachment[]>;

const defaultAttachmentResolver: DispatchMessageAttachmentResolver = (input) =>
  resolveDispatchMessageAttachments({ db: getDb(), ...input });

export type DispatchPinnedSkillsResolver = (input: {
  tenantId: string;
  threadId: string;
  messageId: string;
}) => Promise<string[]>;

const defaultPinnedSkillsResolver: DispatchPinnedSkillsResolver = (input) =>
  resolveDispatchPinnedSkills({ db: getDb(), ...input });

export async function dispatchDefaultAgentChatTurn(
  input: DispatchDefaultAgentTurnInput,
  repository: DefaultAgentRoutingRepository = new DrizzleDefaultAgentRoutingRepository(),
  executor: DefaultAgentChatExecutor = defaultChatExecutor,
  resolveAttachments: DispatchMessageAttachmentResolver = defaultAttachmentResolver,
  resolvePinnedSkills: DispatchPinnedSkillsResolver = defaultPinnedSkillsResolver,
) {
  const defaultAgent = await repository.loadDefaultAgent({
    tenantId: input.tenantId,
    threadId: input.threadId,
  });
  if (!defaultAgent) return null;

  await repository.assignThreadDefaultAgent({
    tenantId: input.tenantId,
    threadId: input.threadId,
    agentId: defaultAgent.agentId,
  });

  // Resolve uploaded-file attachments the message references so the agent can
  // read them on the direct-invoke path. The wakeup-processor fallback already
  // resolves these independently, so only the direct call needs them here.
  let messageAttachments: DispatchMessageAttachment[] = [];
  try {
    messageAttachments = await resolveAttachments({
      tenantId: input.tenantId,
      threadId: input.threadId,
      messageId: input.messageId,
    });
  } catch (err) {
    console.error(
      "[default-agent-routing] Failed to resolve message attachments for dispatch:",
      err,
    );
  }

  // Resolve force-pinned skills the message references (composer slash-command).
  // Raw slugs only — chat-agent-invoke applies the blocklist guardrail.
  let pinnedSkills: string[] = [];
  try {
    pinnedSkills = await resolvePinnedSkills({
      tenantId: input.tenantId,
      threadId: input.threadId,
      messageId: input.messageId,
    });
  } catch (err) {
    console.error(
      "[default-agent-routing] Failed to resolve pinned skills for dispatch:",
      err,
    );
  }

  const directInvoked = await executor.invokeChatAgent({
    tenantId: input.tenantId,
    threadId: input.threadId,
    agentId: defaultAgent.agentId,
    messageId: input.messageId,
    userMessage: input.content ?? "",
    ...(messageAttachments.length > 0 ? { messageAttachments } : {}),
    ...(pinnedSkills.length > 0 ? { pinnedSkills } : {}),
    ...(input.requestedModelId
      ? { requestedModelId: input.requestedModelId }
      : {}),
    ...(input.requestedProfileSlug
      ? { requestedProfileSlug: input.requestedProfileSlug }
      : {}),
  });
  if (directInvoked) {
    return {
      agentId: defaultAgent.agentId,
      directInvoked: true,
      enqueued: false,
      wakeupRequestId: null,
    };
  }

  const wakeup = buildDefaultAgentTurnWakeup({
    ...input,
    agentId: defaultAgent.agentId,
  });
  const fallback = await enqueueDefaultAgentWakeup(wakeup, repository);
  return {
    agentId: defaultAgent.agentId,
    directInvoked: false,
    ...fallback,
  };
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
  await repository.assignThreadDefaultAgent({
    tenantId: input.tenantId,
    threadId: input.threadId,
    agentId: wakeup.agentId,
  });
  const enqueued = await enqueueDefaultAgentWakeup(wakeup, repository);
  return {
    agentId: wakeup.agentId,
    ...enqueued,
  };
}

async function enqueueDefaultAgentWakeup(
  wakeup: DefaultAgentTurnWakeup,
  repository: DefaultAgentRoutingRepository,
) {
  const existing = await repository.findExistingWakeup({
    tenantId: wakeup.tenantId,
    agentId: wakeup.agentId,
    idempotencyKey: wakeup.idempotencyKey,
  });
  if (existing) {
    return {
      enqueued: false,
      wakeupRequestId: existing.id,
    };
  }

  const created = await repository.createWakeup(wakeup);
  return {
    enqueued: true,
    wakeupRequestId: created.id,
  };
}

const defaultChatExecutor: DefaultAgentChatExecutor = {
  async invokeChatAgent(input) {
    const { invokeChatAgent } = await import("../../graphql/utils.js");
    return invokeChatAgent(input);
  },
};

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
      ...(input.requestedModelId
        ? {
            modelId: input.requestedModelId,
            requestedModelId: input.requestedModelId,
          }
        : {}),
      ...(input.requestedProfileSlug
        ? { requestedProfileSlug: input.requestedProfileSlug }
        : {}),
    },
    idempotencyKey: `agent-default:${input.tenantId}:${input.messageId}:${input.agentId}`,
    requestedByActorType: input.sender?.type ?? "user",
    requestedByActorId: input.sender?.id ?? null,
  };
}

class DrizzleDefaultAgentRoutingRepository implements DefaultAgentRoutingRepository {
  private readonly db = getDb();

  async loadDefaultAgent(input: { tenantId: string; threadId: string }) {
    const [thread] = await this.db
      .select({ agentId: threads.agent_id, computerId: threads.computer_id })
      .from(threads)
      .where(
        and(
          eq(threads.tenant_id, input.tenantId),
          eq(threads.id, input.threadId),
        ),
      )
      .limit(1);
    if (!thread || thread.computerId) return null;
    if (thread.agentId) return { agentId: thread.agentId };

    try {
      const platformAgent = await resolveTenantPlatformAgent(
        input.tenantId,
        this.db,
      );
      return { agentId: platformAgent.id };
    } catch (error) {
      if (!(error instanceof PlatformAgentNotFoundError)) throw error;
    }

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
    return null;
  }

  async assignThreadDefaultAgent(input: {
    tenantId: string;
    threadId: string;
    agentId: string;
  }) {
    await this.db
      .update(threads)
      .set({ agent_id: input.agentId })
      .where(
        and(
          eq(threads.tenant_id, input.tenantId),
          eq(threads.id, input.threadId),
          isNull(threads.agent_id),
          isNull(threads.computer_id),
        ),
      );
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
