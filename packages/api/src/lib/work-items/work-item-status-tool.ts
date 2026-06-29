import { and, eq } from "drizzle-orm";
import { GraphQLError } from "graphql";
import { schema } from "@thinkwork/database-pg";
import { db as defaultDb } from "../db.js";
import { refreshCustomerOnboardingGoalFolderSafely } from "../spaces/customer-onboarding-goal-md.js";
import {
  TaskStatusToolError,
  type TaskStatusToolActor,
} from "../task-status-tool.js";
import { syncLinkedTaskFromWorkItem } from "./linked-task-compat.js";
import { findStatusForWorkItemUpdate } from "./status-service.js";

const {
  spaceMembers,
  threads,
  workItemEvents,
  workItemStatuses,
  workItemThreadLinks,
  workItems,
} = schema;

export interface SetWorkItemStatusInput {
  tenantId: string;
  workItemId: string;
  threadId?: string | null;
  agentId?: string | null;
  statusId?: string | null;
  statusCategory?: string | null;
  status?: string | null;
  note?: string | null;
  metadata?: Record<string, unknown> | null;
  threadTurnId?: string | null;
  toolCallId?: string | null;
  actor: TaskStatusToolActor;
}

export interface SetWorkItemStatusResult {
  ok: true;
  workItemId: string;
  previousStatusCategory: string | null;
  statusCategory: string;
  statusId: string;
  linkedTaskId?: string | null;
}

export interface WorkItemStatusToolDeps {
  db?: typeof defaultDb;
  now?: () => Date;
  findStatusForUpdate?: typeof findStatusForWorkItemUpdate;
  syncLinkedTask?: typeof syncLinkedTaskFromWorkItem;
  refreshGoalFolder?: typeof refreshCustomerOnboardingGoalFolderSafely;
}

const TERMINAL_WORK_ITEM_CATEGORIES = new Set(["done", "skipped"]);

export async function setWorkItemStatus(
  input: SetWorkItemStatusInput,
  deps: WorkItemStatusToolDeps = {},
): Promise<SetWorkItemStatusResult> {
  const database = deps.db ?? defaultDb;
  const now = deps.now?.() ?? new Date();
  const note = cleanNote(input.note);
  const statusCategory = cleanString(input.statusCategory ?? input.status);
  const statusId = cleanString(input.statusId);
  if (!statusCategory && !statusId) {
    throw reject(
      input,
      "statusCategory or statusId is required",
      400,
      "BAD_STATUS",
    );
  }

  const findStatus = deps.findStatusForUpdate ?? findStatusForWorkItemUpdate;
  const syncLinkedTask = deps.syncLinkedTask ?? syncLinkedTaskFromWorkItem;

  const result = await database.transaction(async (tx) => {
    const [item] = await tx
      .select({
        id: workItems.id,
        tenantId: workItems.tenant_id,
        spaceId: workItems.space_id,
        title: workItems.title,
        statusId: workItems.status_id,
        metadata: workItems.metadata,
        currentStatusCategory: workItemStatuses.category,
      })
      .from(workItems)
      .leftJoin(
        workItemStatuses,
        and(
          eq(workItemStatuses.id, workItems.status_id),
          eq(workItemStatuses.tenant_id, workItems.tenant_id),
          eq(workItemStatuses.space_id, workItems.space_id),
        ),
      )
      .where(
        and(
          eq(workItems.tenant_id, input.tenantId),
          eq(workItems.id, input.workItemId),
        ),
      )
      .limit(1);

    if (!item) {
      throw reject(input, "Work item not found", 404, "WORK_ITEM_NOT_FOUND");
    }

    const threadContext = cleanString(input.threadId)
      ? await loadThreadContext(tx, {
          tenantId: input.tenantId,
          workItemId: input.workItemId,
          threadId: cleanString(input.threadId)!,
        })
      : null;
    if (cleanString(input.threadId) && !threadContext) {
      throw reject(
        input,
        "Work item is not linked to this thread",
        403,
        "WORK_ITEM_THREAD_REQUIRED",
      );
    }

    if (input.actor.type === "agent" || cleanString(input.agentId)) {
      const agentId = cleanString(input.agentId ?? input.actor.id);
      if (!agentId || !threadContext) {
        throw reject(
          input,
          "Agent work item status updates require linked thread context",
          403,
          "AGENT_THREAD_REQUIRED",
        );
      }
      if (threadContext.agentId && threadContext.agentId !== agentId) {
        throw reject(
          input,
          "Agent does not own this thread",
          403,
          "AGENT_THREAD_MISMATCH",
        );
      }
    }

    if (input.actor.type === "user") {
      await assertSpaceMember(tx, {
        tenantId: input.tenantId,
        spaceId: item.spaceId,
        userId: input.actor.id,
      });
    }

    const previousCategory = item.currentStatusCategory ?? null;
    const status = await resolveStatus(
      findStatus,
      {
        tenantId: input.tenantId,
        spaceId: item.spaceId,
        statusId,
        statusCategory,
      },
      tx as unknown as typeof defaultDb,
    );
    if (
      previousCategory &&
      previousCategory !== status.category &&
      TERMINAL_WORK_ITEM_CATEGORIES.has(previousCategory)
    ) {
      throw reject(
        input,
        `Cannot transition terminal work item status ${previousCategory} to ${status.category}`,
        409,
        "INVALID_STATUS_TRANSITION",
      );
    }

    const completed =
      status.category === "done" || status.category === "skipped";
    const [updated] = await tx
      .update(workItems)
      .set({
        status_id: status.id,
        blocked: status.category === "blocked",
        completed_at: completed ? now : null,
        completed_by_user_id:
          completed && input.actor.type === "user" ? input.actor.id : null,
        completed_by_agent_id:
          completed && input.actor.type === "agent"
            ? cleanString(input.agentId ?? input.actor.id)
            : null,
        metadata: mergeWorkItemToolMetadata(item.metadata, {
          note,
          manualMetadata: input.metadata,
          updatedAt: now.toISOString(),
          actor: input.actor,
          threadId: cleanString(input.threadId),
          threadTurnId: cleanString(input.threadTurnId),
          toolCallId: cleanString(input.toolCallId),
        }),
        updated_at: now,
      })
      .where(
        and(eq(workItems.tenant_id, input.tenantId), eq(workItems.id, item.id)),
      )
      .returning({ id: workItems.id });

    if (!updated) {
      throw reject(
        input,
        "Work item changed concurrently; retry with the latest status",
        409,
        "WORK_ITEM_STATUS_CONFLICT",
      );
    }

    await tx.insert(workItemEvents).values({
      tenant_id: input.tenantId,
      space_id: item.spaceId,
      work_item_id: item.id,
      thread_id: cleanString(input.threadId),
      actor_user_id: input.actor.type === "user" ? input.actor.id : null,
      actor_agent_id:
        input.actor.type === "agent"
          ? cleanString(input.agentId ?? input.actor.id)
          : null,
      event_type: eventTypeForStatus(previousCategory, status.category),
      previous_status_id: item.statusId,
      new_status_id: status.id,
      message: buildStatusChangeMessage(status.name, note),
      metadata: compactObject({
        source: "set_work_item_status",
        note,
        newStatusName: status.name,
        actor: input.actor,
        threadTurnId: cleanString(input.threadTurnId),
        toolCallId: cleanString(input.toolCallId),
        manualMetadata: input.metadata,
      }),
    });

    const linkedTaskSync = await syncLinkedTask(
      {
        tenantId: input.tenantId,
        workItemId: item.id,
        statusCategory: status.category,
        threadId: cleanString(input.threadId),
        note,
        metadata: input.metadata,
        actor: input.actor,
        occurredAt: now,
      },
      { database: tx as never },
    );

    return {
      ok: true as const,
      workItemId: item.id,
      previousStatusCategory: previousCategory,
      statusCategory: status.category,
      statusId: status.id,
      linkedTaskId: linkedTaskSync?.linkedTaskId ?? null,
    };
  });

  if (cleanString(input.threadId)) {
    await (deps.refreshGoalFolder ?? refreshCustomerOnboardingGoalFolderSafely)(
      {
        tenantId: input.tenantId,
        threadId: cleanString(input.threadId)!,
      },
    );
  }

  return result;
}

async function resolveStatus(
  findStatus: typeof findStatusForWorkItemUpdate,
  input: {
    tenantId: string;
    spaceId: string;
    statusId?: string | null;
    statusCategory?: string | null;
  },
  tx: typeof defaultDb,
) {
  try {
    return await findStatus({
      tenantId: input.tenantId,
      spaceId: input.spaceId,
      statusId: input.statusId,
      statusCategory: input.statusCategory,
      tx,
    });
  } catch (err) {
    if (err instanceof GraphQLError) {
      throw new TaskStatusToolError(err.message, 400, "BAD_STATUS");
    }
    throw err;
  }
}

async function loadThreadContext(
  tx: {
    select: typeof defaultDb.select;
  },
  input: { tenantId: string; workItemId: string; threadId: string },
) {
  const [context] = await tx
    .select({
      threadId: workItemThreadLinks.thread_id,
      agentId: threads.agent_id,
    })
    .from(workItemThreadLinks)
    .innerJoin(
      threads,
      and(
        eq(threads.id, workItemThreadLinks.thread_id),
        eq(threads.tenant_id, workItemThreadLinks.tenant_id),
      ),
    )
    .where(
      and(
        eq(workItemThreadLinks.tenant_id, input.tenantId),
        eq(workItemThreadLinks.work_item_id, input.workItemId),
        eq(workItemThreadLinks.thread_id, input.threadId),
      ),
    )
    .limit(1);
  return context ?? null;
}

async function assertSpaceMember(
  tx: {
    select: typeof defaultDb.select;
  },
  input: { tenantId: string; spaceId: string; userId?: string | null },
): Promise<void> {
  if (!input.userId) {
    throw new TaskStatusToolError(
      "User identity is required to update work item status",
      403,
      "USER_REQUIRED",
    );
  }
  const [member] = await tx
    .select({ id: spaceMembers.id })
    .from(spaceMembers)
    .where(
      and(
        eq(spaceMembers.tenant_id, input.tenantId),
        eq(spaceMembers.space_id, input.spaceId),
        eq(spaceMembers.user_id, input.userId),
      ),
    )
    .limit(1);
  if (!member) {
    throw new TaskStatusToolError(
      "User is not a member of this Space",
      403,
      "SPACE_MEMBER_REQUIRED",
    );
  }
}

function eventTypeForStatus(
  previousCategory: string | null,
  nextCategory: string,
) {
  if (nextCategory === "done" || nextCategory === "skipped") {
    return "completed";
  }
  if (nextCategory === "blocked") return "blocked";
  if (previousCategory === "blocked") return "unblocked";
  return "status_changed";
}

function buildStatusChangeMessage(statusName: string, note: string | null) {
  const suffix = note ? ` Note: ${note}` : "";
  return `moved to ${statusName}.${suffix}`;
}

function reject(
  input: SetWorkItemStatusInput,
  message: string,
  statusCode: number,
  code: string,
): TaskStatusToolError {
  console.warn("[set-work-item-status] rejected", {
    tenantId: input.tenantId,
    workItemId: input.workItemId,
    threadId: input.threadId,
    code,
  });
  return new TaskStatusToolError(message, statusCode, code);
}

function mergeWorkItemToolMetadata(
  current: unknown,
  update: {
    note: string | null;
    manualMetadata?: Record<string, unknown> | null;
    updatedAt: string;
    actor: TaskStatusToolActor;
    threadId: string | null;
    threadTurnId: string | null;
    toolCallId: string | null;
  },
) {
  const base = objectValue(current);
  return compactObject({
    ...base,
    workItemStatusTool: compactObject({
      ...objectValue(base.workItemStatusTool),
      lastStatusNote: update.note,
      lastStatusMetadata: update.manualMetadata,
      lastStatusUpdatedAt: update.updatedAt,
      lastStatusActor: update.actor,
      lastThreadId: update.threadId,
      lastThreadTurnId: update.threadTurnId,
      lastToolCallId: update.toolCallId,
    }),
  });
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function compactObject(value: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(value).filter(([, child]) => child !== undefined),
  );
}

function cleanNote(value: string | null | undefined) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function cleanString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null;
}
