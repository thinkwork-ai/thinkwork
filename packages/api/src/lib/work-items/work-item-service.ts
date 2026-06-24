import { GraphQLError } from "graphql";

import type { GraphQLContext } from "../../graphql/context.js";
import {
  and,
  asc,
  db,
  desc,
  eq,
  gte,
  isNull,
  lte,
  or,
  sql,
  spaceMembers,
  spaces,
  workItemEvents,
  workItemStatuses,
  workItemThreadLinks,
  workItems,
} from "../../graphql/utils.js";
import { resolveCallerUserId } from "../../graphql/resolvers/core/resolve-auth-user.js";
import { canReadTenantSpaces } from "../../graphql/resolvers/spaces/shared.js";
import { requireWorkItemSpaceAccess, resolveWorkItemTenant } from "./auth.js";
import {
  findStatusForWorkItemUpdate,
  normalizeWorkItemStatusCategory,
} from "./status-service.js";

export type WorkItemPriority = "low" | "normal" | "high" | "urgent";

export async function listWorkItems(
  ctx: GraphQLContext,
  input: Record<string, any> = {},
) {
  const tenantId = await resolveWorkItemTenant(ctx, input.tenantId);
  if (!(await canReadTenantSpaces(ctx, tenantId))) return [];
  if (input.spaceId) {
    try {
      await requireWorkItemSpaceAccess(ctx, tenantId, input.spaceId);
    } catch {
      return [];
    }
  }

  const conditions: any[] = [eq(workItems.tenant_id, tenantId)];
  if (input.spaceId) conditions.push(eq(workItems.space_id, input.spaceId));
  if (!input.includeArchived) conditions.push(isNull(workItems.archived_at));
  if (input.statusId) conditions.push(eq(workItems.status_id, input.statusId));
  if (input.ownerUserId) {
    conditions.push(eq(workItems.owner_user_id, input.ownerUserId));
  }
  if (input.ownerAgentId) {
    conditions.push(eq(workItems.owner_agent_id, input.ownerAgentId));
  }
  if (input.blocked !== undefined && input.blocked !== null) {
    conditions.push(eq(workItems.blocked, Boolean(input.blocked)));
  }
  if (input.required !== undefined && input.required !== null) {
    conditions.push(eq(workItems.required, Boolean(input.required)));
  }
  if (input.applicable !== undefined && input.applicable !== null) {
    conditions.push(eq(workItems.applicable, Boolean(input.applicable)));
  }
  if (input.priority) {
    conditions.push(
      eq(workItems.priority, normalizeWorkItemPriority(input.priority)),
    );
  }
  if (input.dueAfter)
    conditions.push(gte(workItems.due_at, new Date(input.dueAfter)));
  if (input.dueBefore) {
    conditions.push(lte(workItems.due_at, new Date(input.dueBefore)));
  }
  if (input.statusCategory) {
    const category = normalizeWorkItemStatusCategory(input.statusCategory);
    conditions.push(sql`EXISTS (
      SELECT 1
        FROM ${workItemStatuses} wis
       WHERE wis.id = ${workItems.status_id}
         AND wis.tenant_id = ${tenantId}
         AND wis.space_id = ${workItems.space_id}
         AND wis.category = ${category}
    )`);
  }
  if (input.threadId) {
    conditions.push(sql`EXISTS (
      SELECT 1
        FROM ${workItemThreadLinks} witl
       WHERE witl.tenant_id = ${tenantId}
         AND witl.work_item_id = ${workItems.id}
         AND witl.thread_id = ${input.threadId}
    )`);
  }

  const search = typeof input.search === "string" ? input.search.trim() : "";
  if (search) {
    conditions.push(
      or(
        sql`${workItems.title} ILIKE ${`%${search}%`}`,
        sql`${workItems.notes} ILIKE ${`%${search}%`}`,
      ),
    );
  }

  const callerUserId =
    ctx.auth?.authType === "cognito" ? await resolveCallerUserId(ctx) : null;
  if (ctx.auth?.authType === "cognito") {
    if (!callerUserId) return [];
    conditions.push(visibleSpaceExistsPredicate(tenantId, callerUserId));
  }

  return db
    .select()
    .from(workItems)
    .where(and(...conditions))
    .orderBy(desc(workItems.updated_at))
    .limit(clampLimit(input.limit));
}

export async function getWorkItem(
  ctx: GraphQLContext,
  input: { tenantId?: string | null; id: string },
) {
  const tenantId = await resolveWorkItemTenant(ctx, input.tenantId);
  const [item] = await db
    .select()
    .from(workItems)
    .where(and(eq(workItems.tenant_id, tenantId), eq(workItems.id, input.id)));
  if (!item) return null;
  try {
    await requireWorkItemSpaceAccess(ctx, tenantId, item.space_id);
  } catch {
    return null;
  }
  return item;
}

export async function createWorkItem(
  ctx: GraphQLContext,
  input: Record<string, any>,
) {
  const tenantId = await resolveWorkItemTenant(ctx, input.tenantId);
  await requireWorkItemSpaceAccess(ctx, tenantId, input.spaceId);
  const callerUserId = await resolveCallerUserId(ctx).catch(() => null);

  return db.transaction(async (tx) => {
    const status = await findStatusForWorkItemUpdate({
      tenantId,
      spaceId: input.spaceId,
      statusId: input.statusId,
      tx: tx as unknown as typeof db,
    });
    const now = new Date();
    const [created] = await tx
      .insert(workItems)
      .values({
        tenant_id: tenantId,
        space_id: input.spaceId,
        status_id: status.id,
        title: requireNonEmpty(input.title, "title"),
        notes: optionalTrim(input.notes),
        priority: input.priority
          ? normalizeWorkItemPriority(input.priority)
          : "normal",
        owner_user_id: input.ownerUserId ?? null,
        owner_agent_id: input.ownerAgentId ?? null,
        due_at: input.dueAt ? new Date(input.dueAt) : null,
        required: input.required ?? true,
        applicable: input.applicable ?? true,
        blocked: input.blocked ?? status.category === "blocked",
        completed_at:
          status.is_final && status.category === "done" ? now : null,
        completed_by_user_id:
          status.is_final && status.category === "done" ? callerUserId : null,
        template_source_id: input.templateSourceId ?? null,
        created_by_user_id: callerUserId,
        metadata: parseAwsJsonObject(input.metadata),
        updated_at: now,
      })
      .returning();

    if (input.threadId) {
      await tx.insert(workItemThreadLinks).values({
        tenant_id: tenantId,
        work_item_id: created.id,
        thread_id: input.threadId,
        space_id: input.spaceId,
        relationship: "primary",
      });
    }

    await tx.insert(workItemEvents).values({
      tenant_id: tenantId,
      space_id: input.spaceId,
      work_item_id: created.id,
      thread_id: input.threadId ?? null,
      actor_user_id: callerUserId,
      event_type: "created",
      new_status_id: status.id,
      message: `${created.title} created.`,
      metadata: compactObject({
        source: "graphql",
        inputMetadata: parseAwsJsonObject(input.metadata),
      }),
    });

    return created;
  });
}

export async function updateWorkItem(
  ctx: GraphQLContext,
  input: Record<string, any>,
) {
  const tenantId = await resolveWorkItemTenant(ctx, input.tenantId);
  const item = await loadAuthorizedWorkItem(ctx, tenantId, input.workItemId);
  const now = new Date();
  const updates: Record<string, unknown> = { updated_at: now };

  if (input.title !== undefined)
    updates.title = requireNonEmpty(input.title, "title");
  if (input.notes !== undefined) updates.notes = optionalTrim(input.notes);
  if (input.priority !== undefined) {
    updates.priority = normalizeWorkItemPriority(input.priority);
  }
  if (input.ownerUserId !== undefined)
    updates.owner_user_id = input.ownerUserId;
  if (input.ownerAgentId !== undefined)
    updates.owner_agent_id = input.ownerAgentId;
  if (input.dueAt !== undefined) {
    updates.due_at = input.dueAt ? new Date(input.dueAt) : null;
  }
  if (input.required !== undefined) updates.required = Boolean(input.required);
  if (input.applicable !== undefined) {
    updates.applicable = Boolean(input.applicable);
  }
  if (input.blocked !== undefined) updates.blocked = Boolean(input.blocked);
  if (input.metadata !== undefined)
    updates.metadata = parseAwsJsonObject(input.metadata);
  if (input.archived !== undefined) {
    updates.archived_at = input.archived ? now : null;
  }

  return db.transaction(async (tx) => {
    const [updated] = await tx
      .update(workItems)
      .set(updates)
      .where(and(eq(workItems.tenant_id, tenantId), eq(workItems.id, item.id)))
      .returning();
    await tx.insert(workItemEvents).values({
      tenant_id: tenantId,
      space_id: item.space_id,
      work_item_id: item.id,
      actor_user_id: await resolveCallerUserId(ctx).catch(() => null),
      event_type: "updated",
      message: `${item.title} updated.`,
      metadata: compactObject({ changedFields: Object.keys(updates).sort() }),
    });
    return updated;
  });
}

export async function updateWorkItemStatus(
  ctx: GraphQLContext,
  input: Record<string, any>,
) {
  const tenantId = await resolveWorkItemTenant(ctx, input.tenantId);
  const item = await loadAuthorizedWorkItem(ctx, tenantId, input.workItemId);
  const callerUserId = await resolveCallerUserId(ctx).catch(() => null);

  return db.transaction(async (tx) => {
    const status = await findStatusForWorkItemUpdate({
      tenantId,
      spaceId: item.space_id,
      statusId: input.statusId,
      statusCategory: input.statusCategory,
      tx: tx as unknown as typeof db,
    });
    const now = new Date();
    const [updated] = await tx
      .update(workItems)
      .set({
        status_id: status.id,
        blocked: status.category === "blocked",
        completed_at:
          status.category === "done" || status.category === "skipped"
            ? now
            : null,
        completed_by_user_id:
          status.category === "done" || status.category === "skipped"
            ? callerUserId
            : null,
        completed_by_agent_id: null,
        updated_at: now,
      })
      .where(and(eq(workItems.tenant_id, tenantId), eq(workItems.id, item.id)))
      .returning();

    await tx.insert(workItemEvents).values({
      tenant_id: tenantId,
      space_id: item.space_id,
      work_item_id: item.id,
      thread_id: input.threadId ?? null,
      actor_user_id: callerUserId,
      event_type: eventTypeForStatus(status.category),
      previous_status_id: item.status_id,
      new_status_id: status.id,
      message: buildStatusMessage(item.title, status.name, input.note),
      metadata: compactObject({
        source: "graphql",
        note: optionalTrim(input.note),
        inputMetadata: parseAwsJsonObject(input.metadata),
      }),
    });

    return updated;
  });
}

export async function listThreadWorkItems(
  ctx: GraphQLContext,
  input: { tenantId?: string | null; threadId: string },
) {
  return listWorkItems(ctx, {
    tenantId: input.tenantId,
    threadId: input.threadId,
    includeArchived: false,
    limit: 500,
  });
}

async function loadAuthorizedWorkItem(
  ctx: GraphQLContext,
  tenantId: string,
  workItemId: string,
) {
  const [item] = await db
    .select()
    .from(workItems)
    .where(
      and(eq(workItems.tenant_id, tenantId), eq(workItems.id, workItemId)),
    );
  if (!item) {
    throw new GraphQLError("Work item not found", {
      extensions: { code: "NOT_FOUND" },
    });
  }
  await requireWorkItemSpaceAccess(ctx, tenantId, item.space_id);
  return item;
}

function visibleSpaceExistsPredicate(tenantId: string, callerUserId: string) {
  return sql`EXISTS (
    SELECT 1
      FROM ${spaces} visible_spaces
     WHERE visible_spaces.id = ${workItems.space_id}
       AND visible_spaces.tenant_id = ${tenantId}
       AND visible_spaces.status = 'active'
       AND (
         visible_spaces.access_mode = 'public'
         OR EXISTS (
           SELECT 1
             FROM ${spaceMembers} visible_space_members
            WHERE visible_space_members.tenant_id = ${tenantId}
              AND visible_space_members.space_id = visible_spaces.id
              AND visible_space_members.user_id = ${callerUserId}
         )
       )
  )`;
}

export function normalizeWorkItemPriority(value: unknown): WorkItemPriority {
  const normalized = String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
  if (
    normalized === "low" ||
    normalized === "normal" ||
    normalized === "high" ||
    normalized === "urgent"
  ) {
    return normalized;
  }
  throw new GraphQLError(`Unsupported work item priority: ${value}`, {
    extensions: { code: "BAD_USER_INPUT" },
  });
}

function eventTypeForStatus(category: string) {
  if (category === "done" || category === "skipped") return "completed";
  if (category === "blocked") return "blocked";
  return "status_changed";
}

function buildStatusMessage(
  title: string,
  statusName: string,
  note: string | null | undefined,
) {
  const suffix = optionalTrim(note) ? ` Note: ${optionalTrim(note)}` : "";
  return `${title} moved to ${statusName}.${suffix}`;
}

function clampLimit(value: unknown) {
  const parsed = Number(value ?? 100);
  if (!Number.isFinite(parsed)) return 100;
  return Math.min(Math.max(Math.trunc(parsed), 1), 500);
}

export function parseAwsJsonObject(value: unknown) {
  if (value === undefined) return undefined;
  if (value === null || value === "") return null;
  const parsed = typeof value === "string" ? JSON.parse(value) : value;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new GraphQLError("metadata/config fields must be JSON objects", {
      extensions: { code: "BAD_USER_INPUT" },
    });
  }
  return parsed as Record<string, unknown>;
}

function requireNonEmpty(value: unknown, field: string) {
  const trimmed = optionalTrim(value);
  if (!trimmed) {
    throw new GraphQLError(`${field} is required`, {
      extensions: { code: "BAD_USER_INPUT" },
    });
  }
  return trimmed;
}

function optionalTrim(value: unknown) {
  if (value === undefined || value === null) return null;
  const trimmed = String(value).trim();
  return trimmed ? trimmed : null;
}

function compactObject(value: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(value).filter(([, child]) => child !== undefined),
  );
}
