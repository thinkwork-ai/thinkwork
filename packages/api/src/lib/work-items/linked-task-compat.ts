import { and, eq } from "drizzle-orm";
import { schema } from "@thinkwork/database-pg";
import { db as defaultDb } from "../db.js";
import type { TaskStatusToolActor } from "../task-status-tool.js";
import { linkedTaskStatusForWorkItemProgress } from "./progress.js";

const { linkedTaskEvents, linkedTasks, workItemStatuses, workItems } = schema;

export interface LinkedTaskCompatUpdate {
  tenantId: string;
  workItemId: string;
  statusCategory: string;
  threadId?: string | null;
  note?: string | null;
  metadata?: Record<string, unknown> | null;
  actor?: TaskStatusToolActor | null;
  occurredAt?: Date;
}

export interface LinkedTaskCompatDeps {
  database?: typeof defaultDb;
}

export interface LinkedTaskCompatResult {
  linkedTaskId: string;
  previousStatus: string;
  status: string;
}

export async function syncLinkedTaskFromWorkItem(
  input: LinkedTaskCompatUpdate,
  deps: LinkedTaskCompatDeps = {},
): Promise<LinkedTaskCompatResult | null> {
  const database = deps.database ?? defaultDb;
  const [item] = await database
    .select({
      id: workItems.id,
      title: workItems.title,
      applicable: workItems.applicable,
      metadata: workItems.metadata,
      statusCategory: workItemStatuses.category,
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
  if (!item) return null;

  const metadata = objectRecord(item.metadata);
  const linkedTaskId = stringValue(metadata.linkedTaskId);
  if (!linkedTaskId) return null;

  const [task] = await database
    .select({
      id: linkedTasks.id,
      spaceId: linkedTasks.space_id,
      threadId: linkedTasks.thread_id,
      provider: linkedTasks.provider,
      status: linkedTasks.status,
      metadata: linkedTasks.metadata,
    })
    .from(linkedTasks)
    .where(
      and(
        eq(linkedTasks.tenant_id, input.tenantId),
        eq(linkedTasks.id, linkedTaskId),
      ),
    )
    .limit(1);
  if (!task || task.provider !== "thinkwork") return null;

  const nextStatus = linkedTaskStatusForWorkItemProgress(
    input.statusCategory || item.statusCategory,
    item.applicable,
  );
  const now = input.occurredAt ?? new Date();
  const nextMetadata = compactObject({
    ...objectRecord(task.metadata),
    nativeWorkItemId: item.id,
    nativeWorkItem: compactObject({
      ...objectRecord(objectRecord(task.metadata).nativeWorkItem),
      id: item.id,
      lastSyncedAt: now.toISOString(),
    }),
    workItemStatusTool: compactObject({
      source: "work_items",
      note: input.note ?? undefined,
      metadata: input.metadata ?? undefined,
      actor: input.actor ?? undefined,
      syncedAt: now.toISOString(),
    }),
  });

  await database
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
        eq(linkedTasks.tenant_id, input.tenantId),
        eq(linkedTasks.id, task.id),
      ),
    );

  await database.insert(linkedTaskEvents).values({
    tenant_id: input.tenantId,
    linked_task_id: task.id,
    space_id: task.spaceId,
    thread_id: input.threadId ?? task.threadId,
    provider: "thinkwork",
    event_type: eventTypeForStatus(nextStatus),
    previous_status: task.status,
    new_status: nextStatus,
    message: `${item.title} synced from native Work Item status ${String(
      input.statusCategory || item.statusCategory,
    ).replace(/_/g, " ")}.`,
    metadata: compactObject({
      source: "set_work_item_status",
      workItemId: item.id,
      note: input.note ?? undefined,
      actor: input.actor ?? undefined,
      manualMetadata: input.metadata ?? undefined,
    }),
    occurred_at: now,
  });

  return {
    linkedTaskId: task.id,
    previousStatus: String(task.status),
    status: nextStatus,
  };
}

function eventTypeForStatus(status: string) {
  if (status === "completed") return "completed";
  if (status === "blocked") return "blocked";
  return "status_changed";
}

function objectRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function compactObject<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).filter(([, child]) => child !== undefined),
  ) as T;
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null;
}
