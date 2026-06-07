import type { GraphQLContext } from "../../context.js";
import { GraphQLError } from "graphql";
import {
  db,
  and,
  eq,
  messageMentions,
  messages,
  agents,
  threadParticipants,
  threads,
  messageToCamel,
} from "../../utils.js";
import { notifyNewMessage, notifyThreadUpdate } from "../../notify.js";
import { resolveCallerFromAuth } from "../core/resolve-auth-user.js";
import { recordThreadActivityForIdleLearning } from "../../../lib/thread-idle-learning/activity.js";
import { dispatchAgentMentions } from "../../../lib/mentions/dispatch-agent-mentions.js";
import { parseMessageMentions } from "../../../lib/mentions/parse-message-mentions.js";
import {
  insertMentionParticipants,
  toThreadParticipantInsert,
} from "../../../lib/mentions/thread-participant-mentions.js";
import { loadThreadMentionTargets } from "../../../lib/mentions/thread-mention-targets.js";
import { dispatchDefaultAgentChatTurn } from "../../../lib/mentions/default-agent-routing.js";
import { markSenderParticipantRead } from "../../../lib/threads/thread-unread-state.js";
import { callerVisibleThreadPredicate } from "../threads/access.js";
import { applyCustomerOnboardingChatUpdate } from "../../../lib/spaces/customer-onboarding-chat-updates.js";
import {
  canonicalizeMessageAttachmentMetadata,
  MessageAttachmentRefsError,
} from "../../../lib/thread-attachments/message-attachment-refs.js";
import {
  normalizeMessageSenderType,
  shouldApplyCustomerOnboardingChatUpdate,
  shouldDispatchDefaultAgentTurn,
} from "./sendMessage.agent-handling.js";
import {
  assertUserModelApproved,
  ModelApprovalError,
} from "../../../lib/model-approvals.js";
import {
  modelApprovalGraphQLError,
  resolveRequestedModelId,
  withRequestedModelMetadata,
} from "../../../lib/turn-model-selection.js";

export const sendMessage = async (
  _parent: any,
  args: any,
  ctx: GraphQLContext,
) => {
  const i = args.input;
  const role = i.role.toLowerCase();
  const senderType = normalizeMessageSenderType(i.senderType);
  const senderId =
    senderType === "user"
      ? ((await resolveCallerFromAuth(ctx.auth)).userId ?? i.senderId)
      : senderType === "agent"
        ? (i.senderId ?? ctx.auth.agentId)
        : i.senderId;
  const [thread] = await db
    .select({
      tenant_id: threads.tenant_id,
      computer_id: threads.computer_id,
      space_id: threads.space_id,
      user_id: threads.user_id,
      title: threads.title,
      status: threads.status,
    })
    .from(threads)
    .where(eq(threads.id, i.threadId));
  if (!thread) throw new Error("Thread not found");
  if (senderType === "agent" && senderId) {
    const [agent] = await db
      .select({ id: agents.id })
      .from(agents)
      .where(
        and(eq(agents.id, senderId), eq(agents.tenant_id, thread.tenant_id)),
      )
      .limit(1);
    if (!agent) {
      throw new GraphQLError("Agent sender is not available in this tenant", {
        extensions: { code: "FORBIDDEN" },
      });
    }
  }

  const isUserMessage = role === "user";
  if (
    isUserMessage &&
    senderType === "user" &&
    ctx.auth.authType === "cognito" &&
    !senderId
  ) {
    throw new GraphQLError("Requester user identity required", {
      extensions: { code: "UNAUTHENTICATED" },
    });
  }
  if (isUserMessage && thread.computer_id && senderType === "user") {
    if (!senderId) {
      throw new GraphQLError("Requester user identity required", {
        extensions: { code: "UNAUTHENTICATED" },
      });
    }
    if (thread.user_id && thread.user_id !== senderId) {
      throw new GraphQLError("Thread does not belong to requester", {
        extensions: { code: "FORBIDDEN" },
      });
    }
  }
  if (
    isUserMessage &&
    senderType === "user" &&
    ctx.auth.authType === "cognito"
  ) {
    const [visibleThread] = await db
      .select({ id: threads.id })
      .from(threads)
      .where(
        and(
          eq(threads.id, i.threadId),
          eq(threads.tenant_id, thread.tenant_id),
          callerVisibleThreadPredicate(thread.tenant_id, senderId),
        ),
      );
    if (!visibleThread) {
      throw new GraphQLError("Thread does not belong to requester", {
        extensions: { code: "FORBIDDEN" },
      });
    }
  }

  // metadata.attachments is the message ↔ thread_attachments link for the
  // finance pilot (U3 of 2026-05-14-002). The presign/finalize handlers
  // already inserted the thread_attachments rows; sendMessage only
  // persists the UUID reference list on the message so chat-agent-invoke
  // can re-resolve the attachment rows at dispatch time. The full row
  // contents (s3_key, mime_type, size) live exclusively on the
  // thread_attachments table — never duplicated into messages.metadata.
  const parsedMetadata = i.metadata ? JSON.parse(i.metadata) : undefined;
  const requestedModelId = resolveRequestedModelId({
    modelId: i.modelId,
    metadata: parsedMetadata,
  });
  if (isUserMessage && requestedModelId) {
    if (senderType !== "user" || !senderId) {
      throw new GraphQLError("Requester user identity required", {
        extensions: { code: "UNAUTHENTICATED" },
      });
    }
    try {
      await assertUserModelApproved({
        tenantId: thread.tenant_id,
        userId: senderId,
        modelId: requestedModelId,
      });
    } catch (err) {
      if (err instanceof ModelApprovalError) {
        throw modelApprovalGraphQLError(err);
      }
      throw err;
    }
  }
  let canonicalMetadata: Record<string, unknown> | undefined;
  try {
    canonicalMetadata = await canonicalizeMessageAttachmentMetadata({
      db,
      tenantId: thread.tenant_id,
      threadId: i.threadId,
      metadata: parsedMetadata,
    });
  } catch (err) {
    if (err instanceof MessageAttachmentRefsError) {
      throw new GraphQLError(err.message, {
        extensions: { code: "BAD_USER_INPUT" },
      });
    }
    throw err;
  }
  canonicalMetadata = withRequestedModelMetadata(
    canonicalMetadata,
    requestedModelId,
  );
  const mentionTargets = await loadThreadMentionTargets({
    tenantId: thread.tenant_id,
    threadId: i.threadId,
  });
  validateExplicitMentions(i.mentions, mentionTargets);
  const parsedMentions = parseMessageMentions({
    content: i.content,
    targets: mentionTargets,
    explicitMentions: i.mentions,
  });
  const messageActivityAt = new Date();

  const row = await db.transaction(async (tx) => {
    const [messageRow] = await tx
      .insert(messages)
      .values({
        thread_id: i.threadId,
        tenant_id: thread.tenant_id,
        role,
        content: i.content,
        sender_type: senderType,
        sender_id: senderId,
        tool_calls: i.toolCalls ? JSON.parse(i.toolCalls) : undefined,
        tool_results: i.toolResults ? JSON.parse(i.toolResults) : undefined,
        metadata: canonicalMetadata,
        created_at: messageActivityAt,
      })
      .returning();

    if (parsedMentions.length > 0) {
      await tx
        .insert(messageMentions)
        .values(
          parsedMentions.map((mention) => ({
            tenant_id: thread.tenant_id,
            thread_id: i.threadId,
            message_id: messageRow.id,
            target_type: mention.targetType,
            target_id: mention.targetId,
            display_name: mention.displayName,
            raw_text: mention.rawText,
            start_offset: mention.startOffset,
            end_offset: mention.endOffset,
          })),
        )
        .onConflictDoNothing();

      await insertMentionParticipants(
        {
          tenantId: thread.tenant_id,
          threadId: i.threadId,
          spaceId: thread.space_id,
          mentions: parsedMentions,
          targets: mentionTargets,
        },
        {
          async insertParticipants(rows) {
            await tx
              .insert(threadParticipants)
              .values(rows.map(toThreadParticipantInsert))
              .onConflictDoNothing();
          },
        },
      );
    }

    await markSenderParticipantRead(
      {
        tenantId: thread.tenant_id,
        threadId: i.threadId,
        senderType,
        senderId,
        readAt: messageActivityAt,
      },
      {
        async markUserParticipantRead(input) {
          await tx
            .update(threadParticipants)
            .set({ last_read_at: input.readAt, updated_at: new Date() })
            .where(
              and(
                eq(threadParticipants.tenant_id, input.tenantId),
                eq(threadParticipants.thread_id, input.threadId),
                eq(threadParticipants.participant_type, "user"),
                eq(threadParticipants.user_id, input.userId),
              ),
            );
        },
      },
    );

    return messageRow;
  });

  const hasAgentMentions = parsedMentions.some(
    (mention) => mention.targetType === "agent",
  );
  const requestedProfileSlug = profileSlugFromMentions(
    parsedMentions,
    mentionTargets,
  );
  let customerOnboardingHandled = false;
  let responseMessage = row;
  if (
    shouldApplyCustomerOnboardingChatUpdate({
      isUserMessage,
      senderType,
      agentRequested: i.agentRequested,
      dispatchMode: i.dispatchMode,
      hasAgentMentions,
    })
  ) {
    try {
      const onboardingUpdate = await applyCustomerOnboardingChatUpdate({
        tenantId: thread.tenant_id,
        threadId: i.threadId,
        content: i.content,
        senderUserId: senderId,
      });
      customerOnboardingHandled =
        (onboardingUpdate?.handled ?? false) &&
        !onboardingUpdate?.agentDispatchRequired;
      if (customerOnboardingHandled) {
        const handledMetadata = {
          ...(canonicalMetadata ?? {}),
          customerOnboardingChatUpdate: {
            handled: true,
            agentDispatchRequired: false,
            statusChanges: onboardingUpdate?.statusChanges ?? [],
            assignmentChanges: onboardingUpdate?.assignmentChanges ?? [],
            addedTasks: onboardingUpdate?.addedTasks ?? [],
            removedTasks: onboardingUpdate?.removedTasks ?? [],
          },
        };
        const [updatedMessage] = await db
          .update(messages)
          .set({ metadata: handledMetadata })
          .where(eq(messages.id, row.id))
          .returning();
        if (updatedMessage) {
          responseMessage = updatedMessage;
        }
      }
      if (onboardingUpdate?.assistantMessageId) {
        notifyNewMessage({
          messageId: onboardingUpdate.assistantMessageId,
          threadId: i.threadId,
          tenantId: thread.tenant_id,
          role: "assistant",
          content: onboardingUpdate.assistantContent,
          senderType: "system",
        }).catch(() => {});
      }
    } catch (err) {
      console.warn(
        "[sendMessage] customer onboarding chat update failed:",
        err,
      );
    }
  }
  if (hasAgentMentions) {
    try {
      await dispatchAgentMentions({
        tenantId: thread.tenant_id,
        threadId: i.threadId,
        spaceId: thread.space_id,
        messageId: row.id,
        content: i.content,
        mentions: parsedMentions,
        requestedModelId,
        sender: { type: senderType, id: senderId },
      });
    } catch (err) {
      console.warn("[sendMessage] agent mention dispatch failed:", err);
    }
  }
  if (
    shouldDispatchDefaultAgentTurn({
      isUserMessage,
      senderType,
      agentRequested: i.agentRequested,
      dispatchMode: i.dispatchMode,
      hasAgentMentions,
      hasComputerThread: Boolean(thread.computer_id),
      customerOnboardingHandled,
    })
  ) {
    try {
      await dispatchDefaultAgentChatTurn({
        tenantId: thread.tenant_id,
        threadId: i.threadId,
        spaceId: thread.space_id,
        messageId: row.id,
        content: i.content,
        requestedModelId,
        requestedProfileSlug,
        sender: { type: senderType, id: senderId },
      });
    } catch (err) {
      console.warn("[sendMessage] default agent dispatch failed:", err);
    }
  }

  notifyNewMessage({
    messageId: row.id,
    threadId: i.threadId,
    tenantId: thread.tenant_id,
    role: row.role,
    content: row.content ?? undefined,
    senderType,
    senderId: senderId ?? undefined,
  }).catch(() => {});

  // Auto-generate thread title from first user message (no updated_at bump)
  if (isUserMessage && i.content && thread.title === "Untitled conversation") {
    const raw = i.content.trim();
    const autoTitle =
      raw.length <= 80 ? raw : raw.substring(0, 80).replace(/\s+\S*$/, "...");
    await db
      .update(threads)
      .set({ title: autoTitle })
      .where(eq(threads.id, i.threadId));
  }
  if (
    isUserMessage &&
    thread.computer_id &&
    senderType === "user" &&
    !thread.user_id
  ) {
    await db
      .update(threads)
      .set({ user_id: senderId })
      .where(eq(threads.id, i.threadId));
  }

  if (thread.computer_id) {
    const requesterUserId =
      isUserMessage && senderType === "user" ? senderId : thread.user_id;
    if (requesterUserId) {
      try {
        const idleLearning = await recordThreadActivityForIdleLearning({
          tenantId: thread.tenant_id,
          threadId: i.threadId,
          computerId: thread.computer_id,
          requesterUserId,
          source: isUserMessage ? "user_message" : "assistant_response",
        });
        if (!idleLearning.ok) {
          console.warn(
            "[sendMessage] idle-memory schedule failed:",
            idleLearning.error,
          );
        }
      } catch (err) {
        console.warn("[sendMessage] idle-memory schedule failed:", err);
      }
    }
  }

  // Computer-owned user messages should NOT move the thread to the top — that
  // happens when the Computer responds (via chat-agent-invoke.ts). Space
  // collaboration without a Computer needs human messages to refresh activity
  // immediately so other participants get unread Inbox state.
  if (!isUserMessage || !thread.computer_id) {
    await db
      .update(threads)
      .set({ updated_at: messageActivityAt })
      .where(eq(threads.id, i.threadId));
    notifyThreadUpdate({
      threadId: i.threadId,
      tenantId: thread.tenant_id,
      status: thread.status ?? "in_progress",
      title: thread.title,
    }).catch(() => {});
  }

  return messageToCamel(responseMessage);
};

function profileSlugFromMentions(
  mentions: Array<{ targetType: string; targetId: string }>,
  targets: Array<{ targetType: string; targetId: string; aliases?: string[] }>,
) {
  const profileMention = mentions.find(
    (mention) => mention.targetType === "agent_profile",
  );
  if (!profileMention) return null;
  const target = targets.find(
    (candidate) =>
      candidate.targetType === profileMention.targetType &&
      candidate.targetId === profileMention.targetId,
  );
  const slug = target?.aliases?.find((alias) =>
    /^[a-z0-9][a-z0-9_-]*$/i.test(alias),
  );
  return slug?.toLowerCase() ?? null;
}

function validateExplicitMentions(
  mentions: Array<{ targetType: string; targetId: string }> | null | undefined,
  targets: Array<{ targetType: string; targetId: string }>,
) {
  if (!mentions?.length) return;
  const allowed = new Set(
    targets.map(
      (target) => `${target.targetType.toLowerCase()}:${target.targetId}`,
    ),
  );
  for (const mention of mentions) {
    const key = `${mention.targetType.toLowerCase()}:${mention.targetId}`;
    if (!allowed.has(key)) {
      throw new GraphQLError("Mention target is not available in this Thread", {
        extensions: { code: "BAD_USER_INPUT" },
      });
    }
  }
}
