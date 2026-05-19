import type { GraphQLContext } from "../../context.js";
import { GraphQLError } from "graphql";
import {
  db,
  eq,
  messageMentions,
  messages,
  threads,
  messageToCamel,
} from "../../utils.js";
import { notifyNewMessage, notifyThreadUpdate } from "../../notify.js";
import { resolveCallerFromAuth } from "../core/resolve-auth-user.js";
import {
  enqueueComputerThreadTurn,
  resolveThreadComputer,
  routeRunbookForComputerMessage,
} from "../../../lib/computers/thread-cutover.js";
import { recordThreadActivityForIdleLearning } from "../../../lib/thread-idle-learning/activity.js";
import { dispatchAgentMentions } from "../../../lib/mentions/dispatch-agent-mentions.js";
import { parseMessageMentions } from "../../../lib/mentions/parse-message-mentions.js";
import { loadThreadMentionTargets } from "../../../lib/mentions/thread-mention-targets.js";

export const sendMessage = async (
  _parent: any,
  args: any,
  ctx: GraphQLContext,
) => {
  const i = args.input;
  const senderType = i.senderType ?? "user";
  const senderId =
    senderType === "user"
      ? ((await resolveCallerFromAuth(ctx.auth)).userId ?? i.senderId)
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

  const isUserMessage = i.role.toLowerCase() === "user";
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
    await resolveThreadComputer({
      tenantId: thread.tenant_id,
      requesterUserId: senderId,
      requestedComputerId: thread.computer_id,
    });
  }

  // metadata.attachments is the message ↔ thread_attachments link for the
  // finance pilot (U3 of 2026-05-14-002). The presign/finalize handlers
  // already inserted the thread_attachments rows; sendMessage only
  // persists the UUID reference list on the message so chat-agent-invoke
  // can re-resolve the attachment rows at dispatch time. The full row
  // contents (s3_key, mime_type, size) live exclusively on the
  // thread_attachments table — never duplicated into messages.metadata.
  const parsedMetadata = i.metadata ? JSON.parse(i.metadata) : undefined;
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

  const [row] = await db
    .insert(messages)
    .values({
      thread_id: i.threadId,
      tenant_id: thread.tenant_id,
      role: i.role.toLowerCase(),
      content: i.content,
      sender_type: senderType,
      sender_id: senderId,
      tool_calls: i.toolCalls ? JSON.parse(i.toolCalls) : undefined,
      tool_results: i.toolResults ? JSON.parse(i.toolResults) : undefined,
      metadata: parsedMetadata,
    })
    .returning();

  if (parsedMentions.length > 0) {
    await db
      .insert(messageMentions)
      .values(
        parsedMentions.map((mention) => ({
          tenant_id: thread.tenant_id,
          thread_id: i.threadId,
          message_id: row.id,
          target_type: mention.targetType,
          target_id: mention.targetId,
          display_name: mention.displayName,
          raw_text: mention.rawText,
          start_offset: mention.startOffset,
          end_offset: mention.endOffset,
        })),
      )
      .onConflictDoNothing();
    try {
      await dispatchAgentMentions({
        tenantId: thread.tenant_id,
        threadId: i.threadId,
        spaceId: thread.space_id,
        messageId: row.id,
        content: i.content,
        mentions: parsedMentions,
        sender: { type: senderType, id: senderId },
      });
    } catch (err) {
      console.warn("[sendMessage] agent mention dispatch failed:", err);
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
      .set({ updated_at: new Date() })
      .where(eq(threads.id, i.threadId));
    notifyThreadUpdate({
      threadId: i.threadId,
      tenantId: thread.tenant_id,
      status: thread.status ?? "in_progress",
      title: thread.title,
    }).catch(() => {});
  }

  // Computer-owned Threads are picked up exclusively through the durable
  // Computer work queue. Agent fallback is intentionally disabled.
  if (i.role.toLowerCase() === "user" && thread.computer_id) {
    const handledByRunbook = await routeRunbookForComputerMessage({
      tenantId: thread.tenant_id,
      computerId: thread.computer_id,
      threadId: i.threadId,
      messageId: row.id,
      prompt: i.content ?? "",
      actorType: senderType,
      actorId: senderId,
    });
    if (handledByRunbook) {
      return messageToCamel(row);
    }
    await enqueueComputerThreadTurn({
      tenantId: thread.tenant_id,
      computerId: thread.computer_id,
      threadId: i.threadId,
      messageId: row.id,
      source: "chat_message",
      actorType: senderType,
      actorId: senderId,
    });
    return messageToCamel(row);
  }

  return messageToCamel(row);
};

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
