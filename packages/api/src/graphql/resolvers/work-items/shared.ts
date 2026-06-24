import { GraphQLError } from "graphql";

import type { GraphQLContext } from "../../context.js";
import {
  and,
  asc,
  db,
  eq,
  spaces,
  snakeToCamel,
  workItemEvents,
  workItemExternalRefs,
  workItemSavedViews,
  workItemStatuses,
  workItemThreadLinks,
  workItems,
} from "../../utils.js";
import { resolveCallerUserId } from "../core/resolve-auth-user.js";
import {
  canReadTenantSpaces,
  hasSpaceMemberAccess,
  userAccessibleSpacePredicate,
} from "../spaces/shared.js";

const WORK_ITEM_ENUM_FIELDS = new Set(["priority"]);
const STATUS_ENUM_FIELDS = new Set(["category"]);
const EVENT_ENUM_FIELDS = new Set(["actorType", "eventType"]);
const THREAD_LINK_ENUM_FIELDS = new Set(["relationship"]);
const SAVED_VIEW_ENUM_FIELDS = new Set(["viewType"]);

export function toGraphqlWorkItem(row: Record<string, unknown>) {
  const result = snakeToCamel(row);
  uppercaseFields(result, WORK_ITEM_ENUM_FIELDS);
  return result;
}

export function toGraphqlWorkItemStatus(row: Record<string, unknown>) {
  const result = snakeToCamel(row);
  uppercaseFields(result, STATUS_ENUM_FIELDS);
  return result;
}

export function toGraphqlWorkItemEvent(row: Record<string, unknown>) {
  const result = snakeToCamel(row);
  uppercaseFields(result, EVENT_ENUM_FIELDS);
  return result;
}

export function toGraphqlWorkItemThreadLink(row: Record<string, unknown>) {
  const result = snakeToCamel(row);
  uppercaseFields(result, THREAD_LINK_ENUM_FIELDS);
  return result;
}

export function toGraphqlWorkItemSavedView(row: Record<string, unknown>) {
  const result = snakeToCamel(row);
  uppercaseFields(result, SAVED_VIEW_ENUM_FIELDS);
  return result;
}

export function toGraphqlWorkItemExternalRef(row: Record<string, unknown>) {
  return snakeToCamel(row);
}

export function toGraphqlWorkItemConnection(result: {
  items: Record<string, unknown>[];
  pageInfo: { hasNextPage: boolean; endCursor: string | null };
}) {
  return {
    items: result.items.map(toGraphqlWorkItem),
    pageInfo: result.pageInfo,
  };
}

export async function buildWorkItemActor(ctx: GraphQLContext) {
  if (ctx.auth.authType === "cognito") {
    const userId = await resolveCallerUserId(ctx).catch(() => null);
    return { type: "user" as const, userId, agentId: null };
  }
  return { type: "service" as const, userId: null, agentId: null };
}

export async function requireCallerUserId(ctx: GraphQLContext) {
  const userId = await resolveCallerUserId(ctx).catch(() => null);
  if (!userId) {
    throw new GraphQLError("A signed-in user is required", {
      extensions: { code: "FORBIDDEN" },
    });
  }
  return userId;
}

export async function requireWorkItemAccess(
  ctx: GraphQLContext,
  tenantId: string,
  item: { space_id?: string; spaceId?: string },
) {
  const spaceId = item.space_id ?? item.spaceId;
  if (!spaceId || !(await hasSpaceMemberAccess(ctx, tenantId, spaceId))) {
    throw new GraphQLError("Not authorized to access this work item", {
      extensions: { code: "FORBIDDEN" },
    });
  }
}

export async function readableSpaceIdsForWorkItems(
  ctx: GraphQLContext,
  tenantId: string,
  requestedSpaceIds?: string[] | null,
) {
  if (!(await canReadTenantSpaces(ctx, tenantId))) {
    return [];
  }

  if (requestedSpaceIds?.length) {
    const allowed = [];
    for (const spaceId of requestedSpaceIds) {
      if (await hasSpaceMemberAccess(ctx, tenantId, spaceId)) {
        allowed.push(spaceId);
      }
    }
    return allowed;
  }

  if (ctx.auth.authType !== "cognito") {
    return null;
  }

  const callerUserId = await resolveCallerUserId(ctx).catch(() => null);
  if (!callerUserId) return [];
  const rows = await db
    .select({ id: spaces.id })
    .from(spaces)
    .where(
      and(
        eq(spaces.tenant_id, tenantId),
        eq(spaces.status, "active"),
        userAccessibleSpacePredicate(tenantId, callerUserId),
      ),
    );
  return rows.map((row) => row.id);
}

export function mapWorkItemError(error: unknown): never {
  if (error instanceof Error && "code" in error) {
    throw new GraphQLError(error.message, {
      extensions: { code: graphqlCodeForError(error) },
    });
  }
  throw error;
}

export const workItemTypeResolvers = {
  status: async (parent: any) => {
    const tenantId = parent.tenantId ?? parent.tenant_id;
    const statusId = parent.statusId ?? parent.status_id;
    const [status] = await db
      .select()
      .from(workItemStatuses)
      .where(
        and(
          eq(workItemStatuses.tenant_id, tenantId),
          eq(workItemStatuses.id, statusId),
        ),
      )
      .limit(1);
    return status ? toGraphqlWorkItemStatus(status) : null;
  },
  threadLinks: async (parent: any) => {
    const tenantId = parent.tenantId ?? parent.tenant_id;
    const workItemId = parent.id;
    const rows = await db
      .select()
      .from(workItemThreadLinks)
      .where(
        and(
          eq(workItemThreadLinks.tenant_id, tenantId),
          eq(workItemThreadLinks.work_item_id, workItemId),
        ),
      )
      .orderBy(asc(workItemThreadLinks.created_at));
    return rows.map(toGraphqlWorkItemThreadLink);
  },
  events: async (parent: any) => {
    const tenantId = parent.tenantId ?? parent.tenant_id;
    const workItemId = parent.id;
    const rows = await db
      .select()
      .from(workItemEvents)
      .where(
        and(
          eq(workItemEvents.tenant_id, tenantId),
          eq(workItemEvents.work_item_id, workItemId),
        ),
      )
      .orderBy(asc(workItemEvents.created_at));
    return rows.map(toGraphqlWorkItemEvent);
  },
  externalRefs: async (parent: any) => {
    const tenantId = parent.tenantId ?? parent.tenant_id;
    const workItemId = parent.id;
    const rows = await db
      .select()
      .from(workItemExternalRefs)
      .where(
        and(
          eq(workItemExternalRefs.tenant_id, tenantId),
          eq(workItemExternalRefs.work_item_id, workItemId),
        ),
      )
      .orderBy(asc(workItemExternalRefs.created_at));
    return rows.map(toGraphqlWorkItemExternalRef);
  },
};

export const workItemStatusTypeResolvers = {};
export const workItemSavedViewTypeResolvers = {};

export async function savedViewById(tenantId: string, id: string) {
  const [view] = await db
    .select()
    .from(workItemSavedViews)
    .where(
      and(
        eq(workItemSavedViews.tenant_id, tenantId),
        eq(workItemSavedViews.id, id),
      ),
    )
    .limit(1);
  return view ?? null;
}

export async function itemById(tenantId: string, id: string) {
  const [item] = await db
    .select()
    .from(workItems)
    .where(and(eq(workItems.tenant_id, tenantId), eq(workItems.id, id)))
    .limit(1);
  return item ?? null;
}

function uppercaseFields(
  row: Record<string, unknown>,
  fields: ReadonlySet<string>,
) {
  for (const field of fields) {
    if (typeof row[field] === "string") {
      row[field] = row[field].toUpperCase();
    }
  }
}

function graphqlCodeForError(error: Error & { code?: unknown }) {
  if (error.code === "NOT_FOUND" || error.code === "VIEW_NOT_FOUND") {
    return "NOT_FOUND";
  }
  if (
    error.code === "INVALID_STATUS" ||
    error.code === "INVALID_PRIORITY" ||
    error.code === "INVALID_JSON" ||
    error.code === "INVALID_VIEW_TYPE"
  ) {
    return "BAD_USER_INPUT";
  }
  return "BAD_USER_INPUT";
}
