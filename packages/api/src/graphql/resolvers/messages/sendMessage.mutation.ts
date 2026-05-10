import type { GraphQLContext } from "../../context.js";
import { db, eq, messages, threads, messageToCamel } from "../../utils.js";
import { notifyThreadUpdate } from "../../notify.js";
import { resolveCallerFromAuth } from "../core/resolve-auth-user.js";
import {
  enqueueComputerThreadTurn,
  routeRunbookForComputerMessage,
} from "../../../lib/computers/thread-cutover.js";

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
      title: threads.title,
      status: threads.status,
    })
    .from(threads)
    .where(eq(threads.id, i.threadId));
  if (!thread) throw new Error("Thread not found");

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
      metadata: i.metadata ? JSON.parse(i.metadata) : undefined,
    })
    .returning();

  const isUserMessage = i.role.toLowerCase() === "user";

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

  // Only bump updated_at and notify for non-user messages (agent responses).
  // User messages should NOT move the thread to the top — that happens when
  // the agent responds (via chat-agent-invoke.ts).
  if (!isUserMessage) {
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
