import { GraphQLError } from "graphql";

import type { GraphQLContext } from "../../graphql/context.js";
import {
  and,
  asc,
  db,
  eq,
  isNull,
  or,
  workItemSavedViews,
} from "../../graphql/utils.js";
import { resolveCallerUserId } from "../../graphql/resolvers/core/resolve-auth-user.js";
import { parseAwsJsonObject } from "./work-item-service.js";
import { requireWorkItemSpaceAccess, resolveWorkItemTenant } from "./auth.js";

export async function listWorkItemSavedViews(
  ctx: GraphQLContext,
  input: { tenantId?: string | null; spaceId?: string | null },
) {
  const tenantId = await resolveWorkItemTenant(ctx, input.tenantId);
  if (input.spaceId) {
    await requireWorkItemSpaceAccess(ctx, tenantId, input.spaceId);
  }
  const callerUserId = await resolveCallerUserId(ctx).catch(() => null);
  if (!callerUserId && ctx.auth.authType === "cognito") return [];

  const conditions: any[] = [
    eq(workItemSavedViews.tenant_id, tenantId),
    or(
      eq(workItemSavedViews.is_private, false),
      callerUserId
        ? eq(workItemSavedViews.user_id, callerUserId)
        : isNull(workItemSavedViews.user_id),
    ),
  ];
  if (input.spaceId) {
    conditions.push(
      or(
        eq(workItemSavedViews.space_id, input.spaceId),
        isNull(workItemSavedViews.space_id),
      ),
    );
  }
  return db
    .select()
    .from(workItemSavedViews)
    .where(and(...conditions))
    .orderBy(asc(workItemSavedViews.name));
}

export async function saveWorkItemView(
  ctx: GraphQLContext,
  input: Record<string, any>,
) {
  const tenantId = await resolveWorkItemTenant(ctx, input.tenantId);
  if (input.spaceId) {
    await requireWorkItemSpaceAccess(ctx, tenantId, input.spaceId);
  }
  const callerUserId = await resolveCallerUserId(ctx).catch(() => null);
  if (!callerUserId && input.isPrivate !== false) {
    throw new GraphQLError("Personal saved views require a user", {
      extensions: { code: "FORBIDDEN" },
    });
  }

  const values = {
    tenant_id: tenantId,
    user_id: callerUserId,
    space_id: input.spaceId ?? null,
    name: requireName(input.name),
    view_type: normalizeViewType(input.viewType),
    filters: parseAwsJsonObject(input.filters),
    grouping: parseAwsJsonObject(input.grouping),
    sorting: parseAwsJsonObject(input.sorting),
    view_config: parseAwsJsonObject(input.viewConfig),
    is_private: input.isPrivate ?? true,
    is_default: input.isDefault ?? false,
    is_favorite: input.isFavorite ?? false,
    updated_at: new Date(),
  };

  return db.transaction(async (tx) => {
    if (values.is_default && callerUserId) {
      await tx
        .update(workItemSavedViews)
        .set({ is_default: false, updated_at: new Date() })
        .where(
          and(
            eq(workItemSavedViews.tenant_id, tenantId),
            eq(workItemSavedViews.user_id, callerUserId),
          ),
        );
    }

    if (input.id) {
      const [updated] = await tx
        .update(workItemSavedViews)
        .set(values)
        .where(
          and(
            eq(workItemSavedViews.tenant_id, tenantId),
            eq(workItemSavedViews.id, input.id),
            callerUserId
              ? eq(workItemSavedViews.user_id, callerUserId)
              : isNull(workItemSavedViews.user_id),
          ),
        )
        .returning();
      if (!updated) {
        throw new GraphQLError("Work Item saved view not found", {
          extensions: { code: "NOT_FOUND" },
        });
      }
      return updated;
    }

    const [created] = await tx
      .insert(workItemSavedViews)
      .values(values)
      .returning();
    return created;
  });
}

export async function deleteWorkItemView(
  ctx: GraphQLContext,
  input: { tenantId?: string | null; id: string },
) {
  const tenantId = await resolveWorkItemTenant(ctx, input.tenantId);
  const callerUserId = await resolveCallerUserId(ctx).catch(() => null);
  const [deleted] = await db
    .delete(workItemSavedViews)
    .where(
      and(
        eq(workItemSavedViews.tenant_id, tenantId),
        eq(workItemSavedViews.id, input.id),
        callerUserId
          ? eq(workItemSavedViews.user_id, callerUserId)
          : isNull(workItemSavedViews.user_id),
      ),
    )
    .returning({ id: workItemSavedViews.id });
  return Boolean(deleted);
}

function normalizeViewType(value: unknown) {
  const normalized = String(value ?? "list").toLowerCase();
  if (normalized === "list" || normalized === "board") return normalized;
  throw new GraphQLError(`Unsupported Work Item view type: ${value}`, {
    extensions: { code: "BAD_USER_INPUT" },
  });
}

function requireName(value: unknown) {
  const trimmed = String(value ?? "").trim();
  if (!trimmed) {
    throw new GraphQLError("Saved view name is required", {
      extensions: { code: "BAD_USER_INPUT" },
    });
  }
  return trimmed;
}
