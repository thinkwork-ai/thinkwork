import { and, eq, ne } from "drizzle-orm";
import { getDb } from "@thinkwork/database-pg";
import {
  computers,
  computerEvents,
  computerTasks,
} from "@thinkwork/database-pg/schema";
import { normalizeTaskInput } from "./tasks.js";

const db = getDb();

export function computerThreadCutoverEnabled(env = process.env) {
  const raw =
    env.THINKWORK_COMPUTER_THREAD_CUTOVER_ENABLED ??
    env.COMPUTER_THREAD_CUTOVER_ENABLED ??
    "";
  return ["1", "true", "enabled", "on"].includes(raw.toLowerCase());
}

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
    .select({ id: computerTasks.id })
    .from(computerTasks)
    .where(
      and(
        eq(computerTasks.tenant_id, input.tenantId),
        eq(computerTasks.computer_id, input.computerId),
        eq(computerTasks.idempotency_key, idempotencyKey),
      ),
    )
    .limit(1);
  if (existing) return existing;

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

  return task;
}
