import { and, eq, ne } from "drizzle-orm";
import { getDb } from "@thinkwork/database-pg";
import {
  computers,
  computerEvents,
  computerTasks,
  messages,
  threads,
} from "@thinkwork/database-pg/schema";
import { invokeChatAgent } from "../../graphql/utils.js";
import { notifyThreadUpdate } from "../../graphql/notify.js";
import { normalizeTaskInput } from "./tasks.js";

const db = getDb();

export async function resolveThreadComputer(input: {
  tenantId: string;
  ownerUserId?: string | null;
  requestedComputerId?: string | null;
}) {
  if (input.requestedComputerId) {
    const [computer] = await db
      .select({
        id: computers.id,
        owner_user_id: computers.owner_user_id,
      })
      .from(computers)
      .where(
        and(
          eq(computers.tenant_id, input.tenantId),
          eq(computers.id, input.requestedComputerId),
          ne(computers.status, "archived"),
        ),
      )
      .limit(1);
    if (!computer) throw new Error("Computer not found");
    if (input.ownerUserId && computer.owner_user_id !== input.ownerUserId) {
      throw new Error("Computer does not belong to thread owner");
    }
    return computer;
  }

  if (!input.ownerUserId) return null;
  const [computer] = await db
    .select({
      id: computers.id,
      owner_user_id: computers.owner_user_id,
    })
    .from(computers)
    .where(
      and(
        eq(computers.tenant_id, input.tenantId),
        eq(computers.owner_user_id, input.ownerUserId),
        ne(computers.status, "archived"),
      ),
    )
    .limit(1);
  return computer ?? null;
}

export async function enqueueComputerThreadTurn(input: {
  tenantId: string;
  computerId: string;
  threadId: string;
  messageId: string;
  source?: string;
  actorType?: string | null;
  actorId?: string | null;
}) {
  const taskInput = normalizeTaskInput("thread_turn", {
    threadId: input.threadId,
    messageId: input.messageId,
    source: input.source ?? "chat_message",
    actorType: input.actorType ?? null,
    actorId: input.actorId ?? null,
  });
  const idempotencyKey = `thread-turn:${input.threadId}:${input.messageId}`;
  const [existing] = await db
    .select({ id: computerTasks.id, status: computerTasks.status })
    .from(computerTasks)
    .where(
      and(
        eq(computerTasks.tenant_id, input.tenantId),
        eq(computerTasks.computer_id, input.computerId),
        eq(computerTasks.idempotency_key, idempotencyKey),
      ),
    )
    .limit(1);
  if (existing) {
    if (existing.status === "pending") {
      await dispatchComputerThreadTurn({
        ...input,
        taskId: existing.id,
      });
    }
    return existing;
  }

  const [task] = await db
    .insert(computerTasks)
    .values({
      tenant_id: input.tenantId,
      computer_id: input.computerId,
      task_type: "thread_turn",
      input: taskInput,
      idempotency_key: idempotencyKey,
      created_by_user_id: input.actorType === "user" ? input.actorId : null,
    })
    .returning({ id: computerTasks.id });

  await db.insert(computerEvents).values({
    tenant_id: input.tenantId,
    computer_id: input.computerId,
    task_id: task.id,
    event_type: "thread_turn_enqueued",
    level: "info",
    payload: {
      threadId: input.threadId,
      messageId: input.messageId,
      source: input.source ?? "chat_message",
    },
  });

  await dispatchComputerThreadTurn({
    ...input,
    taskId: task.id,
  });

  return task;
}

async function dispatchComputerThreadTurn(input: {
  tenantId: string;
  computerId: string;
  threadId: string;
  messageId: string;
  taskId: string;
}) {
  const [computer] = await db
    .select({
      id: computers.id,
      migrated_from_agent_id: computers.migrated_from_agent_id,
    })
    .from(computers)
    .where(
      and(
        eq(computers.tenant_id, input.tenantId),
        eq(computers.id, input.computerId),
      ),
    )
    .limit(1);

  if (!computer?.migrated_from_agent_id) {
    await markDispatchFailed(input, {
      message: "Computer has no Strands backing agent configured",
      code: "missing_backing_agent",
    });
    return false;
  }

  const [message] = await db
    .select({ content: messages.content })
    .from(messages)
    .where(
      and(
        eq(messages.tenant_id, input.tenantId),
        eq(messages.thread_id, input.threadId),
        eq(messages.id, input.messageId),
      ),
    )
    .limit(1);

  if (!message) {
    await markDispatchFailed(input, {
      message: "Thread turn message not found",
      code: "missing_message",
    });
    return false;
  }

  await db
    .update(computerTasks)
    .set({
      status: "running",
      claimed_at: new Date(),
      updated_at: new Date(),
    })
    .where(
      and(
        eq(computerTasks.tenant_id, input.tenantId),
        eq(computerTasks.computer_id, input.computerId),
        eq(computerTasks.id, input.taskId),
      ),
    );

  await db.insert(computerEvents).values({
    tenant_id: input.tenantId,
    computer_id: input.computerId,
    task_id: input.taskId,
    event_type: "thread_turn_dispatched",
    level: "info",
    payload: {
      threadId: input.threadId,
      messageId: input.messageId,
      agentId: computer.migrated_from_agent_id,
      runtime: "strands",
    },
  });

  const invoked = await invokeChatAgent({
    tenantId: input.tenantId,
    threadId: input.threadId,
    agentId: computer.migrated_from_agent_id,
    userMessage: message.content ?? "",
    messageId: input.messageId,
    computerId: input.computerId,
    computerTaskId: input.taskId,
  });

  if (!invoked) {
    await markDispatchFailed(input, {
      message: "Strands thread turn dispatch failed",
      code: "dispatch_failed",
    });
  }

  return invoked;
}

async function markDispatchFailed(
  input: {
    tenantId: string;
    computerId: string;
    taskId: string;
    threadId: string;
    messageId: string;
  },
  error: { message: string; code: string },
) {
  await db
    .update(computerTasks)
    .set({
      status: "failed",
      error,
      completed_at: new Date(),
      updated_at: new Date(),
    })
    .where(
      and(
        eq(computerTasks.tenant_id, input.tenantId),
        eq(computerTasks.computer_id, input.computerId),
        eq(computerTasks.id, input.taskId),
      ),
    );

  await db.insert(computerEvents).values({
    tenant_id: input.tenantId,
    computer_id: input.computerId,
    task_id: input.taskId,
    event_type: "thread_turn_dispatch_failed",
    level: "error",
    payload: {
      threadId: input.threadId,
      messageId: input.messageId,
      error,
    },
  });

  const [thread] = await db
    .select({ status: threads.status, title: threads.title })
    .from(threads)
    .where(
      and(eq(threads.tenant_id, input.tenantId), eq(threads.id, input.threadId)),
    )
    .limit(1);

  if (thread) {
    await notifyThreadUpdate({
      threadId: input.threadId,
      tenantId: input.tenantId,
      status: thread.status ?? "in_progress",
      title: thread.title ?? "Untitled thread",
    }).catch(() => {});
  }
}
