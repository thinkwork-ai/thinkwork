/**
 * Task-event webhook.
 *
 * External task systems remain the source of truth. This ingress updates the
 * ThinkWork linked-task mirror and records concise Thread milestones for
 * important task status/comment events.
 */

import type {
  APIGatewayProxyEventV2,
  APIGatewayProxyStructuredResultV2,
} from "aws-lambda";
import { createWebhookHandler, type WebhookResolveResult } from "./_shared.js";
import { syncLinkedTaskFromProviderEvent } from "../../lib/linked-tasks/sync-linked-task.js";

interface TaskEventPayload {
  schema?: string;
  provider?: string;
  event?: string;
  eventType?: string;
  kind?: string;
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
  actor?: {
    id?: string | null;
    name?: string | null;
    displayName?: string | null;
    email?: string | null;
  };
  assignee?: {
    id?: string | null;
    externalId?: string | null;
    userId?: string | null;
    name?: string | null;
    displayName?: string | null;
    email?: string | null;
  };
  comment?: {
    id?: string | null;
    body?: string | null;
    text?: string | null;
    content?: string | null;
    authorId?: string | null;
    authorName?: string | null;
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
  "task.comment_added",
]);

const PROVIDERS = new Set(["lastmile", "twenty"]);

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

  const provider = normalizeProvider(payload.provider);
  if (!provider) {
    return {
      ok: false,
      status: 400,
      message: "provider must be lastmile or twenty",
      delivery: { providerName: stringValue(payload.provider) ?? undefined },
    };
  }

  const eventName =
    stringValue(payload.event) ??
    stringValue(payload.eventType) ??
    stringValue(payload.kind);
  if (!eventName || !RELEVANT_EVENTS.has(eventName)) {
    return {
      ok: true,
      skip: true,
      reason: `event ${eventName ?? "<missing>"} is not a linked-task sync event`,
      delivery: {
        providerName: provider,
        normalizedKind: eventName ?? undefined,
      },
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
      delivery: {
        providerName: provider,
        normalizedKind: eventName,
      },
    };
  }
  const externalEventId =
    stringValue(payload.externalEventId) ??
    stringValue(payload.eventId) ??
    stringValue(payload.metadata?.eventId);
  if (!externalEventId) {
    return {
      ok: false,
      status: 400,
      message: "eventId or externalEventId is required",
      delivery: {
        providerName: provider,
        externalTaskId,
        normalizedKind: eventName,
      },
    };
  }

  const result = await syncLinkedTaskFromProviderEvent({
    tenantId: args.tenantId,
    provider,
    externalTaskId,
    externalEventId,
    eventName,
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
    comment: normalizeComment(payload.comment, payload.actor),
    dueAt:
      stringValue(payload.dueAt) ??
      stringValue(payload.dueDate) ??
      stringValue(task.dueAt) ??
      stringValue(task.dueDate),
    occurredAt: stringValue(payload.occurredAt),
  });

  if (result.skipped) {
    return {
      ok: true,
      skip: true,
      reason: result.reason,
      delivery: {
        providerName: provider,
        providerEventId: externalEventId,
        externalTaskId,
        normalizedKind: eventName,
      },
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
    delivery: {
      providerName: provider,
      providerEventId: externalEventId,
      externalTaskId,
      normalizedKind: eventName,
      threadId: result.linkedTask.threadId,
    },
  };
}

export const handler = createWebhookHandler({
  integration: "task-event",
  requireTimestampFreshness: true,
  recordDeliveries: true,
  resolve: async (args) => resolveTaskEvent(args),
});

export type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 };

function normalizeProvider(value: unknown): "lastmile" | "twenty" | null {
  const provider = stringValue(value)?.toLowerCase() ?? "lastmile";
  return PROVIDERS.has(provider) ? (provider as "lastmile" | "twenty") : null;
}

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

function normalizeComment(commentValue: unknown, actorValue: unknown) {
  const comment = objectRecord(commentValue);
  const actor = objectRecord(actorValue);
  const body =
    stringValue(comment.body) ??
    stringValue(comment.text) ??
    stringValue(comment.content);
  const authorName =
    stringValue(comment.authorName) ??
    stringValue(actor.displayName) ??
    stringValue(actor.name) ??
    stringValue(actor.email);
  const authorId = stringValue(comment.authorId) ?? stringValue(actor.id);
  const id = stringValue(comment.id);
  if (!body && !authorName && !authorId && !id) return undefined;
  return { id, body, authorName, authorId };
}

function objectRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : {};
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
