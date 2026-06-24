import { and, asc, eq, isNull, or } from "drizzle-orm";
import { schema } from "@thinkwork/database-pg";

import { db as defaultDb } from "../db.js";
import { parseAwsJson } from "./work-item-service.js";

const { workItemSavedViews } = schema;

export interface SaveWorkItemViewInput {
  id?: string | null;
  tenantId: string;
  userId: string;
  spaceId?: string | null;
  name: string;
  viewType: string;
  filters?: unknown;
  grouping?: unknown;
  sorting?: unknown;
  viewConfig?: unknown;
  isPrivate?: boolean | null;
  isDefault?: boolean | null;
  isFavorite?: boolean | null;
}

export interface SavedViewServiceDeps {
  db?: typeof defaultDb | any;
  now?: () => Date;
}

export class WorkItemSavedViewError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
    public readonly code: string,
  ) {
    super(message);
    this.name = "WorkItemSavedViewError";
  }
}

export async function listWorkItemSavedViews(
  input: { tenantId: string; userId: string; spaceId?: string | null },
  deps: SavedViewServiceDeps = {},
) {
  const database = deps.db ?? defaultDb;
  const scopeCondition =
    input.spaceId === undefined
      ? undefined
      : input.spaceId
        ? eq(workItemSavedViews.space_id, input.spaceId)
        : isNull(workItemSavedViews.space_id);
  const conditions = [
    eq(workItemSavedViews.tenant_id, input.tenantId),
    or(
      eq(workItemSavedViews.user_id, input.userId),
      eq(workItemSavedViews.is_private, false),
    ),
    scopeCondition,
  ].filter(Boolean) as any[];

  return database
    .select()
    .from(workItemSavedViews)
    .where(and(...conditions))
    .orderBy(
      asc(workItemSavedViews.is_private),
      asc(workItemSavedViews.name),
      asc(workItemSavedViews.created_at),
    );
}

export async function saveWorkItemView(
  input: SaveWorkItemViewInput,
  deps: SavedViewServiceDeps = {},
) {
  const database = deps.db ?? defaultDb;
  const now = deps.now?.() ?? new Date();
  const viewType = parseViewType(input.viewType);
  const spaceId = input.spaceId ?? null;
  const isDefault = Boolean(input.isDefault);

  return database.transaction(async (tx: any) => {
    if (isDefault) {
      await tx
        .update(workItemSavedViews)
        .set({ is_default: false, updated_at: now })
        .where(
          and(
            eq(workItemSavedViews.tenant_id, input.tenantId),
            eq(workItemSavedViews.user_id, input.userId),
            spaceId
              ? eq(workItemSavedViews.space_id, spaceId)
              : isNull(workItemSavedViews.space_id),
          ),
        );
    }

    if (input.id) {
      const [updated] = await tx
        .update(workItemSavedViews)
        .set({
          name: cleanName(input.name),
          view_type: viewType,
          filters: parseAwsJson(input.filters) ?? {},
          grouping: parseAwsJson(input.grouping) ?? {},
          sorting: parseAwsJson(input.sorting) ?? {},
          view_config: parseAwsJson(input.viewConfig) ?? {},
          is_private: input.isPrivate ?? true,
          is_default: isDefault,
          is_favorite: input.isFavorite ?? false,
          updated_at: now,
        })
        .where(
          and(
            eq(workItemSavedViews.tenant_id, input.tenantId),
            eq(workItemSavedViews.id, input.id),
            eq(workItemSavedViews.user_id, input.userId),
          ),
        )
        .returning();
      if (!updated) {
        throw new WorkItemSavedViewError(
          "Saved view not found",
          404,
          "VIEW_NOT_FOUND",
        );
      }
      return updated;
    }

    const [created] = await tx
      .insert(workItemSavedViews)
      .values({
        tenant_id: input.tenantId,
        user_id: input.userId,
        space_id: spaceId,
        name: cleanName(input.name),
        view_type: viewType,
        filters: parseAwsJson(input.filters) ?? {},
        grouping: parseAwsJson(input.grouping) ?? {},
        sorting: parseAwsJson(input.sorting) ?? {},
        view_config: parseAwsJson(input.viewConfig) ?? {},
        is_private: input.isPrivate ?? true,
        is_default: isDefault,
        is_favorite: input.isFavorite ?? false,
        created_at: now,
        updated_at: now,
      })
      .returning();
    return created;
  });
}

export async function deleteWorkItemView(
  input: { tenantId: string; id: string; userId: string },
  deps: SavedViewServiceDeps = {},
) {
  const database = deps.db ?? defaultDb;
  const deleted = await database
    .delete(workItemSavedViews)
    .where(
      and(
        eq(workItemSavedViews.tenant_id, input.tenantId),
        eq(workItemSavedViews.id, input.id),
        eq(workItemSavedViews.user_id, input.userId),
      ),
    )
    .returning({ id: workItemSavedViews.id });
  return deleted.length > 0;
}

function parseViewType(value: string) {
  const normalized = value.trim().toLowerCase();
  if (normalized === "list" || normalized === "board") return normalized;
  throw new WorkItemSavedViewError(
    `Unsupported work item view type: ${value}`,
    400,
    "INVALID_VIEW_TYPE",
  );
}

function cleanName(value: string) {
  const cleaned = value.trim();
  if (!cleaned) {
    throw new WorkItemSavedViewError(
      "Saved view name is required",
      400,
      "REQUIRED_FIELD",
    );
  }
  return cleaned;
}
