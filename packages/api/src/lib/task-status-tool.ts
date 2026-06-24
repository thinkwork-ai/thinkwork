import { and, eq, sql } from "drizzle-orm";
import { schema } from "@thinkwork/database-pg";
import { db as defaultDb } from "./db.js";
import {
  LINKED_TASK_STATUSES,
  type LinkedTaskStatus,
} from "./linked-tasks/status.js";
import { refreshCustomerOnboardingGoalFolderSafely } from "./spaces/customer-onboarding-goal-md.js";
import { deriveThreadGoalTaskProgress } from "./thread-goals/progress.js";
import { syncWorkItemFromLinkedTask } from "./work-items/customer-onboarding.js";

const { goals, linkedTaskEvents, linkedTasks, spaceMembers, threads } = schema;

export interface TaskStatusToolActor {
  type: "agent" | "user";
  id?: string | null;
  email?: string | null;
}

export interface SetTaskStatusInput {
  tenantId: string;
  threadId: string;
  agentId?: string | null;
  linkedTaskId: string;
  status: string;
  note?: string | null;
  metadata?: Record<string, unknown> | null;
  actor: TaskStatusToolActor;
}

export interface SetTaskStatusResult {
  ok: true;
  linkedTaskId: string;
  previousStatus: LinkedTaskStatus;
  status: LinkedTaskStatus;
  goalStatus?: "active" | "in_review" | "completed" | "cancelled" | null;
}

export class TaskStatusToolError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
    public readonly code: string,
  ) {
    super(message);
    this.name = "TaskStatusToolError";
  }
}

export interface TaskStatusToolDeps {
  db?: typeof defaultDb;
  now?: () => Date;
  refreshGoalFolder?: typeof refreshCustomerOnboardingGoalFolderSafely;
  syncNativeWorkItem?: typeof syncWorkItemFromLinkedTask;
}

const TERMINAL_TASK_STATUSES = new Set<LinkedTaskStatus>([
  "completed",
  "cancelled",
  "not_applicable",
]);

export async function setTaskStatus(
  input: SetTaskStatusInput,
  deps: TaskStatusToolDeps = {},
): Promise<SetTaskStatusResult> {
  const database = deps.db ?? defaultDb;
  const now = deps.now?.() ?? new Date();
  const nextStatus = parseLinkedTaskStatus(input.status);
  const note = cleanNote(input.note);
  const refreshGoalFolder =
    deps.refreshGoalFolder ?? refreshCustomerOnboardingGoalFolderSafely;
  const syncNativeWorkItem =
    deps.syncNativeWorkItem ?? syncWorkItemFromLinkedTask;

  const result = await database.transaction(async (tx) => {
    const [task] = await tx
      .select({
        id: linkedTasks.id,
        tenantId: linkedTasks.tenant_id,
        spaceId: linkedTasks.space_id,
        threadId: linkedTasks.thread_id,
        provider: linkedTasks.provider,
        title: linkedTasks.title,
        status: linkedTasks.status,
        metadata: linkedTasks.metadata,
        threadAgentId: threads.agent_id,
      })
      .from(linkedTasks)
      .innerJoin(
        threads,
        and(
          eq(threads.id, linkedTasks.thread_id),
          eq(threads.tenant_id, linkedTasks.tenant_id),
        ),
      )
      .where(
        and(
          eq(linkedTasks.tenant_id, input.tenantId),
          eq(linkedTasks.thread_id, input.threadId),
          eq(linkedTasks.id, input.linkedTaskId),
        ),
      )
      .limit(1);

    if (!task) {
      throw reject(input, "Linked task not found", 404, "TASK_NOT_FOUND");
    }
    if (task.provider !== "thinkwork") {
      throw reject(
        input,
        "Only ThinkWork checklist rows can be updated by set_task_status",
        400,
        "UNSUPPORTED_PROVIDER",
      );
    }
    if (
      input.agentId &&
      task.threadAgentId &&
      input.agentId !== task.threadAgentId
    ) {
      throw reject(
        input,
        "Agent does not own this thread",
        403,
        "AGENT_THREAD_MISMATCH",
      );
    }
    if (input.actor.type === "user") {
      await assertSpaceMember(tx, {
        tenantId: input.tenantId,
        spaceId: task.spaceId,
        userId: input.actor.id,
      });
    }

    const previousStatus = parseLinkedTaskStatus(String(task.status));
    assertTransitionAllowed(previousStatus, nextStatus, input);

    const nextMetadata = mergeTaskToolMetadata(task.metadata, {
      note,
      manualMetadata: input.metadata,
      updatedAt: now.toISOString(),
      actor: input.actor,
    });
    const [updated] = await tx
      .update(linkedTasks)
      .set({
        status: nextStatus,
        blocked: nextStatus === "blocked",
        sync_status: "synced",
        last_synced_at: now,
        metadata: nextMetadata,
        updated_at: now,
      })
      .where(
        and(
          eq(linkedTasks.id, task.id),
          eq(linkedTasks.tenant_id, input.tenantId),
          eq(linkedTasks.status, previousStatus),
        ),
      )
      .returning({ id: linkedTasks.id });

    if (!updated) {
      throw reject(
        input,
        "Linked task changed concurrently; retry with the latest status",
        409,
        "TASK_STATUS_CONFLICT",
      );
    }

    await tx.insert(linkedTaskEvents).values({
      tenant_id: task.tenantId,
      linked_task_id: task.id,
      space_id: task.spaceId,
      thread_id: task.threadId,
      provider: "thinkwork",
      event_type: eventTypeForStatus(nextStatus),
      previous_status: previousStatus,
      new_status: nextStatus,
      message: buildStatusChangeMessage(task.title, nextStatus, note),
      metadata: compactObject({
        source: "set_task_status",
        note,
        actor: input.actor,
        manualMetadata: input.metadata,
      }),
      occurred_at: now,
    });

    if (hasNativeWorkItemPointer(task.metadata)) {
      await syncNativeWorkItem(
        {
          tenantId: input.tenantId,
          linkedTaskId: task.id,
          status: nextStatus,
          blocked: nextStatus === "blocked",
          note,
          actorUserId: input.actor.type === "user" ? input.actor.id : null,
          actorAgentId: input.actor.type === "agent" ? input.actor.id : null,
          metadata: compactObject({
            source: "set_task_status",
            actor: input.actor,
            manualMetadata: input.metadata,
          }),
        },
        { database: tx as never, now: () => now },
      );
    }

    let goalStatus: SetTaskStatusResult["goalStatus"] = null;
    const [activeGoal] = await tx
      .select({
        id: goals.id,
        status: goals.status,
        metadata: goals.metadata,
      })
      .from(goals)
      .where(
        and(
          eq(goals.tenant_id, input.tenantId),
          eq(goals.thread_id, input.threadId),
          eq(goals.status, "active"),
        ),
      )
      .limit(1);
    if (activeGoal) {
      const taskRows = await tx
        .select({
          status: linkedTasks.status,
          required: linkedTasks.required,
        })
        .from(linkedTasks)
        .where(
          and(
            eq(linkedTasks.tenant_id, input.tenantId),
            eq(linkedTasks.thread_id, input.threadId),
          ),
        );
      const progress = deriveThreadGoalTaskProgress(taskRows);
      if (progress.readyForReview) {
        await tx
          .update(goals)
          .set({
            status: "in_review",
            metadata: mergeGoalToolMetadata(activeGoal.metadata, {
              at: now.toISOString(),
              actor: input.actor,
            }),
            updated_at: now,
          })
          .where(eq(goals.id, activeGoal.id));
        goalStatus = "in_review";
      } else {
        goalStatus = "active";
      }
    }

    return {
      ok: true as const,
      linkedTaskId: task.id,
      previousStatus,
      status: nextStatus,
      goalStatus,
    };
  });

  await refreshGoalFolder({
    tenantId: input.tenantId,
    threadId: input.threadId,
  });

  return result;
}

function parseLinkedTaskStatus(value: string): LinkedTaskStatus {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[\s/-]+/g, "_");
  if (LINKED_TASK_STATUSES.includes(normalized as LinkedTaskStatus)) {
    return normalized as LinkedTaskStatus;
  }
  throw new TaskStatusToolError(
    `Unsupported linked task status: ${value}`,
    400,
    "BAD_STATUS",
  );
}

function assertTransitionAllowed(
  previous: LinkedTaskStatus,
  next: LinkedTaskStatus,
  input: SetTaskStatusInput,
): void {
  if (previous === next) return;
  if (TERMINAL_TASK_STATUSES.has(previous)) {
    throw reject(
      input,
      `Cannot transition terminal linked task status ${previous} to ${next}`,
      409,
      "INVALID_STATUS_TRANSITION",
    );
  }
}

async function assertSpaceMember(
  tx: {
    select: typeof defaultDb.select;
  },
  input: { tenantId: string; spaceId: string; userId?: string | null },
): Promise<void> {
  if (!input.userId) {
    throw new TaskStatusToolError(
      "User identity is required to update task status",
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

function eventTypeForStatus(status: LinkedTaskStatus) {
  if (status === "completed") return "completed";
  if (status === "blocked") return "blocked";
  return "status_changed";
}

function buildStatusChangeMessage(
  title: string,
  status: LinkedTaskStatus,
  note: string | null,
) {
  const label = status.replace(/_/g, " ");
  const suffix = note ? ` Note: ${note}` : "";
  return `${title} marked ${label} by set_task_status.${suffix}`;
}

function reject(
  input: SetTaskStatusInput,
  message: string,
  statusCode: number,
  code: string,
): TaskStatusToolError {
  console.warn("[set-task-status] rejected", {
    tenantId: input.tenantId,
    threadId: input.threadId,
    linkedTaskId: input.linkedTaskId,
    code,
  });
  return new TaskStatusToolError(message, statusCode, code);
}

function mergeTaskToolMetadata(
  current: unknown,
  update: {
    note: string | null;
    manualMetadata?: Record<string, unknown> | null;
    updatedAt: string;
    actor: TaskStatusToolActor;
  },
) {
  const base = objectValue(current);
  return compactObject({
    ...base,
    taskStatusTool: compactObject({
      ...objectValue(base.taskStatusTool),
      lastStatusNote: update.note,
      lastStatusMetadata: update.manualMetadata,
      lastStatusUpdatedAt: update.updatedAt,
      lastStatusActor: update.actor,
    }),
  });
}

function mergeGoalToolMetadata(
  current: unknown,
  update: { at: string; actor: TaskStatusToolActor },
) {
  const base = objectValue(current);
  return compactObject({
    ...base,
    taskStatusTool: compactObject({
      ...objectValue(base.taskStatusTool),
      inReviewAt: update.at,
      inReviewActor: update.actor,
    }),
  });
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function hasNativeWorkItemPointer(value: unknown): boolean {
  const metadata = objectValue(value);
  const nativeWorkItem = objectValue(metadata.nativeWorkItem);
  return Boolean(
    typeof metadata.nativeWorkItemId === "string" ||
    typeof nativeWorkItem.id === "string",
  );
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
