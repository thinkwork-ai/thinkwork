import { and, eq, inArray, ne, sql } from "drizzle-orm";
import { getDb } from "@thinkwork/database-pg";
import {
  computers,
  computerAssignments,
  computerEvents,
  computerTasks,
  messages,
  teamUsers,
  threadAttachments,
  threads,
} from "@thinkwork/database-pg/schema";
import type { RunbookDefinition } from "../runbooks/definition.js";
import { invokeChatAgent } from "../../graphql/utils.js";
import { notifyNewMessage, notifyThreadUpdate } from "../../graphql/notify.js";
import { ensureArtifactBuilderDefaults } from "./artifact-builder-defaults.js";
import { normalizeTaskInput } from "./tasks.js";
import {
  buildRunbookAmbiguityMessage,
  buildRunbookConfirmationMessage,
  buildRunbookQueueMessage,
  buildRunbookUnavailableMessage,
  buildUnmatchedRunbookSkillMessage,
  type RunbookMessagePart,
} from "../runbooks/confirmation-message.js";
import { taskQueueThreadMetadata } from "../task-queues/message-parts.js";
import { seedRunbookCatalogForTenant } from "../runbooks/catalog.js";
import {
  confirmRunbookRun,
  createRunbookRun,
  failRunbookRunFromThreadTurn,
  getRunbookRun,
  markRunbookRunRunning,
} from "../runbooks/runs.js";
import { mentionsRunbook, routeRunbookPrompt } from "../runbooks/router.js";
import {
  listAssignedComputerRunbookSkills,
  type ComputerRunbookSkill,
} from "../runbooks/skill-discovery.js";

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
  if (direct) return true;

  const [team] = await db
    .select({ id: computerAssignments.id })
    .from(computerAssignments)
    .innerJoin(teamUsers, eq(teamUsers.team_id, computerAssignments.team_id))
    .where(
      and(
        eq(computerAssignments.tenant_id, input.tenantId),
        eq(computerAssignments.computer_id, input.computerId),
        eq(computerAssignments.subject_type, "team"),
        eq(teamUsers.tenant_id, input.tenantId),
        eq(teamUsers.user_id, input.requesterUserId),
      ),
    )
    .limit(1);
  return Boolean(team);
}

export async function enqueueComputerThreadTurn(input: {
  tenantId: string;
  computerId: string;
  threadId: string;
  messageId: string;
  source?: string;
  actorType?: string | null;
  actorId?: string | null;
  runbookRunId?: string | null;
}) {
  const taskInput = normalizeTaskInput("thread_turn", {
    threadId: input.threadId,
    messageId: input.messageId,
    source: input.source ?? "chat_message",
    actorType: input.actorType ?? null,
    actorId: input.actorId ?? null,
    runbookRunId: input.runbookRunId ?? null,
  });
  const requesterUserId = taskRequesterUserId(taskInput);
  const idempotencyKey = input.runbookRunId
    ? `runbook-thread-turn:${input.runbookRunId}`
    : `thread-turn:${input.threadId}:${input.messageId}`;
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

export async function routeRunbookForComputerMessage(input: {
  tenantId: string;
  computerId: string;
  threadId: string;
  messageId: string;
  prompt: string;
  actorType?: string | null;
  actorId?: string | null;
  discoverRunbookSkills?: (input: {
    tenantId: string;
    computerId: string;
  }) => Promise<ComputerRunbookSkill[]>;
}) {
  const runbooks = await (
    input.discoverRunbookSkills ?? listAssignedComputerRunbookSkills
  )({
    tenantId: input.tenantId,
    computerId: input.computerId,
  });
  const route = routeRunbookPrompt({
    prompt: input.prompt,
    runbooks,
  });

  if (route.kind === "no_match") {
    if (!mentionsRunbook(input.prompt)) return false;

    const message = buildUnmatchedRunbookSkillMessage({
      assignedRunbooks: runbooks,
    });
    await persistRunbookAssistantMessage({
      tenantId: input.tenantId,
      threadId: input.threadId,
      computerId: input.computerId,
      key: `runbook-unmatched:${input.messageId}`,
      content: message.content,
      parts: message.parts,
      metadata: {
        routeKind: "no_match",
        sourceMessageId: input.messageId,
        explicitRunbookIntent: true,
        assignedRunbookSlugs: runbooks.map((runbook) => runbook.slug),
      },
    });
    return true;
  }

  if (route.kind === "ambiguous") {
    const message = buildRunbookAmbiguityMessage({
      candidates: route.candidates,
    });
    await persistRunbookAssistantMessage({
      tenantId: input.tenantId,
      threadId: input.threadId,
      computerId: input.computerId,
      key: `runbook-ambiguous:${input.messageId}`,
      content: message.content,
      parts: message.parts,
      metadata: {
        routeKind: "ambiguous",
        sourceMessageId: input.messageId,
        candidates: route.candidates.map((candidate) => ({
          slug: candidate.runbook.slug,
          confidence: candidate.confidence,
        })),
      },
    });
    return true;
  }

  const catalog = await seedRunbookCatalogForTenant({
    tenantId: input.tenantId,
    definitions: runbooks,
  });
  const catalogItem = catalog.find((item) => item.slug === route.runbook.slug);
  if (!isCatalogItemAvailable(catalogItem)) {
    const message = buildRunbookUnavailableMessage({ runbook: route.runbook });
    await persistRunbookAssistantMessage({
      tenantId: input.tenantId,
      threadId: input.threadId,
      computerId: input.computerId,
      key: `runbook-unavailable:${input.messageId}:${route.runbook.slug}`,
      content: message.content,
      parts: message.parts,
      metadata: {
        routeKind: route.kind,
        sourceMessageId: input.messageId,
        runbookSlug: route.runbook.slug,
        unavailable: true,
      },
    });
    return true;
  }
  if (!catalogItem) return false;

  const run = await createRunbookRun({
    tenantId: input.tenantId,
    computerId: input.computerId,
    threadId: input.threadId,
    selectedByMessageId: input.messageId,
    catalogId: catalogItem.id,
    runbook: route.runbook,
    invocationMode: route.kind === "explicit" ? "explicit" : "auto",
    inputs: { prompt: input.prompt },
    idempotencyKey: `runbook-route:${input.threadId}:${input.messageId}`,
  });
  if (!run) return false;

  if (route.kind === "auto") {
    const message = buildRunbookConfirmationMessage({
      run,
      runbook: route.runbook,
      sourceMessageId: input.messageId,
      confidence: route.confidence,
      matchedKeywords: route.matchedKeywords,
    });
    await persistRunbookAssistantMessage({
      tenantId: input.tenantId,
      threadId: input.threadId,
      computerId: input.computerId,
      key: `runbook-confirmation:${run.id}`,
      content: message.content,
      parts: message.parts,
      metadata: {
        routeKind: "auto",
        sourceMessageId: input.messageId,
        runbookRunId: run.id,
        runbookSlug: route.runbook.slug,
      },
    });
    return true;
  }

  const confirmed = await confirmRunbookRun({
    tenantId: input.tenantId,
    runId: run.id,
    userId: input.actorType === "user" ? input.actorId : null,
  });
  if (!confirmed?.threadId) return true;
  await queueConfirmedRunbookRun({
    tenantId: input.tenantId,
    computerId: input.computerId,
    threadId: confirmed.threadId,
    runbookRunId: confirmed.id,
    sourceMessageId: input.messageId,
    actorType: input.actorType ?? null,
    actorId: input.actorId ?? null,
  });
  return true;
}

export function buildRunbookExecuteTaskInput(input: {
  runbookRunId: string;
  threadId: string;
  messageId: string;
  actorType?: string | null;
  actorId?: string | null;
}) {
  return normalizeTaskInput("runbook_execute", {
    runbookRunId: input.runbookRunId,
    threadId: input.threadId,
    messageId: input.messageId,
    actorType: input.actorType ?? null,
    actorId: input.actorId ?? null,
  });
}

export async function queueConfirmedRunbookRun(input: {
  tenantId: string;
  computerId: string;
  threadId: string;
  runbookRunId: string;
  sourceMessageId: string;
  actorType?: string | null;
  actorId?: string | null;
}) {
  const run = await getRunbookRun({
    tenantId: input.tenantId,
    runId: input.runbookRunId,
  });
  if (!run) throw new Error("Runbook run not found");
  await markRunbookConfirmationDecision({
    tenantId: input.tenantId,
    threadId: input.threadId,
    runbookRunId: input.runbookRunId,
    decision: "confirmed",
  });
  const runbook = runbookFromSnapshot(run.definitionSnapshot, run.runbookSlug);
  const task = await enqueueRunbookExecuteTask({
    tenantId: input.tenantId,
    computerId: input.computerId,
    threadId: input.threadId,
    sourceMessageId: input.sourceMessageId,
    actorType: input.actorType ?? null,
    actorId: input.actorId ?? null,
    runbookRunId: input.runbookRunId,
  });
  const message = buildRunbookQueueMessage({
    run,
    runbook,
    sourceMessageId: input.sourceMessageId,
  });
  await persistRunbookAssistantMessage({
    tenantId: input.tenantId,
    threadId: input.threadId,
    computerId: input.computerId,
    key: `runbook-queue:${run.id}`,
    content: message.content,
    parts: message.parts,
    metadata: {
      routeKind: run.invocationMode.toLowerCase(),
      sourceMessageId: input.sourceMessageId,
      runbookRunId: run.id,
      runbookSlug: runbook.slug,
      computerTaskId: task.id,
    },
  });
  return task;
}

function runbookFromSnapshot(
  snapshot: unknown,
  expectedSlug: string,
): RunbookDefinition {
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) {
    throw new Error(`Runbook run ${expectedSlug} has no definition snapshot`);
  }
  const runbook = snapshot as RunbookDefinition;
  if (runbook.slug !== expectedSlug) {
    throw new Error(
      `Runbook snapshot slug mismatch: expected ${expectedSlug}, got ${runbook.slug}`,
    );
  }
  return runbook;
}

export async function markRunbookConfirmationDecision(input: {
  tenantId: string;
  threadId: string;
  runbookRunId: string;
  decision: "confirmed" | "rejected";
}) {
  const [message] = await db
    .select({ id: messages.id, parts: messages.parts })
    .from(messages)
    .where(
      and(
        eq(messages.tenant_id, input.tenantId),
        eq(messages.thread_id, input.threadId),
        sql`${messages.metadata}->>'runbookMessageKey' = ${`runbook-confirmation:${input.runbookRunId}`}`,
      ),
    )
    .limit(1);
  if (!message) return null;

  const decisionMessage = buildRunbookConfirmationDecisionMessage({
    parts: message.parts,
    runbookRunId: input.runbookRunId,
    decision: input.decision,
  });

  await db
    .update(messages)
    .set({
      content: decisionMessage.summary,
      parts: decisionMessage.parts,
    })
    .where(
      and(eq(messages.tenant_id, input.tenantId), eq(messages.id, message.id)),
    );

  const [thread] = await db
    .update(threads)
    .set({
      last_response_preview:
        decisionMessage.summary.length > 240
          ? `${decisionMessage.summary.slice(0, 237)}...`
          : decisionMessage.summary,
      updated_at: new Date(),
    })
    .where(
      and(
        eq(threads.tenant_id, input.tenantId),
        eq(threads.id, input.threadId),
      ),
    )
    .returning({ status: threads.status, title: threads.title });

  if (thread) {
    await notifyThreadUpdate({
      threadId: input.threadId,
      tenantId: input.tenantId,
      status: thread.status ?? "in_progress",
      title: thread.title ?? "Untitled thread",
    }).catch(() => {});
  }
  return { id: message.id };
}

export function buildRunbookConfirmationDecisionMessage(input: {
  parts: unknown;
  runbookRunId: string;
  decision: "confirmed" | "rejected";
}) {
  const summary = runbookDecisionSummary({
    parts: input.parts,
    runbookRunId: input.runbookRunId,
    decision: input.decision,
  });
  const parts = Array.isArray(input.parts) ? input.parts : [];
  return {
    summary,
    parts: [
      {
        type: "text",
        id: `runbook-confirmation-decision:${input.runbookRunId}`,
        text: summary,
      },
      ...parts.filter((part) => {
        const record = recordValue(part);
        if (record.type === "text") return false;
        if (record.type !== "data-runbook-confirmation") return true;
        const data = recordValue(record.data);
        return data.runbookRunId !== input.runbookRunId;
      }),
    ],
  };
}

async function enqueueRunbookExecuteTask(input: {
  tenantId: string;
  computerId: string;
  threadId: string;
  runbookRunId: string;
  sourceMessageId: string;
  actorType?: string | null;
  actorId?: string | null;
}) {
  const idempotencyKey = `runbook-execute:${input.runbookRunId}`;
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
  if (existing) return existing;

  const taskInput = buildRunbookExecuteTaskInput({
    runbookRunId: input.runbookRunId,
    threadId: input.threadId,
    messageId: input.sourceMessageId,
    actorType: input.actorType ?? null,
    actorId: input.actorId ?? null,
  });
  const [task] = await db
    .insert(computerTasks)
    .values({
      tenant_id: input.tenantId,
      computer_id: input.computerId,
      task_type: "runbook_execute",
      input: taskInput,
      idempotency_key: idempotencyKey,
      created_by_user_id: taskRequesterUserId(taskInput),
    })
    .returning({ id: computerTasks.id, status: computerTasks.status });

  await db.insert(computerEvents).values({
    tenant_id: input.tenantId,
    computer_id: input.computerId,
    task_id: task.id,
    event_type: "runbook_execute_enqueued",
    level: "info",
    payload: {
      runbookRunId: input.runbookRunId,
      threadId: input.threadId,
      messageId: input.sourceMessageId,
      requesterUserId: taskRequesterUserId(taskInput),
    },
  });

  return task;
}

async function persistRunbookAssistantMessage(input: {
  tenantId: string;
  threadId: string;
  computerId: string;
  key: string;
  content: string;
  parts: RunbookMessagePart[];
  metadata: Record<string, unknown>;
}) {
  const [existing] = await db
    .select({ id: messages.id })
    .from(messages)
    .where(
      and(
        eq(messages.tenant_id, input.tenantId),
        eq(messages.thread_id, input.threadId),
        sql`${messages.metadata}->>'runbookMessageKey' = ${input.key}`,
      ),
    )
    .limit(1);
  if (existing) return existing;

  const [assistantMessage] = await db
    .insert(messages)
    .values({
      tenant_id: input.tenantId,
      thread_id: input.threadId,
      role: "assistant",
      content: input.content,
      parts: input.parts,
      sender_type: "computer",
      sender_id: input.computerId,
      metadata: {
        ...input.metadata,
        runbookMessageKey: input.key,
      },
    })
    .returning({ id: messages.id });

  const [existingThread] = await db
    .select({ metadata: threads.metadata })
    .from(threads)
    .where(
      and(
        eq(threads.tenant_id, input.tenantId),
        eq(threads.id, input.threadId),
      ),
    )
    .limit(1);
  const activeTaskQueueId =
    input.key.startsWith("runbook-queue:") &&
    typeof input.metadata.runbookRunId === "string"
      ? input.metadata.runbookRunId
      : null;
  const [thread] = await db
    .update(threads)
    .set({
      updated_at: new Date(),
      ...(activeTaskQueueId
        ? {
            metadata: taskQueueThreadMetadata(
              existingThread?.metadata,
              activeTaskQueueId,
            ),
          }
        : {}),
    })
    .where(
      and(
        eq(threads.tenant_id, input.tenantId),
        eq(threads.id, input.threadId),
      ),
    )
    .returning({ status: threads.status, title: threads.title });

  await notifyNewMessage({
    messageId: assistantMessage.id,
    threadId: input.threadId,
    tenantId: input.tenantId,
    role: "assistant",
    content: input.content,
    senderType: "computer",
    senderId: input.computerId,
  }).catch(() => {});
  if (thread) {
    await notifyThreadUpdate({
      threadId: input.threadId,
      tenantId: input.tenantId,
      status: thread.status ?? "in_progress",
      title: thread.title ?? "Untitled thread",
    }).catch(() => {});
  }

  return assistantMessage;
}

function isCatalogItemAvailable(
  item:
    | { status: string; enabled: boolean; definition: unknown; id: string }
    | undefined,
) {
  return Boolean(item?.enabled && item.status === "ACTIVE" && item.definition);
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

function runbookDecisionSummary(input: {
  parts: unknown;
  runbookRunId: string;
  decision: "confirmed" | "rejected";
}) {
  const displayName = runbookDisplayNameFromConfirmationParts(
    input.parts,
    input.runbookRunId,
  );
  const action = input.decision === "confirmed" ? "approved" : "rejected";
  return `User ${action} the ${displayName} runbook workflow.`;
}

function runbookDisplayNameFromConfirmationParts(
  parts: unknown,
  runbookRunId: string,
) {
  if (Array.isArray(parts)) {
    for (const part of parts) {
      const record = recordValue(part);
      if (record.type !== "data-runbook-confirmation") continue;
      const data = recordValue(record.data);
      if (data.runbookRunId !== runbookRunId) continue;
      const displayName =
        stringValue(data.displayName) ??
        stringValue(data.title) ??
        stringValue(data.runbookSlug);
      if (displayName) return displayName;
    }
  }
  return "selected";
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

async function dispatchComputerThreadTurn(input: {
  tenantId: string;
  computerId: string;
  threadId: string;
  messageId: string;
  taskId: string;
  runbookRunId?: string | null;
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

  // Resolve the finance-pilot attachment list (U3 of 2026-05-14-002).
  // The presign/finalize handlers (U2) wrote the rows; sendMessage
  // persisted the UUID list on `messages.metadata.attachments`. Here
  // we re-SELECT the rows with a tenant-pin so the Strands invoke
  // payload carries the full record set even if the agent runtime
  // can't reach Aurora directly. Empty list when no attachments —
  // chat-agent-invoke + Strands tolerate both shapes.
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

  let runbookContext: unknown;
  if (input.runbookRunId) {
    const runningRun = await markRunbookRunRunning({
      tenantId: input.tenantId,
      runId: input.runbookRunId,
    });
    runbookContext = runningRun ? buildAgentRunbookContext(runningRun) : null;
  }

  const invoked = await invokeChatAgent({
    tenantId: input.tenantId,
    threadId: input.threadId,
    agentId: backingAgentId,
    userMessage: message.content ?? "",
    messageId: input.messageId,
    computerId: input.computerId,
    computerTaskId: input.taskId,
    runbookContext,
    messageAttachments,
  });

  if (!invoked) {
    if (input.runbookRunId) {
      await failRunbookRunFromThreadTurn({
        tenantId: input.tenantId,
        runId: input.runbookRunId,
        error: {
          message: "Strands thread turn dispatch failed",
          code: "dispatch_failed",
        },
      });
    }
    await markDispatchFailed(input, {
      message: "Strands thread turn dispatch failed",
      code: "dispatch_failed",
    });
  }

  return invoked;
}

function buildAgentRunbookContext(
  run: NonNullable<Awaited<ReturnType<typeof getRunbookRun>>>,
) {
  const tasks = [...(run.tasks ?? [])].sort(
    (a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0),
  );
  const currentTask =
    tasks.find((task) => String(task.status).toLowerCase() === "running") ??
    tasks.find((task) => String(task.status).toLowerCase() === "pending") ??
    tasks[0] ??
    null;
  return {
    run: {
      id: run.id,
      status: run.status,
      runbookSlug: run.runbookSlug,
      runbookVersion: run.runbookVersion,
    },
    definitionSnapshot: run.definitionSnapshot,
    inputs: run.inputs,
    previousOutputs: Object.fromEntries(
      tasks
        .filter((task) => String(task.status).toLowerCase() === "completed")
        .map((task) => [task.taskKey, task.output ?? null]),
    ),
    currentTask,
    tasks,
  };
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
