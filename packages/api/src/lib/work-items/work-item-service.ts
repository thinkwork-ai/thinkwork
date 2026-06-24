import {
  and,
  asc,
  desc,
  eq,
  gte,
  inArray,
  isNull,
  lte,
  sql,
} from "drizzle-orm";
import { schema } from "@thinkwork/database-pg";

import { db as defaultDb } from "../db.js";
import {
  ensureDefaultWorkItemStatuses,
  findStatusForCategory,
  findWorkItemStatus,
  parseWorkItemStatusCategory,
  type WorkItemStatusCategory,
} from "./status-service.js";

const { workItemEvents, workItemStatuses, workItemThreadLinks, workItems } =
  schema;

export const WORK_ITEM_PRIORITIES = [
  "low",
  "medium",
  "high",
  "urgent",
] as const;
export type WorkItemPriority = (typeof WORK_ITEM_PRIORITIES)[number];

export interface WorkItemActor {
  type: "system" | "user" | "agent" | "service";
  userId?: string | null;
  agentId?: string | null;
}

export interface WorkItemsFilter {
  tenantId: string;
  spaceIds?: string[] | null;
  statusIds?: string[] | null;
  statusCategories?: string[] | null;
  ownerUserId?: string | null;
  ownerAgentId?: string | null;
  threadId?: string | null;
  dueBefore?: string | Date | null;
  dueAfter?: string | Date | null;
  blocked?: boolean | null;
  priority?: string | null;
  required?: boolean | null;
  applicable?: boolean | null;
  search?: string | null;
  includeArchived?: boolean | null;
  first?: number | null;
  after?: string | null;
  sortBy?: string | null;
  sortDirection?: string | null;
}

export interface CreateWorkItemInput {
  tenantId: string;
  spaceId: string;
  threadIds?: string[] | null;
  statusId?: string | null;
  title: string;
  notes?: string | null;
  priority?: string | null;
  ownerUserId?: string | null;
  ownerAgentId?: string | null;
  dueAt?: string | Date | null;
  required?: boolean | null;
  applicable?: boolean | null;
  blocked?: boolean | null;
  templateSourceId?: string | null;
  metadata?: unknown;
  actor?: WorkItemActor;
}

export interface UpdateWorkItemInput {
  tenantId: string;
  id: string;
  statusId?: string | null;
  title?: string | null;
  notes?: string | null;
  priority?: string | null;
  ownerUserId?: string | null;
  ownerAgentId?: string | null;
  dueAt?: string | Date | null;
  required?: boolean | null;
  applicable?: boolean | null;
  blocked?: boolean | null;
  metadata?: unknown;
  archived?: boolean | null;
  actor?: WorkItemActor;
}

export interface UpdateWorkItemStatusInput {
  tenantId: string;
  id: string;
  statusId?: string | null;
  statusCategory?: string | null;
  threadId?: string | null;
  note?: string | null;
  metadata?: unknown;
  actor?: WorkItemActor;
}

export interface WorkItemServiceDeps {
  db?: typeof defaultDb | any;
  now?: () => Date;
}

export class WorkItemServiceError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
    public readonly code: string,
  ) {
    super(message);
    this.name = "WorkItemServiceError";
  }
}

export const workItemColumns = {
  id: workItems.id,
  tenant_id: workItems.tenant_id,
  space_id: workItems.space_id,
  status_id: workItems.status_id,
  title: workItems.title,
  notes: workItems.notes,
  priority: workItems.priority,
  owner_user_id: workItems.owner_user_id,
  owner_agent_id: workItems.owner_agent_id,
  due_at: workItems.due_at,
  required: workItems.required,
  applicable: workItems.applicable,
  blocked: workItems.blocked,
  completed_at: workItems.completed_at,
  completed_by_user_id: workItems.completed_by_user_id,
  completed_by_agent_id: workItems.completed_by_agent_id,
  created_by_user_id: workItems.created_by_user_id,
  created_by_agent_id: workItems.created_by_agent_id,
  template_source_id: workItems.template_source_id,
  metadata: workItems.metadata,
  created_at: workItems.created_at,
  updated_at: workItems.updated_at,
  archived_at: workItems.archived_at,
};

export async function createWorkItem(
  input: CreateWorkItemInput,
  deps: WorkItemServiceDeps = {},
) {
  const database = deps.db ?? defaultDb;
  const now = deps.now?.() ?? new Date();
  const actor = normalizeActor(input.actor);
  const priority = parseWorkItemPriority(input.priority ?? "medium");
  const title = cleanRequired(input.title, "Work item title");
  const metadata = parseAwsJson(input.metadata);

  return database.transaction(async (tx: any) => {
    await ensureDefaultWorkItemStatuses(
      { tenantId: input.tenantId, spaceId: input.spaceId },
      { ...deps, db: tx },
    );
    const status = input.statusId
      ? await requireStatus(
          {
            tenantId: input.tenantId,
            spaceId: input.spaceId,
            statusId: input.statusId,
          },
          { ...deps, db: tx },
        )
      : await requireCategoryStatus(
          {
            tenantId: input.tenantId,
            spaceId: input.spaceId,
            category: input.blocked ? "blocked" : "todo",
          },
          { ...deps, db: tx },
        );

    const finalStatus = Boolean(status.is_final);
    const [created] = await tx
      .insert(workItems)
      .values({
        tenant_id: input.tenantId,
        space_id: input.spaceId,
        status_id: status.id,
        title,
        notes: cleanOptional(input.notes),
        priority,
        owner_user_id: nullableId(input.ownerUserId),
        owner_agent_id: nullableId(input.ownerAgentId),
        due_at: parseDate(input.dueAt),
        required: input.required ?? true,
        applicable: input.applicable ?? true,
        blocked: input.blocked ?? status.category === "blocked",
        completed_at: finalStatus ? now : null,
        completed_by_user_id: finalStatus ? actor.userId : null,
        completed_by_agent_id: finalStatus ? actor.agentId : null,
        created_by_user_id: actor.userId,
        created_by_agent_id: actor.agentId,
        template_source_id: nullableId(input.templateSourceId),
        metadata,
        created_at: now,
        updated_at: now,
      })
      .returning(workItemColumns);

    const threadIds = Array.from(new Set(input.threadIds ?? [])).filter(
      Boolean,
    );
    if (threadIds.length > 0) {
      await tx.insert(workItemThreadLinks).values(
        threadIds.map((threadId) => ({
          tenant_id: input.tenantId,
          work_item_id: created.id,
          thread_id: threadId,
          space_id: input.spaceId,
          relationship: "context",
          created_at: now,
        })),
      );
    }

    await recordWorkItemEvent(tx, {
      item: created,
      actor,
      eventType: "created",
      newStatusId: status.id,
      threadId: threadIds[0] ?? null,
      message: `Created work item: ${title}`,
      metadata: compactObject({ source: "create_work_item" }),
      now,
    });

    return created;
  });
}

export async function updateWorkItem(
  input: UpdateWorkItemInput,
  deps: WorkItemServiceDeps = {},
) {
  const database = deps.db ?? defaultDb;
  const now = deps.now?.() ?? new Date();
  const actor = normalizeActor(input.actor);

  return database.transaction(async (tx: any) => {
    const current = await getWorkItem(
      { tenantId: input.tenantId, id: input.id },
      { ...deps, db: tx },
    );
    if (!current) {
      throw new WorkItemServiceError("Work item not found", 404, "NOT_FOUND");
    }

    const nextStatus = input.statusId
      ? await requireStatus(
          {
            tenantId: input.tenantId,
            spaceId: current.space_id,
            statusId: input.statusId,
          },
          { ...deps, db: tx },
        )
      : null;
    const nextCategory = nextStatus?.category as WorkItemStatusCategory | null;
    const finalStatus = Boolean(nextStatus?.is_final);
    const changedStatus =
      Boolean(nextStatus) && nextStatus?.id !== current.status_id;
    const nextBlocked =
      input.blocked ??
      (changedStatus && nextCategory ? nextCategory === "blocked" : undefined);

    const [updated] = await tx
      .update(workItems)
      .set(
        compactObject({
          status_id: nextStatus?.id,
          title:
            input.title === undefined
              ? undefined
              : cleanRequired(input.title ?? "", "Work item title"),
          notes:
            input.notes === undefined ? undefined : cleanOptional(input.notes),
          priority:
            input.priority === undefined || input.priority === null
              ? undefined
              : parseWorkItemPriority(input.priority),
          owner_user_id:
            input.ownerUserId === undefined
              ? undefined
              : nullableId(input.ownerUserId),
          owner_agent_id:
            input.ownerAgentId === undefined
              ? undefined
              : nullableId(input.ownerAgentId),
          due_at:
            input.dueAt === undefined ? undefined : parseDate(input.dueAt),
          required: input.required ?? undefined,
          applicable: input.applicable ?? undefined,
          blocked: nextBlocked,
          metadata:
            input.metadata === undefined
              ? undefined
              : parseAwsJson(input.metadata),
          completed_at: changedStatus ? (finalStatus ? now : null) : undefined,
          completed_by_user_id: changedStatus
            ? finalStatus
              ? actor.userId
              : null
            : undefined,
          completed_by_agent_id: changedStatus
            ? finalStatus
              ? actor.agentId
              : null
            : undefined,
          archived_at:
            input.archived === undefined || input.archived === null
              ? undefined
              : input.archived
                ? now
                : null,
          updated_at: now,
        }),
      )
      .where(
        and(
          eq(workItems.tenant_id, input.tenantId),
          eq(workItems.id, input.id),
        ),
      )
      .returning(workItemColumns);

    await recordWorkItemEvent(tx, {
      item: updated,
      actor,
      eventType: changedStatus ? eventTypeForStatus(nextCategory) : "updated",
      previousStatusId: changedStatus ? current.status_id : null,
      newStatusId: changedStatus ? updated.status_id : null,
      message: changedStatus
        ? `Status changed for work item: ${updated.title}`
        : `Updated work item: ${updated.title}`,
      metadata: compactObject({ source: "update_work_item" }),
      now,
    });

    return updated;
  });
}

export async function updateWorkItemStatus(
  input: UpdateWorkItemStatusInput,
  deps: WorkItemServiceDeps = {},
) {
  const database = deps.db ?? defaultDb;
  const now = deps.now?.() ?? new Date();
  const actor = normalizeActor(input.actor);

  return database.transaction(async (tx: any) => {
    const current = await getWorkItem(
      { tenantId: input.tenantId, id: input.id },
      { ...deps, db: tx },
    );
    if (!current) {
      throw new WorkItemServiceError("Work item not found", 404, "NOT_FOUND");
    }
    const status = input.statusId
      ? await requireStatus(
          {
            tenantId: input.tenantId,
            spaceId: current.space_id,
            statusId: input.statusId,
          },
          { ...deps, db: tx },
        )
      : await requireCategoryStatus(
          {
            tenantId: input.tenantId,
            spaceId: current.space_id,
            category: parseWorkItemStatusCategory(input.statusCategory ?? ""),
          },
          { ...deps, db: tx },
        );
    const category = status.category as WorkItemStatusCategory;
    const finalStatus = Boolean(status.is_final);

    const [updated] = await tx
      .update(workItems)
      .set({
        status_id: status.id,
        blocked: category === "blocked",
        completed_at: finalStatus ? now : null,
        completed_by_user_id: finalStatus ? actor.userId : null,
        completed_by_agent_id: finalStatus ? actor.agentId : null,
        updated_at: now,
      })
      .where(
        and(
          eq(workItems.tenant_id, input.tenantId),
          eq(workItems.id, input.id),
        ),
      )
      .returning(workItemColumns);

    await recordWorkItemEvent(tx, {
      item: updated,
      actor,
      eventType: eventTypeForStatus(category),
      previousStatusId: current.status_id,
      newStatusId: status.id,
      threadId: input.threadId ?? null,
      message: buildStatusMessage(updated.title, status.name, input.note),
      metadata: compactObject({
        source: "update_work_item_status",
        note: cleanOptional(input.note),
        manualMetadata: parseAwsJson(input.metadata),
      }),
      now,
    });

    return updated;
  });
}

export async function getWorkItem(
  input: { tenantId: string; id: string },
  deps: WorkItemServiceDeps = {},
) {
  const database = deps.db ?? defaultDb;
  const [item] = await database
    .select(workItemColumns)
    .from(workItems)
    .where(
      and(eq(workItems.tenant_id, input.tenantId), eq(workItems.id, input.id)),
    )
    .limit(1);
  return item ?? null;
}

export async function listWorkItems(
  input: WorkItemsFilter,
  deps: WorkItemServiceDeps = {},
) {
  const database = deps.db ?? defaultDb;
  const limit = Math.min(Math.max(input.first ?? 50, 1), 100);
  const offset = decodeOffsetCursor(input.after);
  const conditions: any[] = [eq(workItems.tenant_id, input.tenantId)];

  if (!input.includeArchived) {
    conditions.push(isNull(workItems.archived_at));
  }
  if (input.spaceIds?.length) {
    conditions.push(inArray(workItems.space_id, input.spaceIds));
  }
  if (input.statusIds?.length) {
    conditions.push(inArray(workItems.status_id, input.statusIds));
  }
  if (input.statusCategories?.length) {
    const categories = input.statusCategories.map(parseWorkItemStatusCategory);
    const statusRows = await database
      .select({ id: workItemStatuses.id })
      .from(workItemStatuses)
      .where(
        and(
          eq(workItemStatuses.tenant_id, input.tenantId),
          inArray(workItemStatuses.category, categories),
        ),
      );
    const statusIds = statusRows.map((row: { id: string }) => row.id);
    if (statusIds.length === 0) {
      return connection([], offset, limit);
    }
    conditions.push(inArray(workItems.status_id, statusIds));
  }
  if (input.ownerUserId) {
    conditions.push(eq(workItems.owner_user_id, input.ownerUserId));
  }
  if (input.ownerAgentId) {
    conditions.push(eq(workItems.owner_agent_id, input.ownerAgentId));
  }
  if (input.threadId) {
    const linkRows = await database
      .select({ work_item_id: workItemThreadLinks.work_item_id })
      .from(workItemThreadLinks)
      .where(
        and(
          eq(workItemThreadLinks.tenant_id, input.tenantId),
          eq(workItemThreadLinks.thread_id, input.threadId),
        ),
      );
    const ids = linkRows.map(
      (row: { work_item_id: string }) => row.work_item_id,
    );
    if (ids.length === 0) return connection([], offset, limit);
    conditions.push(inArray(workItems.id, ids));
  }
  if (input.dueAfter) {
    conditions.push(gte(workItems.due_at, requiredDate(input.dueAfter)));
  }
  if (input.dueBefore) {
    conditions.push(lte(workItems.due_at, requiredDate(input.dueBefore)));
  }
  if (input.blocked !== undefined && input.blocked !== null) {
    conditions.push(eq(workItems.blocked, input.blocked));
  }
  if (input.priority) {
    conditions.push(
      eq(workItems.priority, parseWorkItemPriority(input.priority)),
    );
  }
  if (input.required !== undefined && input.required !== null) {
    conditions.push(eq(workItems.required, input.required));
  }
  if (input.applicable !== undefined && input.applicable !== null) {
    conditions.push(eq(workItems.applicable, input.applicable));
  }
  const search = input.search?.trim();
  if (search) {
    conditions.push(
      sql`lower(${workItems.title}) LIKE ${`%${search.toLowerCase()}%`}`,
    );
  }

  const rows = await database
    .select(workItemColumns)
    .from(workItems)
    .where(and(...conditions))
    .orderBy(orderBy(input.sortBy, input.sortDirection))
    .limit(limit + 1)
    .offset(offset);

  return connection(rows, offset, limit);
}

export async function listThreadWorkItems(
  input: { tenantId: string; threadId: string },
  deps: WorkItemServiceDeps = {},
) {
  const database = deps.db ?? defaultDb;
  const rows = await database
    .select(workItemColumns)
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
        eq(workItemThreadLinks.thread_id, input.threadId),
        isNull(workItems.archived_at),
      ),
    )
    .orderBy(asc(workItems.created_at));
  return rows;
}

export async function recordWorkItemEvent(
  tx: any,
  input: {
    item: Record<string, any>;
    actor: WorkItemActor;
    eventType: string;
    previousStatusId?: string | null;
    newStatusId?: string | null;
    threadId?: string | null;
    message?: string | null;
    metadata?: Record<string, unknown> | null;
    now: Date;
  },
) {
  await tx.insert(workItemEvents).values({
    tenant_id: input.item.tenant_id,
    space_id: input.item.space_id,
    work_item_id: input.item.id,
    thread_id: input.threadId ?? null,
    actor_type: input.actor.type,
    actor_user_id: input.actor.userId ?? null,
    actor_agent_id: input.actor.agentId ?? null,
    event_type: input.eventType,
    previous_status_id: input.previousStatusId ?? null,
    new_status_id: input.newStatusId ?? null,
    message: input.message ?? null,
    metadata: input.metadata ?? null,
    created_at: input.now,
  });
}

export function parseWorkItemPriority(value: string): WorkItemPriority {
  const normalized = value.trim().toLowerCase();
  if (WORK_ITEM_PRIORITIES.includes(normalized as WorkItemPriority)) {
    return normalized as WorkItemPriority;
  }
  throw new WorkItemServiceError(
    `Unsupported work item priority: ${value}`,
    400,
    "INVALID_PRIORITY",
  );
}

export function parseAwsJson(value: unknown): Record<string, unknown> | null {
  if (value === undefined || value === null || value === "") return null;
  let parsed: unknown;
  try {
    parsed = typeof value === "string" ? JSON.parse(value) : value;
  } catch {
    throw new WorkItemServiceError(
      "JSON payload must be valid JSON",
      400,
      "INVALID_JSON",
    );
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new WorkItemServiceError(
      "JSON payload must be an object",
      400,
      "INVALID_JSON",
    );
  }
  return parsed as Record<string, unknown>;
}

function connection(
  rows: Record<string, unknown>[],
  offset: number,
  limit: number,
) {
  const items = rows.slice(0, limit);
  const hasNextPage = rows.length > limit;
  return {
    items,
    pageInfo: {
      hasNextPage,
      endCursor: hasNextPage ? encodeOffsetCursor(offset + limit) : null,
    },
  };
}

function orderBy(
  sortBy: string | null | undefined,
  direction: string | null | undefined,
) {
  const sortDirection = direction?.toLowerCase() === "asc" ? asc : desc;
  switch (sortBy) {
    case "dueAt":
    case "due_at":
      return sortDirection(workItems.due_at);
    case "title":
      return sortDirection(workItems.title);
    case "priority":
      return sortDirection(workItems.priority);
    case "createdAt":
    case "created_at":
      return sortDirection(workItems.created_at);
    case "updatedAt":
    case "updated_at":
    default:
      return sortDirection(workItems.updated_at);
  }
}

function encodeOffsetCursor(value: number) {
  return Buffer.from(String(value), "utf8").toString("base64url");
}

function decodeOffsetCursor(value: string | null | undefined) {
  if (!value) return 0;
  const decoded = Number(Buffer.from(value, "base64url").toString("utf8"));
  return Number.isFinite(decoded) && decoded >= 0 ? decoded : 0;
}

async function requireStatus(
  input: { tenantId: string; spaceId: string; statusId: string },
  deps: WorkItemServiceDeps,
) {
  const status = await findWorkItemStatus(input, deps);
  if (!status) {
    throw new WorkItemServiceError(
      "Work item status not found for this Space",
      400,
      "INVALID_STATUS",
    );
  }
  return status;
}

async function requireCategoryStatus(
  input: {
    tenantId: string;
    spaceId: string;
    category: WorkItemStatusCategory;
  },
  deps: WorkItemServiceDeps,
) {
  const status = await findStatusForCategory(input, deps);
  if (!status) {
    throw new WorkItemServiceError(
      `No ${input.category} work item status exists for this Space`,
      400,
      "STATUS_CATEGORY_NOT_FOUND",
    );
  }
  return status;
}

function eventTypeForStatus(
  category: WorkItemStatusCategory | null | undefined,
) {
  if (category === "done") return "completed";
  if (category === "blocked") return "blocked";
  if (category === "skipped") return "skipped";
  return "status_changed";
}

function buildStatusMessage(
  title: string,
  statusName: string,
  note: string | null | undefined,
) {
  const suffix = cleanOptional(note) ? ` Note: ${cleanOptional(note)}` : "";
  return `${title} moved to ${statusName}.${suffix}`;
}

function parseDate(value: string | Date | null | undefined) {
  if (value === undefined || value === null || value === "") return null;
  return value instanceof Date ? value : new Date(value);
}

function requiredDate(value: string | Date) {
  return value instanceof Date ? value : new Date(value);
}

function normalizeActor(
  actor: WorkItemActor | null | undefined,
): WorkItemActor {
  return {
    type: actor?.type ?? "system",
    userId: actor?.userId ?? null,
    agentId: actor?.agentId ?? null,
  };
}

function cleanRequired(value: string, label: string) {
  const cleaned = value.trim();
  if (!cleaned) {
    throw new WorkItemServiceError(
      `${label} is required`,
      400,
      "REQUIRED_FIELD",
    );
  }
  return cleaned;
}

function cleanOptional(value: string | null | undefined) {
  const cleaned = value?.trim();
  return cleaned ? cleaned : null;
}

function nullableId(value: string | null | undefined) {
  const cleaned = value?.trim();
  return cleaned ? cleaned : null;
}

function compactObject<T extends Record<string, unknown>>(
  value: T,
): Partial<T> {
  return Object.fromEntries(
    Object.entries(value).filter(([, child]) => child !== undefined),
  ) as Partial<T>;
}
