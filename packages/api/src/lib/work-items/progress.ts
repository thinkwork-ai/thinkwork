import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { getDb } from "@thinkwork/database-pg";
import {
  workItems,
  workItemStatuses,
  workItemThreadLinks,
} from "@thinkwork/database-pg/schema";

import type { CustomerOnboardingProgressTask } from "../spaces/customer-onboarding-progress-md.js";

type JsonRecord = Record<string, unknown>;

export async function loadCustomerOnboardingWorkItemProgressTasks(input: {
  tenantId: string;
  threadId: string;
}): Promise<CustomerOnboardingProgressTask[]> {
  const db = getDb();
  const rows = await db
    .select({
      title: workItems.title,
      required: workItems.required,
      applicable: workItems.applicable,
      blocked: workItems.blocked,
      metadata: workItems.metadata,
      updatedAt: workItems.updated_at,
      statusCategory: workItemStatuses.category,
    })
    .from(workItems)
    .innerJoin(
      workItemThreadLinks,
      and(
        eq(workItemThreadLinks.work_item_id, workItems.id),
        eq(workItemThreadLinks.tenant_id, workItems.tenant_id),
      ),
    )
    .innerJoin(
      workItemStatuses,
      and(
        eq(workItemStatuses.id, workItems.status_id),
        eq(workItemStatuses.tenant_id, workItems.tenant_id),
      ),
    )
    .where(
      and(
        eq(workItems.tenant_id, input.tenantId),
        eq(workItemThreadLinks.thread_id, input.threadId),
        isNull(workItems.archived_at),
        sql`${workItems.metadata}->>'workflow' = ${"customer_onboarding"}`,
      ),
    )
    .orderBy(asc(workItems.created_at));

  return rows.map((row) => {
    const metadata = objectRecord(row.metadata);
    const nativeChecklist = objectRecord(metadata.nativeChecklist);
    return {
      title: row.title,
      status: linkedTaskStatusForWorkItemProgress(
        row.statusCategory,
        row.applicable,
      ),
      required: row.required,
      blocked: row.blocked,
      owner:
        stringValue(objectRecord(metadata.assignee).displayName) ??
        stringValue(metadata.assigneeDisplay),
      roleKey:
        stringValue(metadata.roleKey) ?? stringValue(metadata.checklistRoleKey),
      checklistItemKey: stringValue(metadata.checklistItemKey),
      notes:
        stringValue(nativeChecklist.lastStatusNote) ??
        stringValue(metadata.note) ??
        null,
      updatedAt: row.updatedAt ?? null,
    };
  });
}

export function linkedTaskStatusForWorkItemProgress(
  category: unknown,
  applicable: boolean | null,
) {
  if (applicable === false) return "not_applicable";
  switch (String(category ?? "").toLowerCase()) {
    case "done":
      return "completed";
    case "blocked":
      return "blocked";
    case "active":
      return "in_progress";
    case "skipped":
      return "not_applicable";
    case "todo":
    default:
      return "todo";
  }
}

function objectRecord(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : {};
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null;
}
