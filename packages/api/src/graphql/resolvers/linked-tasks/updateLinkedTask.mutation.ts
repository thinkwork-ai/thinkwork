import { GraphQLError } from "graphql";

import type { GraphQLContext } from "../../context.js";
import { and, db, eq, linkedTaskEvents, linkedTasks } from "../../utils.js";
import {
  LINKED_TASK_STATUSES,
  type LinkedTaskStatus,
} from "../../../lib/linked-tasks/status.js";
import { refreshCustomerOnboardingGoalFolderSafely } from "../../../lib/spaces/customer-onboarding-goal-md.js";
import { resolveCallerUserId } from "../core/resolve-auth-user.js";
import { hasSpaceMemberAccess } from "../spaces/shared.js";
import { toGraphqlLinkedTask } from "./shared.js";

interface UpdateLinkedTaskArgs {
  input: {
    tenantId: string;
    threadId: string;
    linkedTaskId: string;
    status: string;
    note?: string | null;
    metadata?: unknown;
  };
}

export async function updateLinkedTask(
  _parent: any,
  args: UpdateLinkedTaskArgs,
  ctx: GraphQLContext,
) {
  const input = args.input;
  const nextStatus = parseLinkedTaskStatus(input.status);
  const now = new Date();

  const [task] = await db
    .select()
    .from(linkedTasks)
    .where(
      and(
        eq(linkedTasks.tenant_id, input.tenantId),
        eq(linkedTasks.thread_id, input.threadId),
        eq(linkedTasks.id, input.linkedTaskId),
      ),
    );

  if (!task) {
    throw new GraphQLError("Linked task not found", {
      extensions: { code: "NOT_FOUND" },
    });
  }

  if (task.provider !== "thinkwork") {
    throw new GraphQLError("Only ThinkWork checklist rows can be updated", {
      extensions: { code: "BAD_USER_INPUT" },
    });
  }

  if (!(await hasSpaceMemberAccess(ctx, input.tenantId, task.space_id))) {
    throw new GraphQLError("Not authorized to update this checklist item", {
      extensions: { code: "FORBIDDEN" },
    });
  }

  const callerUserId = await resolveCallerUserId(ctx).catch(() => null);
  const previousStatus = task.status as LinkedTaskStatus;
  const nextMetadata = mergeNativeChecklistMetadata(task.metadata, {
    note: cleanNote(input.note),
    metadata: parseAwsJson(input.metadata),
    updatedAt: now.toISOString(),
    updatedByUserId: callerUserId,
  });
  const [updated] = await db
    .update(linkedTasks)
    .set({
      status: nextStatus,
      blocked: nextStatus === "blocked",
      sync_status: "synced",
      last_synced_at: now,
      metadata: nextMetadata,
      updated_at: now,
    })
    .where(eq(linkedTasks.id, task.id))
    .returning();

  await db.insert(linkedTaskEvents).values({
    tenant_id: task.tenant_id,
    linked_task_id: task.id,
    space_id: task.space_id,
    thread_id: task.thread_id,
    provider: "thinkwork",
    event_type: eventTypeForStatus(nextStatus),
    previous_status: previousStatus,
    new_status: nextStatus,
    message: buildStatusChangeMessage(task.title, nextStatus, input.note),
    metadata: compactObject({
      note: cleanNote(input.note),
      updatedByUserId: callerUserId,
      manualMetadata: parseAwsJson(input.metadata),
    }),
    occurred_at: now,
  });

  await refreshCustomerOnboardingGoalFolderSafely({
    tenantId: task.tenant_id,
    threadId: task.thread_id,
  });

  return toGraphqlLinkedTask(updated);
}

function parseLinkedTaskStatus(value: string): LinkedTaskStatus {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
  if (LINKED_TASK_STATUSES.includes(normalized as LinkedTaskStatus)) {
    return normalized as LinkedTaskStatus;
  }
  throw new GraphQLError(`Unsupported linked task status: ${value}`, {
    extensions: { code: "BAD_USER_INPUT" },
  });
}

function eventTypeForStatus(status: LinkedTaskStatus) {
  if (status === "completed") return "completed";
  if (status === "blocked") return "blocked";
  return "status_changed";
}

function buildStatusChangeMessage(
  title: string,
  status: LinkedTaskStatus,
  note: string | null | undefined,
) {
  const label = status.replace(/_/g, " ");
  const suffix = cleanNote(note) ? ` Note: ${cleanNote(note)}` : "";
  return `${title} marked ${label}.${suffix}`;
}

function mergeNativeChecklistMetadata(
  current: unknown,
  update: {
    note: string | null;
    metadata: Record<string, unknown> | null | undefined;
    updatedAt: string;
    updatedByUserId: string | null;
  },
) {
  const base =
    current && typeof current === "object" && !Array.isArray(current)
      ? (current as Record<string, unknown>)
      : {};
  return compactObject({
    ...base,
    nativeChecklist: compactObject({
      ...objectValue(base.nativeChecklist),
      lastStatusNote: update.note,
      lastStatusMetadata: update.metadata,
      lastStatusUpdatedAt: update.updatedAt,
      lastStatusUpdatedByUserId: update.updatedByUserId,
    }),
  });
}

function parseAwsJson(
  value: unknown,
): Record<string, unknown> | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === "") return null;
  const parsed = typeof value === "string" ? JSON.parse(value) : value;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new GraphQLError("metadata must be a JSON object", {
      extensions: { code: "BAD_USER_INPUT" },
    });
  }
  return parsed as Record<string, unknown>;
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function compactObject(value: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(value).filter(([, child]) => child !== undefined),
  );
}

function cleanNote(value: string | null | undefined) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}
