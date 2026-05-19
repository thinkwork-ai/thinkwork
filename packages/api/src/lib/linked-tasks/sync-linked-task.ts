import { and, eq } from "drizzle-orm";
import { getDb } from "@thinkwork/database-pg";
import {
  linkedTaskEvents,
  linkedTasks,
  messages,
} from "@thinkwork/database-pg/schema";
import {
  createCoordinatorAgentService,
  type CoordinatorAgentService,
} from "../spaces/coordinator-agent.js";

import {
  type LinkedTaskStatus,
  type LinkedTaskSyncStatus,
  countRequiredTasks,
  normalizeExternalTaskStatus,
  requiredTasksComplete,
} from "./status.js";

export type LinkedTaskMilestoneEventType =
  | "completed"
  | "blocked"
  | "reassigned"
  | "due_date_changed"
  | "sync_failed";

export interface LinkedTaskSyncInput {
  tenantId: string;
  provider?: "lastmile";
  externalTaskId: string;
  externalEventId?: string | null;
  eventName?: string | null;
  status?: unknown;
  blocked?: boolean | null;
  title?: string | null;
  externalTaskUrl?: string | null;
  assignee?: {
    externalId?: string | null;
    displayName?: string | null;
  } | null;
  dueAt?: string | null;
  occurredAt?: string | Date | null;
  raw?: unknown;
}

export interface LinkedTaskSyncFailureInput {
  tenantId: string;
  provider?: "lastmile";
  externalTaskId: string;
  externalEventId?: string | null;
  message: string;
  code?: string | null;
  occurredAt?: string | Date | null;
  raw?: unknown;
}

export interface LinkedTaskMirrorRow {
  id: string;
  tenantId: string;
  spaceId: string;
  threadId: string;
  provider: string;
  externalTaskId: string;
  externalTaskUrl: string | null;
  title: string;
  required: boolean;
  status: LinkedTaskStatus;
  blocked: boolean;
  syncStatus: LinkedTaskSyncStatus;
  assigneeDisplay: string | null;
  assigneeExternalId: string | null;
  metadata: Record<string, unknown> | null;
}

export interface LinkedTaskUpdate {
  title?: string;
  externalTaskUrl?: string | null;
  status: LinkedTaskStatus;
  blocked: boolean;
  syncStatus: LinkedTaskSyncStatus;
  assigneeDisplay?: string | null;
  assigneeExternalId?: string | null;
  metadata: Record<string, unknown> | null;
}

export interface LinkedTaskMilestoneInput {
  tenantId: string;
  linkedTask: LinkedTaskMirrorRow;
  eventType: LinkedTaskMilestoneEventType;
  externalEventId: string | null;
  previousStatus: LinkedTaskStatus | null;
  newStatus: LinkedTaskStatus | null;
  message: string;
  occurredAt: Date;
  metadata: Record<string, unknown>;
}

export interface LinkedTaskSyncRepository {
  findByExternalTaskId(input: {
    tenantId: string;
    provider: "lastmile";
    externalTaskId: string;
  }): Promise<LinkedTaskMirrorRow | null>;
  listThreadTasks(input: {
    tenantId: string;
    threadId: string;
  }): Promise<LinkedTaskMirrorRow[]>;
  updateLinkedTask(input: {
    task: LinkedTaskMirrorRow;
    update: LinkedTaskUpdate;
  }): Promise<LinkedTaskMirrorRow>;
  createMilestoneEvent(input: LinkedTaskMilestoneInput): Promise<boolean>;
  createThreadMilestone(input: {
    tenantId: string;
    threadId: string;
    content: string;
    metadata: Record<string, unknown>;
  }): Promise<void>;
}

export interface SyncLinkedTaskDeps {
  repository?: LinkedTaskSyncRepository;
  coordinator?: Pick<CoordinatorAgentService, "enqueueWakeup">;
  now?: () => Date;
}

export type SyncLinkedTaskResult =
  | {
      ok: true;
      skipped: true;
      reason: string;
    }
  | {
      ok: true;
      skipped: false;
      linkedTask: LinkedTaskMirrorRow;
      eventType: LinkedTaskMilestoneEventType | null;
      milestonePosted: boolean;
      allRequiredComplete: boolean;
    };

export async function syncLinkedTaskFromProviderEvent(
  input: LinkedTaskSyncInput,
  deps: SyncLinkedTaskDeps = {},
): Promise<SyncLinkedTaskResult> {
  const repository = deps.repository ?? new DrizzleLinkedTaskSyncRepository();
  const coordinator = deps.coordinator ?? createCoordinatorAgentService();
  const provider = input.provider ?? "lastmile";
  const task = await repository.findByExternalTaskId({
    tenantId: input.tenantId,
    provider,
    externalTaskId: input.externalTaskId,
  });
  if (!task) {
    return {
      ok: true,
      skipped: true,
      reason: "linked task mirror not found",
    };
  }

  const beforeTasks = await repository.listThreadTasks({
    tenantId: input.tenantId,
    threadId: task.threadId,
  });
  const wasAllRequiredComplete = requiredTasksComplete(beforeTasks);
  const normalized = normalizeExternalTaskStatus(
    input.status ?? input.eventName,
  );
  const blocked =
    typeof input.blocked === "boolean" ? input.blocked : normalized.blocked;
  const syncStatus = normalized.syncStatus;
  const update: LinkedTaskUpdate = {
    title: input.title?.trim() || undefined,
    externalTaskUrl:
      input.externalTaskUrl === undefined ? undefined : input.externalTaskUrl,
    status: normalized.status,
    blocked,
    syncStatus,
    assigneeDisplay:
      input.assignee === undefined
        ? undefined
        : (input.assignee?.displayName ?? null),
    assigneeExternalId:
      input.assignee === undefined
        ? undefined
        : (input.assignee?.externalId ?? null),
    metadata: mergeProviderMetadata(task.metadata, {
      dueAt: input.dueAt ?? undefined,
      lastProviderEvent: input.eventName ?? undefined,
      raw: input.raw,
    }),
  };
  const updated = await repository.updateLinkedTask({ task, update });
  const eventType = classifyMilestoneEvent(input, task, updated);

  let milestonePosted = false;
  if (eventType) {
    milestonePosted = await recordMilestone(repository, {
      tenantId: input.tenantId,
      linkedTask: updated,
      eventType,
      externalEventId: input.externalEventId ?? null,
      previousStatus: task.status,
      newStatus: updated.status,
      message: buildMilestoneMessage(eventType, task, updated),
      occurredAt: parseDate(input.occurredAt, deps.now),
      metadata: {
        eventName: input.eventName,
        blocked: updated.blocked,
        assignee: input.assignee,
        dueAt: input.dueAt,
        raw: input.raw,
      },
    });
  }

  const afterTasks = await repository.listThreadTasks({
    tenantId: input.tenantId,
    threadId: task.threadId,
  });
  const isAllRequiredComplete = requiredTasksComplete(afterTasks);
  if (!wasAllRequiredComplete && isAllRequiredComplete) {
    const counts = countRequiredTasks(afterTasks);
    await repository.createThreadMilestone({
      tenantId: input.tenantId,
      threadId: task.threadId,
      content: `All required onboarding tasks are complete (${counts.completed}/${counts.required}). @coordinator can prepare the final summary and archive recommendation.`,
      metadata: {
        kind: "linked_task_all_required_complete",
        workflow: "customer_onboarding",
        required: counts.required,
        completed: counts.completed,
      },
    });
    await coordinator.enqueueWakeup({
      tenantId: input.tenantId,
      spaceId: task.spaceId,
      threadId: task.threadId,
      reason: "completion_summary",
      idempotencyKey: `space-coordinator:${input.tenantId}:${task.threadId}:completion_summary`,
      summary: `All required onboarding tasks are complete (${counts.completed}/${counts.required}). Prepare a final summary and archive recommendation.`,
      requestedBy: { type: "system" },
    });
  }

  return {
    ok: true,
    skipped: false,
    linkedTask: updated,
    eventType,
    milestonePosted,
    allRequiredComplete: !wasAllRequiredComplete && isAllRequiredComplete,
  };
}

export async function markLinkedTaskSyncFailure(
  input: LinkedTaskSyncFailureInput,
  deps: SyncLinkedTaskDeps = {},
): Promise<SyncLinkedTaskResult> {
  const repository = deps.repository ?? new DrizzleLinkedTaskSyncRepository();
  const provider = input.provider ?? "lastmile";
  const task = await repository.findByExternalTaskId({
    tenantId: input.tenantId,
    provider,
    externalTaskId: input.externalTaskId,
  });
  if (!task) {
    return {
      ok: true,
      skipped: true,
      reason: "linked task mirror not found",
    };
  }

  const updated = await repository.updateLinkedTask({
    task,
    update: {
      status: task.status,
      blocked: task.blocked,
      syncStatus: "error",
      metadata: mergeProviderMetadata(task.metadata, {
        lastSyncFailure: {
          code: input.code,
          message: input.message,
          raw: input.raw,
        },
      }),
    },
  });
  const milestonePosted = await recordMilestone(repository, {
    tenantId: input.tenantId,
    linkedTask: updated,
    eventType: "sync_failed",
    externalEventId: input.externalEventId ?? null,
    previousStatus: task.status,
    newStatus: updated.status,
    message: `${updated.title} sync failed: ${input.message}`,
    occurredAt: parseDate(input.occurredAt, deps.now),
    metadata: {
      code: input.code,
      raw: input.raw,
    },
  });

  return {
    ok: true,
    skipped: false,
    linkedTask: updated,
    eventType: "sync_failed",
    milestonePosted,
    allRequiredComplete: false,
  };
}

async function recordMilestone(
  repository: LinkedTaskSyncRepository,
  input: LinkedTaskMilestoneInput,
): Promise<boolean> {
  const inserted = await repository.createMilestoneEvent(input);
  if (!inserted) return false;

  await repository.createThreadMilestone({
    tenantId: input.tenantId,
    threadId: input.linkedTask.threadId,
    content: input.message,
    metadata: {
      kind: "linked_task_milestone",
      linkedTaskId: input.linkedTask.id,
      eventType: input.eventType,
      externalEventId: input.externalEventId,
    },
  });
  return true;
}

function classifyMilestoneEvent(
  input: LinkedTaskSyncInput,
  previous: LinkedTaskMirrorRow,
  updated: LinkedTaskMirrorRow,
): LinkedTaskMilestoneEventType | null {
  const eventName = normalizeEventName(input.eventName);
  if (eventName.includes("due") && eventName.includes("chang")) {
    return "due_date_changed";
  }
  if (
    eventName.includes("assign") &&
    previous.assigneeExternalId !== updated.assigneeExternalId
  ) {
    return "reassigned";
  }
  if (previous.status !== updated.status) {
    if (updated.status === "completed") return "completed";
    if (updated.status === "blocked") return "blocked";
  }
  if (!previous.blocked && updated.blocked) return "blocked";
  return null;
}

function buildMilestoneMessage(
  eventType: LinkedTaskMilestoneEventType,
  previous: LinkedTaskMirrorRow,
  updated: LinkedTaskMirrorRow,
): string {
  if (eventType === "completed") return `${updated.title} completed.`;
  if (eventType === "blocked") return `${updated.title} is blocked.`;
  if (eventType === "reassigned") {
    return `${updated.title} reassigned to ${updated.assigneeDisplay ?? updated.assigneeExternalId ?? "an external owner"}.`;
  }
  if (eventType === "due_date_changed") {
    const dueAt = stringValue(updated.metadata?.lastProviderDueAt);
    return dueAt
      ? `${updated.title} due date changed to ${dueAt}.`
      : `${updated.title} due date changed.`;
  }
  return `${previous.title} sync failed.`;
}

function mergeProviderMetadata(
  current: Record<string, unknown> | null,
  next: {
    dueAt?: string;
    lastProviderEvent?: string;
    raw?: unknown;
    lastSyncFailure?: unknown;
  },
): Record<string, unknown> {
  return compactObject({
    ...(current ?? {}),
    lastProviderDueAt: next.dueAt,
    lastProviderEvent: next.lastProviderEvent,
    lastProviderRaw: next.raw,
    lastSyncFailure: next.lastSyncFailure,
  });
}

function parseDate(
  value: string | Date | null | undefined,
  now: (() => Date) | undefined,
): Date {
  if (value instanceof Date) return value;
  if (typeof value === "string") {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  return now?.() ?? new Date();
}

function normalizeEventName(value: string | null | undefined): string {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[\s.-]+/g, "_");
}

function compactObject(
  value: Record<string, unknown>,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(value).filter(([, child]) => child !== undefined),
  );
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

class DrizzleLinkedTaskSyncRepository implements LinkedTaskSyncRepository {
  private readonly db = getDb();

  async findByExternalTaskId(input: {
    tenantId: string;
    provider: "lastmile";
    externalTaskId: string;
  }): Promise<LinkedTaskMirrorRow | null> {
    const [row] = await this.db
      .select()
      .from(linkedTasks)
      .where(
        and(
          eq(linkedTasks.tenant_id, input.tenantId),
          eq(linkedTasks.provider, input.provider),
          eq(linkedTasks.external_task_id, input.externalTaskId),
        ),
      )
      .limit(1);
    return row ? toMirrorRow(row) : null;
  }

  async listThreadTasks(input: {
    tenantId: string;
    threadId: string;
  }): Promise<LinkedTaskMirrorRow[]> {
    const rows = await this.db
      .select()
      .from(linkedTasks)
      .where(
        and(
          eq(linkedTasks.tenant_id, input.tenantId),
          eq(linkedTasks.thread_id, input.threadId),
        ),
      );
    return rows.map((row) => toMirrorRow(row));
  }

  async updateLinkedTask(input: {
    task: LinkedTaskMirrorRow;
    update: LinkedTaskUpdate;
  }): Promise<LinkedTaskMirrorRow> {
    const [row] = await this.db
      .update(linkedTasks)
      .set({
        title: input.update.title ?? input.task.title,
        external_task_url:
          input.update.externalTaskUrl === undefined
            ? input.task.externalTaskUrl
            : input.update.externalTaskUrl,
        status: input.update.status,
        blocked: input.update.blocked,
        sync_status: input.update.syncStatus,
        assignee_display:
          input.update.assigneeDisplay === undefined
            ? input.task.assigneeDisplay
            : input.update.assigneeDisplay,
        assignee_external_id:
          input.update.assigneeExternalId === undefined
            ? input.task.assigneeExternalId
            : input.update.assigneeExternalId,
        last_synced_at:
          input.update.syncStatus === "synced" ? new Date() : undefined,
        metadata: input.update.metadata,
        updated_at: new Date(),
      })
      .where(eq(linkedTasks.id, input.task.id))
      .returning();
    return toMirrorRow(row);
  }

  async createMilestoneEvent(
    input: LinkedTaskMilestoneInput,
  ): Promise<boolean> {
    const inserted = await this.db
      .insert(linkedTaskEvents)
      .values({
        tenant_id: input.tenantId,
        linked_task_id: input.linkedTask.id,
        space_id: input.linkedTask.spaceId,
        thread_id: input.linkedTask.threadId,
        provider: "lastmile",
        event_type: input.eventType,
        external_event_id: input.externalEventId,
        previous_status: input.previousStatus,
        new_status: input.newStatus,
        message: input.message,
        metadata: compactObject(input.metadata),
        occurred_at: input.occurredAt,
      })
      .onConflictDoNothing()
      .returning({ id: linkedTaskEvents.id });
    return inserted.length > 0;
  }

  async createThreadMilestone(input: {
    tenantId: string;
    threadId: string;
    content: string;
    metadata: Record<string, unknown>;
  }): Promise<void> {
    await this.db.insert(messages).values({
      tenant_id: input.tenantId,
      thread_id: input.threadId,
      role: "system",
      sender_type: "system",
      content: input.content,
      metadata: input.metadata,
    });
  }
}

function toMirrorRow(
  row: typeof linkedTasks.$inferSelect,
): LinkedTaskMirrorRow {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    spaceId: row.space_id,
    threadId: row.thread_id,
    provider: row.provider,
    externalTaskId: row.external_task_id,
    externalTaskUrl: row.external_task_url,
    title: row.title,
    required: row.required,
    status: row.status as LinkedTaskStatus,
    blocked: row.blocked,
    syncStatus: row.sync_status as LinkedTaskSyncStatus,
    assigneeDisplay: row.assignee_display,
    assigneeExternalId: row.assignee_external_id,
    metadata:
      row.metadata && typeof row.metadata === "object"
        ? (row.metadata as Record<string, unknown>)
        : null,
  };
}
