import { and, asc, eq } from "drizzle-orm";
import { schema } from "@thinkwork/database-pg";

import { db as defaultDb } from "../db.js";

const { workItemStatuses } = schema;

export const WORK_ITEM_STATUS_CATEGORIES = [
  "todo",
  "active",
  "blocked",
  "done",
  "skipped",
] as const;

export type WorkItemStatusCategory =
  (typeof WORK_ITEM_STATUS_CATEGORIES)[number];

export const DEFAULT_WORK_ITEM_STATUSES: Array<{
  name: string;
  category: WorkItemStatusCategory;
  color: string;
  icon: string;
  isFinal?: boolean;
  isDefault?: boolean;
}> = [
  {
    name: "Todo",
    category: "todo",
    color: "#6b7280",
    icon: "circle",
    isDefault: true,
  },
  {
    name: "In Progress",
    category: "active",
    color: "#2563eb",
    icon: "loader-circle",
  },
  {
    name: "Blocked",
    category: "blocked",
    color: "#dc2626",
    icon: "octagon-alert",
  },
  {
    name: "Done",
    category: "done",
    color: "#16a34a",
    icon: "circle-check",
    isFinal: true,
  },
  {
    name: "Skipped",
    category: "skipped",
    color: "#9333ea",
    icon: "circle-slash",
    isFinal: true,
  },
];

export interface WorkItemStatusInput {
  id?: string | null;
  tenantId: string;
  spaceId: string;
  name: string;
  description?: string | null;
  color?: string | null;
  icon?: string | null;
  category: string;
  isActive?: boolean | null;
  isFinal?: boolean | null;
  isDefault?: boolean | null;
  displayOrder?: number | null;
}

export interface WorkItemStatusServiceDeps {
  db?: typeof defaultDb | any;
  now?: () => Date;
}

export class WorkItemStatusError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
    public readonly code: string,
  ) {
    super(message);
    this.name = "WorkItemStatusError";
  }
}

export async function ensureDefaultWorkItemStatuses(
  input: { tenantId: string; spaceId: string },
  deps: WorkItemStatusServiceDeps = {},
) {
  const database = deps.db ?? defaultDb;
  const existing = await listWorkItemStatuses(input, deps);
  if (existing.length > 0) return existing;

  const now = deps.now?.() ?? new Date();
  await database
    .insert(workItemStatuses)
    .values(
      DEFAULT_WORK_ITEM_STATUSES.map((status, index) => ({
        tenant_id: input.tenantId,
        space_id: input.spaceId,
        name: status.name,
        color: status.color,
        icon: status.icon,
        category: status.category,
        is_active: true,
        is_final: Boolean(status.isFinal),
        is_default: Boolean(status.isDefault),
        display_order: index,
        created_at: now,
        updated_at: now,
      })),
    )
    .onConflictDoNothing();

  return listWorkItemStatuses(input, deps);
}

export async function listWorkItemStatuses(
  input: { tenantId: string; spaceId: string },
  deps: WorkItemStatusServiceDeps = {},
) {
  const database = deps.db ?? defaultDb;
  return database
    .select()
    .from(workItemStatuses)
    .where(
      and(
        eq(workItemStatuses.tenant_id, input.tenantId),
        eq(workItemStatuses.space_id, input.spaceId),
      ),
    )
    .orderBy(asc(workItemStatuses.display_order), asc(workItemStatuses.name));
}

export async function findWorkItemStatus(
  input: { tenantId: string; spaceId: string; statusId: string },
  deps: WorkItemStatusServiceDeps = {},
) {
  const database = deps.db ?? defaultDb;
  const [status] = await database
    .select()
    .from(workItemStatuses)
    .where(
      and(
        eq(workItemStatuses.tenant_id, input.tenantId),
        eq(workItemStatuses.space_id, input.spaceId),
        eq(workItemStatuses.id, input.statusId),
      ),
    )
    .limit(1);
  return status ?? null;
}

export async function findStatusForCategory(
  input: {
    tenantId: string;
    spaceId: string;
    category: WorkItemStatusCategory;
  },
  deps: WorkItemStatusServiceDeps = {},
) {
  const statuses = await ensureDefaultWorkItemStatuses(input, deps);
  return (
    statuses.find(
      (status: any) => status.category === input.category && status.is_default,
    ) ??
    statuses.find((status: any) => status.category === input.category) ??
    null
  );
}

export async function saveWorkItemStatuses(
  input: {
    tenantId: string;
    spaceId: string;
    statuses: WorkItemStatusInput[];
  },
  deps: WorkItemStatusServiceDeps = {},
) {
  const database = deps.db ?? defaultDb;
  const now = deps.now?.() ?? new Date();

  if (input.statuses.length === 0) {
    throw new WorkItemStatusError(
      "At least one status is required",
      400,
      "EMPTY_STATUSES",
    );
  }

  await database.transaction(async (tx: any) => {
    for (const statusInput of input.statuses) {
      assertSameScope(input, statusInput);
      const category = parseWorkItemStatusCategory(statusInput.category);
      const isDefault = Boolean(statusInput.isDefault);
      if (isDefault) {
        await tx
          .update(workItemStatuses)
          .set({ is_default: false, updated_at: now })
          .where(
            and(
              eq(workItemStatuses.tenant_id, input.tenantId),
              eq(workItemStatuses.space_id, input.spaceId),
              eq(workItemStatuses.category, category),
            ),
          );
      }

      if (statusInput.id) {
        const [updated] = await tx
          .update(workItemStatuses)
          .set({
            name: cleanRequired(statusInput.name, "Status name"),
            description: cleanOptional(statusInput.description),
            color: cleanOptional(statusInput.color),
            icon: cleanOptional(statusInput.icon),
            category,
            is_active: statusInput.isActive ?? true,
            is_final: statusInput.isFinal ?? false,
            is_default: isDefault,
            display_order: statusInput.displayOrder ?? 0,
            updated_at: now,
          })
          .where(
            and(
              eq(workItemStatuses.tenant_id, input.tenantId),
              eq(workItemStatuses.space_id, input.spaceId),
              eq(workItemStatuses.id, statusInput.id),
            ),
          )
          .returning({ id: workItemStatuses.id });
        if (!updated) {
          throw new WorkItemStatusError(
            "Work item status not found",
            404,
            "STATUS_NOT_FOUND",
          );
        }
      } else {
        await tx.insert(workItemStatuses).values({
          tenant_id: input.tenantId,
          space_id: input.spaceId,
          name: cleanRequired(statusInput.name, "Status name"),
          description: cleanOptional(statusInput.description),
          color: cleanOptional(statusInput.color),
          icon: cleanOptional(statusInput.icon),
          category,
          is_active: statusInput.isActive ?? true,
          is_final: statusInput.isFinal ?? false,
          is_default: isDefault,
          display_order: statusInput.displayOrder ?? 0,
          created_at: now,
          updated_at: now,
        });
      }
    }
  });

  return listWorkItemStatuses(input, deps);
}

export function parseWorkItemStatusCategory(
  value: string,
): WorkItemStatusCategory {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
  if (
    WORK_ITEM_STATUS_CATEGORIES.includes(normalized as WorkItemStatusCategory)
  ) {
    return normalized as WorkItemStatusCategory;
  }
  throw new WorkItemStatusError(
    `Unsupported work item status category: ${value}`,
    400,
    "INVALID_STATUS_CATEGORY",
  );
}

function assertSameScope(
  expected: { tenantId: string; spaceId: string },
  actual: { tenantId: string; spaceId: string },
) {
  if (
    actual.tenantId !== expected.tenantId ||
    actual.spaceId !== expected.spaceId
  ) {
    throw new WorkItemStatusError(
      "Status scope must match the mutation scope",
      400,
      "STATUS_SCOPE_MISMATCH",
    );
  }
}

function cleanRequired(value: string, label: string) {
  const cleaned = value.trim();
  if (!cleaned) {
    throw new WorkItemStatusError(
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
