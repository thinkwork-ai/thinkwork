import { and, eq, inArray, ne } from "drizzle-orm";
import { getDb } from "@thinkwork/database-pg";
import {
  computers,
  computerAssignments,
  computerEvents,
  computerTasks,
  messages,
  threadAttachments,
  threads,
} from "@thinkwork/database-pg/schema";
import { invokeChatAgent } from "../../graphql/utils.js";
import { notifyThreadUpdate } from "../../graphql/notify.js";
import { ensureArtifactBuilderDefaults } from "./artifact-builder-defaults.js";
import { normalizeTaskInput } from "./tasks.js";

const db = getDb();

export async function resolveThreadComputer(input: {
  tenantId: string;
  ownerUserId?: string | null;
  requesterUserId?: string | null;
  requestedComputerId?: string | null;
}) {
  const requesterUserId = input.requesterUserId ?? input.ownerUserId ?? null;
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
    if (
      requesterUserId &&
      computer.owner_user_id !== requesterUserId &&
      !(await hasComputerRequesterAccess({
        tenantId: input.tenantId,
        computerId: computer.id,
        requesterUserId,
      }))
    ) {
      throw new Error("Computer is not assigned to requester");
    }
    return computer;
  }

  if (!requesterUserId) return null;
  const [computer] = await db
    .select({
      id: computers.id,
      owner_user_id: computers.owner_user_id,
    })
    .from(computers)
    .where(
      and(
        eq(computers.tenant_id, input.tenantId),
        eq(computers.owner_user_id, requesterUserId),
        ne(computers.status, "archived"),
      ),
    )
    .limit(1);
  return computer ?? null;
}

export async function hasComputerRequesterAccess(input: {
  tenantId: string;
  computerId: string;
  requesterUserId: string;
}) {
  const [direct] = await db
    .select({ id: computerAssignments.id })
    .from(computerAssignments)
    .where(
      and(
        eq(computerAssignments.tenant_id, input.tenantId),
        eq(computerAssignments.computer_id, input.computerId),
        eq(computerAssignments.subject_type, "user"),
        eq(computerAssignments.user_id, input.requesterUserId),
      ),
    )
    .limit(1);
  return Boolean(direct);
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
  const requesterUserId = taskRequesterUserId(taskInput);
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
      created_by_user_id: requesterUserId,
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
      requesterUserId,
      contextClass: requesterUserId ? "user" : "system",
      surfaceContext: recordValue(taskInput?.surfaceContext),
    },
  });

  await dispatchComputerThreadTurn({
    ...input,
    taskId: task.id,
  });

  return task;
}

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function taskRequesterUserId(input: Record<string, unknown> | null) {
  const value = input?.requesterUserId;
  return typeof value === "string" && value.trim() ? value.trim() : null;
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
      primary_agent_id: computers.primary_agent_id,
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

  const backingAgentId =
    computer?.primary_agent_id ?? computer?.migrated_from_agent_id ?? null;
  if (!backingAgentId) {
    await markDispatchFailed(input, {
      message: "Computer has no Strands backing agent configured",
      code: "missing_backing_agent",
    });
    return false;
  }

  const [message] = await db
    .select({
      content: messages.content,
      metadata: messages.metadata,
    })
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

  const messageAttachments = await resolveMessageAttachmentsForDispatch({
    tenantId: input.tenantId,
    metadata: message.metadata,
  });

  try {
    const recipeDefaults = await ensureArtifactBuilderDefaults({
      tenantId: input.tenantId,
      computerId: input.computerId,
    });
    if (!recipeDefaults.ensured) {
      await markDispatchFailed(input, {
        message: `Artifact Builder defaults could not be prepared: ${recipeDefaults.reason}`,
        code: "artifact_builder_defaults_missing",
      });
      return false;
    }
    if (
      recipeDefaults.written.length > 0 ||
      recipeDefaults.updated.length > 0
    ) {
      await db.insert(computerEvents).values({
        tenant_id: input.tenantId,
        computer_id: input.computerId,
        task_id: input.taskId,
        event_type: "artifact_builder_defaults_seeded",
        level: "info",
        payload: {
          agentSlug: recipeDefaults.agentSlug,
          written: recipeDefaults.written,
          updated: recipeDefaults.updated,
          skipped: recipeDefaults.skipped,
        },
      });
    }
  } catch (err) {
    await markDispatchFailed(input, {
      message: `Artifact Builder defaults could not be prepared: ${
        err instanceof Error ? err.message : String(err)
      }`,
      code: "artifact_builder_defaults_failed",
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
      agentId: backingAgentId,
      runtime: "strands",
    },
  });

  const invoked = await invokeChatAgent({
    tenantId: input.tenantId,
    threadId: input.threadId,
    agentId: backingAgentId,
    userMessage: message.content ?? "",
    messageId: input.messageId,
    computerId: input.computerId,
    computerTaskId: input.taskId,
    messageAttachments,
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
      and(
        eq(threads.tenant_id, input.tenantId),
        eq(threads.id, input.threadId),
      ),
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

/**
 * U3 of the finance pilot — finance attachment resolution at dispatch.
 *
 * `messages.metadata` is a free-form JSONB. The U3 contract restricts the
 * attachment portion to:
 *
 *     metadata.attachments: Array<{ attachmentId: string }>
 *
 * Read the list, defend against shape drift (non-array, non-string-uuid,
 * empty), and SELECT the actual `thread_attachments` rows with a
 * tenant pin (defense-in-depth even though sendMessage's mutation
 * already pinned the originating thread). Returns the row data the
 * Strands invoke payload carries — never `s3_key` alone, the full
 * record so the Strands side can boto3-download by key without an
 * additional API call.
 *
 * Empty input → empty output. Callers do NOT need to special-case the
 * "no attachments" path; the Strands turn loop skips the preamble when
 * the list is empty.
 */
export interface DispatchAttachment {
  attachmentId: string;
  s3Key: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
}

export async function resolveMessageAttachmentsForDispatch(input: {
  tenantId: string;
  metadata: unknown;
}): Promise<DispatchAttachment[]> {
  const list = readAttachmentIdList(input.metadata);
  if (list.length === 0) return [];

  const db = getDb();
  const rows = await db
    .select({
      id: threadAttachments.id,
      s3_key: threadAttachments.s3_key,
      name: threadAttachments.name,
      mime_type: threadAttachments.mime_type,
      size_bytes: threadAttachments.size_bytes,
    })
    .from(threadAttachments)
    .where(
      and(
        inArray(threadAttachments.id, list),
        eq(threadAttachments.tenant_id, input.tenantId),
      ),
    );

  // Preserve the metadata.attachments order so the model sees the file
  // list in the order the user attached them.
  const byId = new Map(rows.map((r) => [r.id, r]));
  const ordered: DispatchAttachment[] = [];
  for (const id of list) {
    const r = byId.get(id);
    if (!r || !r.s3_key || !r.name) continue;
    ordered.push({
      attachmentId: r.id,
      s3Key: r.s3_key,
      name: r.name,
      mimeType: r.mime_type ?? "application/octet-stream",
      sizeBytes: r.size_bytes ?? 0,
    });
  }
  return ordered;
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function readAttachmentIdList(metadata: unknown): string[] {
  if (!metadata || typeof metadata !== "object") return [];
  const m = metadata as Record<string, unknown>;
  const raw = m.attachments;
  if (!Array.isArray(raw)) return [];
  const ids: string[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const e = entry as Record<string, unknown>;
    const v = e.attachmentId;
    if (typeof v !== "string") continue;
    if (!UUID_RE.test(v)) continue;
    ids.push(v.toLowerCase());
  }
  return ids;
}
