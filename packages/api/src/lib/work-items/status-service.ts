import { GraphQLError } from "graphql";

import type { GraphQLContext } from "../../graphql/context.js";
import { and, asc, db, eq, workItemStatuses } from "../../graphql/utils.js";
import { requireWorkItemSpaceAccess, resolveWorkItemTenant } from "./auth.js";

export const DEFAULT_WORK_ITEM_STATUSES = [
  {
    name: "Todo",
    category: "todo",
    color: "#64748b",
    icon: "circle",
    display_order: 0,
    is_default: true,
    is_final: false,
  },
  {
    name: "In Progress",
    category: "active",
    color: "#2563eb",
    icon: "play-circle",
    display_order: 10,
    is_default: false,
    is_final: false,
  },
  {
    name: "Blocked",
    category: "blocked",
    color: "#dc2626",
    icon: "octagon-alert",
    display_order: 20,
    is_default: false,
    is_final: false,
  },
  {
    name: "Done",
    category: "done",
    color: "#16a34a",
    icon: "check-circle",
    display_order: 30,
    is_default: false,
    is_final: true,
  },
  {
    name: "Skipped",
    category: "skipped",
    color: "#a855f7",
    icon: "circle-slash",
    display_order: 40,
    is_default: false,
    is_final: true,
  },
] as const;

export type WorkItemStatusCategory =
  | "todo"
  | "active"
  | "blocked"
  | "done"
  | "skipped";

export function normalizeWorkItemStatusCategory(
  value: unknown,
): WorkItemStatusCategory {
  const normalized = normalizeEnum(value);
  if (
    normalized === "todo" ||
    normalized === "active" ||
    normalized === "blocked" ||
    normalized === "done" ||
    normalized === "skipped"
  ) {
    return normalized;
  }
  throw new GraphQLError(`Unsupported work item status category: ${value}`, {
    extensions: { code: "BAD_USER_INPUT" },
  });
}

export async function ensureDefaultWorkItemStatuses(input: {
  tenantId: string;
  spaceId: string;
  tx?: typeof db;
}) {
  const database = input.tx ?? db;
  const existing = await database
    .select()
    .from(workItemStatuses)
    .where(
      and(
        eq(workItemStatuses.tenant_id, input.tenantId),
        eq(workItemStatuses.space_id, input.spaceId),
      ),
    )
    .orderBy(asc(workItemStatuses.display_order));

  if (existing.length > 0) return existing;

  await database
    .insert(workItemStatuses)
    .values(
      DEFAULT_WORK_ITEM_STATUSES.map((status) => ({
        tenant_id: input.tenantId,
        space_id: input.spaceId,
        name: status.name,
        category: status.category,
        color: status.color,
        icon: status.icon,
        display_order: status.display_order,
        is_default: status.is_default,
        is_final: status.is_final,
      })),
    )
    .onConflictDoNothing();

  return database
    .select()
    .from(workItemStatuses)
    .where(
      and(
        eq(workItemStatuses.tenant_id, input.tenantId),
        eq(workItemStatuses.space_id, input.spaceId),
      ),
    )
    .orderBy(asc(workItemStatuses.display_order));
}

export async function findStatusForWorkItemUpdate(input: {
  tenantId: string;
  spaceId: string;
  statusId?: string | null;
  statusCategory?: unknown;
  tx?: typeof db;
}) {
  const database = input.tx ?? db;
  await ensureDefaultWorkItemStatuses({
    tenantId: input.tenantId,
    spaceId: input.spaceId,
    tx: database,
  });

  if (input.statusId) {
    const [status] = await database
      .select()
      .from(workItemStatuses)
      .where(
        and(
          eq(workItemStatuses.tenant_id, input.tenantId),
          eq(workItemStatuses.space_id, input.spaceId),
          eq(workItemStatuses.id, input.statusId),
        ),
      );
    if (status) return status;
    throw new GraphQLError("Work item status not found in this Space", {
      extensions: { code: "BAD_USER_INPUT" },
    });
  }

  if (input.statusCategory) {
    const category = normalizeWorkItemStatusCategory(input.statusCategory);
    const [status] = await database
      .select()
      .from(workItemStatuses)
      .where(
        and(
          eq(workItemStatuses.tenant_id, input.tenantId),
          eq(workItemStatuses.space_id, input.spaceId),
          eq(workItemStatuses.category, category),
          eq(workItemStatuses.is_active, true),
        ),
      )
      .orderBy(asc(workItemStatuses.display_order));
    if (status) return status;
  }

  const [defaultStatus] = await database
    .select()
    .from(workItemStatuses)
    .where(
      and(
        eq(workItemStatuses.tenant_id, input.tenantId),
        eq(workItemStatuses.space_id, input.spaceId),
        eq(workItemStatuses.is_default, true),
      ),
    );
  if (defaultStatus) return defaultStatus;

  const [firstStatus] = await database
    .select()
    .from(workItemStatuses)
    .where(
      and(
        eq(workItemStatuses.tenant_id, input.tenantId),
        eq(workItemStatuses.space_id, input.spaceId),
      ),
    )
    .orderBy(asc(workItemStatuses.display_order));
  if (firstStatus) return firstStatus;

  throw new GraphQLError("No active Work Item status exists for this Space", {
    extensions: { code: "BAD_USER_INPUT" },
  });
}

export async function listWorkItemStatuses(
  ctx: GraphQLContext,
  input: { tenantId?: string | null; spaceId: string },
) {
  const tenantId = await resolveWorkItemTenant(ctx, input.tenantId);
  await requireWorkItemSpaceAccess(ctx, tenantId, input.spaceId);
  await ensureDefaultWorkItemStatuses({ tenantId, spaceId: input.spaceId });
  return db
    .select()
    .from(workItemStatuses)
    .where(
      and(
        eq(workItemStatuses.tenant_id, tenantId),
        eq(workItemStatuses.space_id, input.spaceId),
      ),
    )
    .orderBy(asc(workItemStatuses.display_order));
}

export async function saveWorkItemStatuses(
  ctx: GraphQLContext,
  input: {
    tenantId?: string | null;
    spaceId: string;
    statuses: Array<Record<string, any>>;
  },
) {
  const tenantId = await resolveWorkItemTenant(ctx, input.tenantId);
  await requireWorkItemSpaceAccess(ctx, tenantId, input.spaceId);
  if (input.statuses.filter((status) => status.isDefault === true).length > 1) {
    throw new GraphQLError("Only one default Work Item status is allowed", {
      extensions: { code: "BAD_USER_INPUT" },
    });
  }

  return db.transaction(async (tx) => {
    if (input.statuses.some((status) => status.isDefault === true)) {
      await tx
        .update(workItemStatuses)
        .set({ is_default: false, updated_at: new Date() })
        .where(
          and(
            eq(workItemStatuses.tenant_id, tenantId),
            eq(workItemStatuses.space_id, input.spaceId),
          ),
        );
    }

    for (const status of input.statuses) {
      const values = {
        name: requireStatusName(status.name),
        description: nullableString(status.description),
        color: nullableString(status.color),
        icon: nullableString(status.icon),
        category: normalizeWorkItemStatusCategory(status.category),
        is_active: status.isActive ?? true,
        is_final: status.isFinal ?? false,
        is_default: status.isDefault ?? false,
        display_order: status.displayOrder ?? 0,
        updated_at: new Date(),
      };

      if (status.id) {
        await tx
          .update(workItemStatuses)
          .set(values)
          .where(
            and(
              eq(workItemStatuses.tenant_id, tenantId),
              eq(workItemStatuses.space_id, input.spaceId),
              eq(workItemStatuses.id, status.id),
            ),
          );
      } else {
        await tx.insert(workItemStatuses).values({
          ...values,
          tenant_id: tenantId,
          space_id: input.spaceId,
        });
      }
    }

    return tx
      .select()
      .from(workItemStatuses)
      .where(
        and(
          eq(workItemStatuses.tenant_id, tenantId),
          eq(workItemStatuses.space_id, input.spaceId),
        ),
      )
      .orderBy(asc(workItemStatuses.display_order));
  });
}

function normalizeEnum(value: unknown) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
}

function requireStatusName(value: unknown) {
  const trimmed = nullableString(value);
  if (!trimmed) {
    throw new GraphQLError("Work Item status name is required", {
      extensions: { code: "BAD_USER_INPUT" },
    });
  }
  return trimmed;
}

function nullableString(value: unknown) {
  if (value === undefined || value === null) return null;
  const trimmed = String(value).trim();
  return trimmed ? trimmed : null;
}
