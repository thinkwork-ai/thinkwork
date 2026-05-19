/**
 * Task-event webhook.
 *
 * LastMile Tasks remains the source of truth. This ingress updates the
 * ThinkWork linked-task mirror and records concise Thread milestones for
 * important events only.
 */

import type {
  APIGatewayProxyEventV2,
  APIGatewayProxyStructuredResultV2,
} from "aws-lambda";
import { createWebhookHandler, type WebhookResolveResult } from "./_shared.js";
import { syncLinkedTaskFromProviderEvent } from "../../lib/linked-tasks/sync-linked-task.js";

interface TaskEventPayload {
  event?: string;
  taskId?: string;
  externalTaskId?: string;
  id?: string;
  eventId?: string;
  externalEventId?: string;
  status?: unknown;
  state?: unknown;
  taskStatus?: unknown;
  blocked?: boolean;
  title?: string;
  url?: string;
  externalTaskUrl?: string;
  dueAt?: string;
  dueDate?: string;
  occurredAt?: string;
  assignee?: {
    id?: string | null;
    externalId?: string | null;
    userId?: string | null;
    name?: string | null;
    displayName?: string | null;
    email?: string | null;
  };
  task?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

const RELEVANT_EVENTS = new Set([
  "task.completed",
  "task.blocked",
  "task.reassigned",
  "task.assignee_changed",
  "task.due_date_changed",
  "task.updated",
  "task.status_changed",
]);

export async function resolveTaskEvent(args: {
  tenantId: string;
  rawBody: string;
}): Promise<WebhookResolveResult> {
  let payload: TaskEventPayload;
  try {
    payload = JSON.parse(args.rawBody) as TaskEventPayload;
  } catch {
    return { ok: false, status: 400, message: "invalid JSON body" };
  }

  if (!payload.event || !RELEVANT_EVENTS.has(payload.event)) {
    return {
      ok: true,
      skip: true,
      reason: `event ${payload.event ?? "<missing>"} is not a linked-task sync event`,
    };
  }

  const task = objectRecord(payload.task);
  const externalTaskId =
    stringValue(payload.externalTaskId) ??
    stringValue(payload.taskId) ??
    stringValue(payload.id) ??
    stringValue(task.externalTaskId) ??
    stringValue(task.taskId) ??
    stringValue(task.id);
  if (!externalTaskId) {
    return {
      ok: false,
      status: 400,
      message: "externalTaskId or taskId is required",
    };
  }

  const result = await syncLinkedTaskFromProviderEvent({
    tenantId: args.tenantId,
    externalTaskId,
    externalEventId:
      stringValue(payload.externalEventId) ??
      stringValue(payload.eventId) ??
      stringValue(payload.metadata?.eventId),
    eventName: payload.event,
    status:
      payload.status ?? payload.state ?? payload.taskStatus ?? task.status,
    blocked: payload.blocked,
    title: stringValue(payload.title) ?? stringValue(task.title),
    externalTaskUrl:
      stringValue(payload.externalTaskUrl) ??
      stringValue(payload.url) ??
      stringValue(task.externalTaskUrl) ??
      stringValue(task.url),
    assignee: normalizeAssignee(payload.assignee ?? task.assignee),
    dueAt:
      stringValue(payload.dueAt) ??
      stringValue(payload.dueDate) ??
      stringValue(task.dueAt) ??
      stringValue(task.dueDate),
    occurredAt: stringValue(payload.occurredAt),
    raw: payload,
  });

  if (result.skipped) {
    return {
      ok: true,
      skip: true,
      reason: result.reason,
    };
  }

  return {
    ok: true,
    handled: true,
    body: {
      linkedTaskId: result.linkedTask.id,
      threadId: result.linkedTask.threadId,
      status: result.linkedTask.status,
      syncStatus: result.linkedTask.syncStatus,
      eventType: result.eventType,
      milestonePosted: result.milestonePosted,
      allRequiredComplete: result.allRequiredComplete,
    },
  };
}

export const handler = createWebhookHandler({
  integration: "task-event",
  resolve: async (args) => resolveTaskEvent(args),
});

export type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 };

function normalizeAssignee(value: unknown) {
  const record = objectRecord(value);
  const externalId =
    stringValue(record.externalId) ??
    stringValue(record.id) ??
    stringValue(record.userId);
  const displayName =
    stringValue(record.displayName) ??
    stringValue(record.name) ??
    stringValue(record.email);
  if (!externalId && !displayName) return undefined;
  return { externalId, displayName };
}

function objectRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : {};
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
