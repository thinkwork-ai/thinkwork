import { and, eq } from "drizzle-orm";
import { getDb } from "@thinkwork/database-pg";
import {
  linkedTasks,
  workItemEvents,
  workItemExternalRefs,
  workItems,
  workItemThreadLinks,
} from "@thinkwork/database-pg/schema";

import type { LinkedTaskStatus } from "../linked-tasks/status.js";
import type { CustomerOnboardingChecklistItem } from "../spaces/customer-onboarding-workflow.js";
import { findStatusForWorkItemUpdate } from "./status-service.js";

type JsonRecord = Record<string, unknown>;
type WorkItemDatabase = ReturnType<typeof getDb>;

export interface CreateCustomerOnboardingWorkItemInput {
  tenantId: string;
  spaceId: string;
  threadId: string;
  checklistItem: CustomerOnboardingChecklistItem;
  linkedTaskId?: string | null;
  task: {
    provider: "lastmile" | "thinkwork";
    title: string;
    externalTaskId: string;
    externalTaskUrl: string | null;
    status: LinkedTaskStatus;
    blocked: boolean;
  };
  required: boolean;
  roleKey: string | null;
  assignee: {
    externalId: string | null;
    displayName: string | null;
  } | null;
  metadata: JsonRecord;
}

export interface SyncWorkItemFromLinkedTaskInput {
  tenantId: string;
  linkedTaskId: string;
  status: LinkedTaskStatus;
  required?: boolean;
  blocked?: boolean;
  note?: string | null;
  actorUserId?: string | null;
  actorAgentId?: string | null;
  metadata?: JsonRecord | null;
}

export interface CustomerOnboardingWorkItemDeps {
  database?: WorkItemDatabase;
  now?: () => Date;
}

export async function createCustomerOnboardingWorkItem(
  input: CreateCustomerOnboardingWorkItemInput,
  deps: CustomerOnboardingWorkItemDeps = {},
): Promise<{ id: string; created: boolean }> {
  const database = deps.database ?? getDb();
  const now = deps.now?.() ?? new Date();
  const statusCategory = workItemStatusCategoryForLinkedTaskStatus(
    input.task.status,
  );
  const status = await findStatusForWorkItemUpdate({
    tenantId: input.tenantId,
    spaceId: input.spaceId,
    statusCategory,
    tx: database as never,
  });
  const applicable = input.task.status !== "not_applicable";
  const completed =
    input.task.status === "completed" || input.task.status === "cancelled";
  const skipped = input.task.status === "not_applicable";
  const existing = await findExistingWorkItem(database, input);
  const metadata = buildWorkItemMetadata(input, now);

  if (existing) {
    await database
      .update(workItems)
      .set({
        title: input.task.title,
        notes: input.checklistItem.description,
        status_id: status.id,
        required: input.required,
        applicable,
        blocked: input.task.blocked || statusCategory === "blocked",
        completed_at: completed || skipped ? now : null,
        metadata,
        updated_at: now,
      })
      .where(
        and(
          eq(workItems.tenant_id, input.tenantId),
          eq(workItems.id, existing.id),
        ),
      );
    await writeLinkedTaskNativePointer(database, {
      tenantId: input.tenantId,
      linkedTaskId: input.linkedTaskId,
      workItemId: existing.id,
      now,
    });
    return { id: existing.id, created: false };
  }

  const [created] = await database
    .insert(workItems)
    .values({
      tenant_id: input.tenantId,
      space_id: input.spaceId,
      status_id: status.id,
      title: input.task.title,
      notes: input.checklistItem.description,
      priority: "normal",
      required: input.required,
      applicable,
      blocked: input.task.blocked || statusCategory === "blocked",
      completed_at: completed || skipped ? now : null,
      template_source_id: input.checklistItem.id,
      metadata,
      updated_at: now,
    })
    .returning({ id: workItems.id });

  await database.insert(workItemThreadLinks).values({
    tenant_id: input.tenantId,
    work_item_id: created.id,
    thread_id: input.threadId,
    space_id: input.spaceId,
    relationship: "primary",
  });

  await database.insert(workItemExternalRefs).values({
    tenant_id: input.tenantId,
    work_item_id: created.id,
    provider: input.task.provider,
    external_id: input.task.externalTaskId,
    external_url: input.task.externalTaskUrl,
    metadata: {
      source: "customer_onboarding_workflow",
      linkedTaskId: input.linkedTaskId ?? null,
      checklistItemKey: input.checklistItem.key,
    },
  });

  await database.insert(workItemEvents).values({
    tenant_id: input.tenantId,
    space_id: input.spaceId,
    work_item_id: created.id,
    thread_id: input.threadId,
    event_type: "created",
    new_status_id: status.id,
    message: `${input.task.title} created from Customer Onboarding.`,
    metadata: {
      source: "customer_onboarding_workflow",
      linkedTaskId: input.linkedTaskId ?? null,
      checklistItemKey: input.checklistItem.key,
    },
  });

  await writeLinkedTaskNativePointer(database, {
    tenantId: input.tenantId,
    linkedTaskId: input.linkedTaskId,
    workItemId: created.id,
    now,
  });

  return { id: created.id, created: true };
}

export async function syncWorkItemFromLinkedTask(
  input: SyncWorkItemFromLinkedTaskInput,
  deps: CustomerOnboardingWorkItemDeps = {},
): Promise<{ id: string } | null> {
  const database = deps.database ?? getDb();
  const now = deps.now?.() ?? new Date();
  const [task] = await database
    .select()
    .from(linkedTasks)
    .where(
      and(
        eq(linkedTasks.tenant_id, input.tenantId),
        eq(linkedTasks.id, input.linkedTaskId),
      ),
    )
    .limit(1);
  if (!task) return null;

  const taskMetadata = objectRecord(task.metadata);
  const nativeWorkItem = objectRecord(taskMetadata.nativeWorkItem);
  const workItemId =
    stringValue(taskMetadata.nativeWorkItemId) ??
    stringValue(nativeWorkItem.id);
  if (!workItemId) return null;

  const [item] = await database
    .select()
    .from(workItems)
    .where(
      and(
        eq(workItems.tenant_id, input.tenantId),
        eq(workItems.id, workItemId),
      ),
    )
    .limit(1);
  if (!item) return null;

  const statusCategory = workItemStatusCategoryForLinkedTaskStatus(
    input.status,
  );
  const status = await findStatusForWorkItemUpdate({
    tenantId: input.tenantId,
    spaceId: item.space_id,
    statusCategory,
    tx: database as never,
  });
  const applicable = input.status !== "not_applicable";
  const terminal =
    input.status === "completed" ||
    input.status === "cancelled" ||
    input.status === "not_applicable";
  const nextMetadata = compactObject({
    ...objectRecord(item.metadata),
    linkedTaskId: task.id,
    linkedTaskStatus: input.status,
    lastCompatibilitySync: {
      source: "linked_tasks",
      syncedAt: now.toISOString(),
      note: input.note ?? undefined,
      metadata: input.metadata ?? undefined,
    },
  });

  await database
    .update(workItems)
    .set({
      status_id: status.id,
      required: input.required ?? task.required,
      applicable,
      blocked: input.blocked ?? input.status === "blocked",
      completed_at: terminal ? now : null,
      metadata: nextMetadata,
      updated_at: now,
    })
    .where(
      and(eq(workItems.tenant_id, input.tenantId), eq(workItems.id, item.id)),
    );

  await database.insert(workItemEvents).values({
    tenant_id: input.tenantId,
    space_id: item.space_id,
    work_item_id: item.id,
    thread_id: task.thread_id,
    actor_user_id: input.actorUserId ?? null,
    actor_agent_id: input.actorAgentId ?? null,
    event_type:
      input.status === "completed"
        ? "completed"
        : input.status === "blocked"
          ? "blocked"
          : "status_changed",
    previous_status_id: item.status_id,
    new_status_id: status.id,
    message: `${item.title} synced from linked task status ${input.status.replace(/_/g, " ")}.`,
    metadata: compactObject({
      source: "linked_tasks",
      linkedTaskId: task.id,
      note: input.note,
      actorUserId: input.actorUserId,
      actorAgentId: input.actorAgentId,
      metadata: input.metadata,
    }),
  });

  return { id: item.id };
}

export function workItemStatusCategoryForLinkedTaskStatus(
  status: LinkedTaskStatus,
): "todo" | "active" | "blocked" | "done" | "skipped" {
  switch (status) {
    case "completed":
      return "done";
    case "blocked":
      return "blocked";
    case "in_progress":
      return "active";
    case "cancelled":
    case "not_applicable":
      return "skipped";
    case "todo":
    case "unknown":
    default:
      return "todo";
  }
}

async function findExistingWorkItem(
  database: WorkItemDatabase,
  input: CreateCustomerOnboardingWorkItemInput,
) {
  const [existing] = await database
    .select({ id: workItems.id })
    .from(workItems)
    .innerJoin(
      workItemThreadLinks,
      and(
        eq(workItemThreadLinks.work_item_id, workItems.id),
        eq(workItemThreadLinks.tenant_id, workItems.tenant_id),
      ),
    )
    .where(
      and(
        eq(workItems.tenant_id, input.tenantId),
        eq(workItems.space_id, input.spaceId),
        eq(workItems.template_source_id, input.checklistItem.id),
        eq(workItemThreadLinks.thread_id, input.threadId),
      ),
    )
    .limit(1);
  return existing ?? null;
}

function buildWorkItemMetadata(
  input: CreateCustomerOnboardingWorkItemInput,
  now: Date,
) {
  return compactObject({
    ...input.metadata,
    workflow: "customer_onboarding",
    source: "customer_onboarding_workflow",
    systemOfRecord: "work_items",
    linkedTaskId: input.linkedTaskId ?? undefined,
    linkedTaskExternalTaskId: input.task.externalTaskId,
    checklistItemKey: input.checklistItem.key,
    roleKey: input.roleKey,
    assignee: input.assignee,
    nativeWorkItem: {
      createdFrom: "customer_onboarding_workflow",
      linkedAt: now.toISOString(),
    },
  });
}

async function writeLinkedTaskNativePointer(
  database: WorkItemDatabase,
  input: {
    tenantId: string;
    linkedTaskId?: string | null;
    workItemId: string;
    now: Date;
  },
) {
  if (!input.linkedTaskId) return;
  const [task] = await database
    .select({ metadata: linkedTasks.metadata })
    .from(linkedTasks)
    .where(
      and(
        eq(linkedTasks.tenant_id, input.tenantId),
        eq(linkedTasks.id, input.linkedTaskId),
      ),
    )
    .limit(1);
  if (!task) return;
  await database
    .update(linkedTasks)
    .set({
      metadata: compactObject({
        ...objectRecord(task.metadata),
        nativeWorkItemId: input.workItemId,
        nativeWorkItem: {
          id: input.workItemId,
          linkedAt: input.now.toISOString(),
        },
      }),
      updated_at: input.now,
    })
    .where(
      and(
        eq(linkedTasks.tenant_id, input.tenantId),
        eq(linkedTasks.id, input.linkedTaskId),
      ),
    );
}

function objectRecord(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : {};
}

function compactObject<T extends JsonRecord>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined),
  ) as T;
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null;
}
