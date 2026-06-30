import {
  workItemPriorityLabel,
  type WorkItemAssigneeSummary,
  type WorkItemEventSummary,
  type WorkItemStatusSummary,
  type WorkItemSummary,
} from "./work-item-display";

export type WorkItemActivityIconKey =
  | "agent"
  | "applicability"
  | "assigned"
  | "blocked"
  | "completed"
  | "created"
  | "document"
  | "due_date"
  | "labels"
  | "linked"
  | "priority"
  | "status"
  | "unblocked"
  | "updated";

export type WorkItemActivityTone =
  | "blue"
  | "emerald"
  | "red"
  | "amber"
  | "violet"
  | "slate";

export interface WorkItemActivityDescriptor {
  actorLabel: string;
  actionText: string;
  iconKey: WorkItemActivityIconKey;
  tone: WorkItemActivityTone;
  displayMode: "compact" | "card";
  statusIcon?: string | null;
  statusColor?: string | null;
  statusCategory?: string | null;
}

interface DescribeWorkItemActivityInput {
  event: WorkItemEventSummary;
  item: WorkItemSummary;
  assignees: WorkItemAssigneeSummary[];
  statuses: WorkItemStatusSummary[];
}

const TIMELINE_EVENT_TYPES = new Set([
  "created",
  "updated",
  "status_changed",
  "completed",
  "blocked",
  "unblocked",
  "assigned",
  "due_date_changed",
  "applicability_changed",
  "linked_thread",
  "agent_action",
]);

export function isWorkItemActivityTimelineEvent(event: WorkItemEventSummary) {
  return TIMELINE_EVENT_TYPES.has(normalizeEventType(event.eventType));
}

export function describeWorkItemActivity({
  event,
  item,
  assignees,
  statuses,
}: DescribeWorkItemActivityInput): WorkItemActivityDescriptor {
  const metadata = objectRecord(event.metadata);
  const action = stringValue(metadata.action);
  const eventType = normalizeEventType(event.eventType);
  const actorLabel = eventActor(event, assignees, metadata);

  if (!isWorkItemActivityTimelineEvent(event)) {
    return {
      actorLabel,
      actionText: eventLabel(event.eventType),
      iconKey: "updated",
      tone: "slate",
      displayMode: "card",
    };
  }

  if (eventType === "created") {
    return compact(actorLabel, "created this Work Item", "created", "emerald");
  }

  if (
    eventType === "status_changed" ||
    eventType === "completed" ||
    eventType === "blocked" ||
    eventType === "unblocked"
  ) {
    return describeStatusEvent({
      actorLabel,
      event,
      item,
      statuses,
      metadata,
      eventType,
    });
  }

  if (metadata.source === "open_engine_route") {
    return compact(
      actorLabel,
      agentActionText(event, metadata),
      "agent",
      "blue",
    );
  }

  if (eventType === "assigned") {
    return compact(
      actorLabel,
      assignmentText(event, item, assignees, metadata),
      "assigned",
      "violet",
    );
  }

  if (eventType === "due_date_changed") {
    return compact(actorLabel, dueDateText(metadata), "due_date", "amber");
  }

  if (eventType === "applicability_changed") {
    return compact(
      actorLabel,
      applicabilityText(metadata),
      "applicability",
      "slate",
    );
  }

  if (eventType === "linked_thread") {
    return compact(actorLabel, linkedThreadText(metadata), "linked", "blue");
  }

  if (eventType === "agent_action") {
    return compact(
      actorLabel,
      agentActionText(event, metadata),
      "agent",
      eventTypeToneFromMessage(event.message),
    );
  }

  if (action?.startsWith("document_")) {
    return compact(
      actorLabel,
      documentActionText(event, metadata),
      "document",
      "blue",
    );
  }

  const primaryChange = primaryFieldChange(metadata);
  if (primaryChange) {
    return compact(
      actorLabel,
      fieldChangeText(primaryChange, metadata, item, assignees),
      iconKeyForField(primaryChange.field),
      toneForField(primaryChange.field, primaryChange.newValue),
    );
  }

  return compact(
    actorLabel,
    fallbackActivityText(event, item),
    "updated",
    "slate",
  );
}

function compact(
  actorLabel: string,
  actionText: string,
  iconKey: WorkItemActivityIconKey,
  tone: WorkItemActivityTone,
): WorkItemActivityDescriptor {
  return { actorLabel, actionText, iconKey, tone, displayMode: "compact" };
}

function describeStatusEvent({
  actorLabel,
  event,
  item,
  statuses,
  metadata,
  eventType,
}: {
  actorLabel: string;
  event: WorkItemEventSummary;
  item: WorkItemSummary;
  statuses: WorkItemStatusSummary[];
  metadata: Record<string, unknown>;
  eventType: string;
}) {
  const previous =
    statusLabel(event.previousStatusId, statuses) ??
    stringValue(metadata.previousStatusName);
  const nextStatus = event.newStatusId
    ? statuses.find((status) => status.id === event.newStatusId)
    : null;
  const next =
    nextStatus?.name ??
    stringValue(metadata.newStatusName) ??
    item.status?.name ??
    item.status?.category ??
    null;
  const actionText =
    previous && next
      ? `moved from ${previous} to ${next}`
      : next
        ? `moved to ${next}`
        : fallbackActivityText(event, item);
  const iconKey =
    eventType === "completed"
      ? "completed"
      : eventType === "blocked"
        ? "blocked"
        : eventType === "unblocked"
          ? "unblocked"
          : "status";
  return {
    ...compact(actorLabel, actionText, iconKey, toneForStatus(eventType)),
    statusIcon: nextStatus?.icon ?? null,
    statusColor: nextStatus?.color ?? null,
    statusCategory: nextStatus?.category ?? null,
  };
}

function eventActor(
  event: WorkItemEventSummary,
  assignees: WorkItemAssigneeSummary[],
  metadata: Record<string, unknown>,
) {
  if (event.actorUserId) {
    const assignee = assignees.find((entry) => entry.id === event.actorUserId);
    return assignee?.name ?? stringValue(metadata.actorName) ?? "User";
  }
  if (event.actorAgentId) {
    return (
      stringValue(metadata.agentName) ??
      stringValue(metadata.actorName) ??
      event.actorAgentId
    );
  }
  return stringValue(metadata.actorName) ?? "System";
}

function assignmentText(
  event: WorkItemEventSummary,
  item: WorkItemSummary,
  assignees: WorkItemAssigneeSummary[],
  metadata: Record<string, unknown>,
) {
  const change = findFieldChange(metadata, [
    "owner_user_id",
    "ownerUserId",
    "owner_agent_id",
    "ownerAgentId",
    "assignee",
  ]);
  const previous =
    stringValue(metadata.previousAssigneeName) ??
    stringValue(metadata.previousOwnerName) ??
    nameForAssignee(change?.previousValue, assignees);
  const next =
    stringValue(metadata.assigneeName) ??
    stringValue(metadata.newAssigneeName) ??
    stringValue(metadata.ownerName) ??
    stringValue(metadata.newOwnerName) ??
    nameForAssignee(change?.newValue, assignees) ??
    nameForAssignee(item.ownerUserId, assignees) ??
    stringValue(item.ownerAgentId);

  if (previous && next) return `reassigned from ${previous} to ${next}`;
  if (next) return `assigned to ${next}`;
  if (event.message?.trim()) return sanitizeMessage(event.message, item);
  return "updated the assignee";
}

function dueDateText(metadata: Record<string, unknown>) {
  const change = findFieldChange(metadata, ["due_at", "dueAt", "due_date"]);
  const next = change?.newValue ?? metadata.newDueAt ?? metadata.dueAt;
  const previous = change?.previousValue ?? metadata.previousDueAt;
  if (!next) return "cleared the due date";
  if (previous) return `moved the due date to ${formatActivityDate(next)}`;
  return `set due date to ${formatActivityDate(next)}`;
}

function applicabilityText(metadata: Record<string, unknown>) {
  const change = findFieldChange(metadata, ["applicable", "required"]);
  if (change?.field === "required") {
    return truthy(change.newValue)
      ? "marked this Work Item required"
      : "marked this Work Item optional";
  }
  if (change && !truthy(change.newValue)) {
    return "marked this Work Item not applicable";
  }
  return "marked this Work Item applicable";
}

function linkedThreadText(metadata: Record<string, unknown>) {
  const title =
    stringValue(metadata.threadTitle) ??
    stringValue(metadata.resourceTitle) ??
    stringValue(metadata.title);
  return title ? `linked ${title}` : "linked a thread";
}

function agentActionText(
  event: WorkItemEventSummary,
  metadata: Record<string, unknown>,
) {
  const source = stringValue(metadata.source);
  if (source === "open_engine_route") {
    const route = objectRecord(metadata.route);
    const previous = stringValue(route.previousQueueKey) ?? "default";
    const next = stringValue(route.targetQueueKey) ?? "default";
    return `routed OpenEngine from ${previous} to ${next}`;
  }

  const receiptType = stringValue(metadata.receiptType);
  if (receiptType) return receiptText(receiptType, event.message);

  const actionType = stringValue(metadata.actionType);
  if (actionType) return humanActionText(actionType, event.message);

  return sanitizeMessage(event.message, null) || "recorded agent activity";
}

function documentActionText(
  event: WorkItemEventSummary,
  metadata: Record<string, unknown>,
) {
  const action = stringValue(metadata.action);
  const title =
    stringValue(metadata.documentTitle) ??
    removeTrailingSentence(event.message, "document created") ??
    removeTrailingSentence(event.message, "document updated") ??
    removeTrailingSentence(event.message, "document archived");
  const document = title ? ` document ${title}` : " a document";
  if (action === "document_created") return `created${document}`;
  if (action === "document_archived") return `archived${document}`;
  return `updated${document}`;
}

interface FieldChange {
  field: string;
  previousValue?: unknown;
  newValue?: unknown;
}

function primaryFieldChange(metadata: Record<string, unknown>) {
  const action = stringValue(metadata.action);
  if (action) {
    const field = actionToField(action);
    if (field) {
      return (
        findFieldChange(metadata, [field]) ?? {
          field,
          previousValue: metadata.previousValue,
          newValue: metadata.newValue,
        }
      );
    }
  }

  const fieldChanges = fieldChangesFromMetadata(metadata);
  if (fieldChanges.length > 0) return fieldChanges[0];

  const changedFields = arrayOfStrings(metadata.changedFields)
    .map(normalizeField)
    .filter((field) => field !== "updated_at");
  if (changedFields.length === 1) return { field: changedFields[0] };
  if (changedFields.length > 1) {
    return {
      field: "multiple",
      newValue: changedFields.map(activityFieldLabel).join(", "),
    };
  }
  return null;
}

function fieldChangeText(
  change: FieldChange,
  metadata: Record<string, unknown>,
  item: WorkItemSummary,
  assignees: WorkItemAssigneeSummary[],
) {
  const field = normalizeField(change.field);
  if (field === "priority") {
    return `set priority to ${workItemPriorityLabel(String(change.newValue ?? metadata.newValue ?? "NORMAL"))}`;
  }
  if (field === "due_at") return dueDateText(metadata);
  if (field === "owner_user_id" || field === "owner_agent_id") {
    const next =
      nameForAssignee(change.newValue, assignees) ??
      nameForAssignee(item.ownerUserId, assignees) ??
      stringValue(change.newValue) ??
      stringValue(item.ownerAgentId);
    return next ? `assigned to ${next}` : "updated the assignee";
  }
  if (field === "labels") return "updated labels";
  if (field === "applicable" || field === "required") {
    return applicabilityText(metadata);
  }
  if (field === "blocked") {
    return truthy(change.newValue)
      ? "blocked this Work Item"
      : "unblocked this Work Item";
  }
  if (field === "title") return "renamed this Work Item";
  if (field === "notes") return "updated the description";
  if (field === "open_engine_queue_key") {
    const next = stringValue(change.newValue ?? metadata.newValue);
    return next
      ? `set OpenEngine queue to ${next}`
      : "cleared OpenEngine queue";
  }
  if (field.startsWith("open_engine_")) {
    return `updated ${activityFieldLabel(field)}`;
  }
  if (field === "archived") {
    return truthy(change.newValue)
      ? "archived this Work Item"
      : "restored this Work Item";
  }
  if (field === "multiple") {
    return `updated ${String(change.newValue)}`;
  }
  return `updated ${activityFieldLabel(field)}`;
}

function fallbackActivityText(
  event: WorkItemEventSummary,
  item: WorkItemSummary | null,
) {
  const sanitized = sanitizeMessage(event.message, item);
  if (sanitized) return sanitized;
  const label = eventLabel(event.eventType).toLowerCase();
  return label === "updated" ? "updated this Work Item" : label;
}

function sanitizeMessage(
  message: string | null | undefined,
  item: WorkItemSummary | null,
) {
  const trimmed = message?.trim().replace(/\s+/g, " ");
  if (!trimmed) return "";
  if (!item?.title) return stripFinalPeriod(trimmed);
  const titlePattern = escapeRegExp(item.title.trim());
  return stripFinalPeriod(
    trimmed
      .replace(
        new RegExp(`^${titlePattern}\\s+updated\\.?$`, "i"),
        "updated this Work Item",
      )
      .replace(
        new RegExp(`^${titlePattern}\\s+created\\.?$`, "i"),
        "created this Work Item",
      )
      .replace(new RegExp(`^${titlePattern}\\s+`, "i"), ""),
  );
}

function removeTrailingSentence(
  message: string | null | undefined,
  suffix: string,
) {
  const trimmed = stripFinalPeriod(message?.trim() ?? "");
  const lower = trimmed.toLowerCase();
  const target = ` ${suffix}`;
  if (!lower.endsWith(target)) return null;
  return trimmed.slice(0, trimmed.length - target.length).trim() || null;
}

function statusLabel(
  statusId: string | null | undefined,
  statuses: WorkItemStatusSummary[],
) {
  if (!statusId) return null;
  return statuses.find((status) => status.id === statusId)?.name ?? null;
}

function nameForAssignee(value: unknown, assignees: WorkItemAssigneeSummary[]) {
  const id = stringValue(value);
  if (!id) return null;
  return assignees.find((entry) => entry.id === id)?.name ?? id;
}

function fieldChangesFromMetadata(metadata: Record<string, unknown>) {
  const value = metadata.fieldChanges;
  if (!Array.isArray(value)) return [];
  const changes: FieldChange[] = [];
  for (const entry of value) {
    const record = objectRecord(entry);
    const field = stringValue(record.field);
    if (!field) continue;
    changes.push({
      field,
      previousValue: record.previousValue,
      newValue: record.newValue,
    });
  }
  return changes;
}

function findFieldChange(metadata: Record<string, unknown>, fields: string[]) {
  const normalized = new Set(fields.map(normalizeField));
  return fieldChangesFromMetadata(metadata).find((change) =>
    normalized.has(normalizeField(change.field)),
  );
}

function actionToField(action: string) {
  const normalized = action.toLowerCase();
  if (normalized.includes("priority")) return "priority";
  if (normalized.includes("due")) return "due_at";
  if (normalized.includes("assign") || normalized.includes("owner")) {
    return "owner_user_id";
  }
  if (normalized.includes("label")) return "labels";
  if (normalized.includes("applicable")) return "applicable";
  if (normalized.includes("required")) return "required";
  if (normalized.includes("blocked")) return "blocked";
  if (normalized.includes("title")) return "title";
  if (normalized.includes("notes")) return "notes";
  if (normalized.includes("queue")) return "open_engine_queue_key";
  if (normalized.includes("archive")) return "archived";
  return null;
}

function iconKeyForField(field: string): WorkItemActivityIconKey {
  const normalized = normalizeField(field);
  if (normalized === "priority") return "priority";
  if (normalized === "due_at") return "due_date";
  if (normalized === "owner_user_id" || normalized === "owner_agent_id") {
    return "assigned";
  }
  if (normalized === "labels") return "labels";
  if (normalized === "applicable" || normalized === "required") {
    return "applicability";
  }
  if (normalized === "blocked") return "blocked";
  if (normalized.startsWith("open_engine_")) return "agent";
  return "updated";
}

function toneForField(field: string, value: unknown): WorkItemActivityTone {
  const normalized = normalizeField(field);
  if (normalized === "priority") return "amber";
  if (normalized === "due_at") return "amber";
  if (normalized === "owner_user_id" || normalized === "owner_agent_id") {
    return "violet";
  }
  if (normalized === "labels") return "blue";
  if (normalized === "blocked" && truthy(value)) return "red";
  if (normalized === "blocked") return "emerald";
  if (normalized.startsWith("open_engine_")) return "blue";
  return "slate";
}

function toneForStatus(eventType: string): WorkItemActivityTone {
  if (eventType === "completed" || eventType === "unblocked") return "emerald";
  if (eventType === "blocked") return "red";
  return "blue";
}

function eventTypeToneFromMessage(message: string | null | undefined) {
  const normalized = String(message ?? "").toLowerCase();
  if (normalized.includes("blocked") || normalized.includes("failed")) {
    return "red";
  }
  if (normalized.includes("done") || normalized.includes("released")) {
    return "emerald";
  }
  return "blue";
}

function receiptText(receiptType: string, message: string | null | undefined) {
  switch (receiptType) {
    case "blocked":
      return "reported an OpenEngine blocker";
    case "unblocked":
      return "cleared an OpenEngine blocker";
    case "done":
      return "completed OpenEngine work";
    case "skill_installed":
      return "installed a skill";
    case "skill_updated":
      return "updated a skill";
    case "skill_declined":
      return "declined a skill";
    case "skill_subscribed":
      return "subscribed to a skill";
    default:
      return (
        sanitizeMessage(message, null) || `recorded ${eventLabel(receiptType)}`
      );
  }
}

function humanActionText(
  actionType: string,
  message: string | null | undefined,
) {
  switch (actionType) {
    case "ANSWER_BLOCKER":
    case "answer_blocker":
      return "answered an OpenEngine blocker";
    case "RELEASE_HOLD":
    case "release_hold":
      return "released the OpenEngine hold";
    case "REQUEST_REVIEW":
    case "request_review":
      return "requested OpenEngine review";
    case "MARK_REVIEWED":
    case "mark_reviewed":
      return "marked OpenEngine work reviewed";
    case "MARK_BLOCKED":
    case "mark_blocked":
      return "marked OpenEngine work blocked";
    case "MARK_FAILED":
    case "mark_failed":
      return "marked OpenEngine work failed";
    default:
      return (
        sanitizeMessage(message, null) || `recorded ${eventLabel(actionType)}`
      );
  }
}

function normalizeField(field: string) {
  return field
    .trim()
    .replace(/[A-Z]/g, (char) => `_${char.toLowerCase()}`)
    .replace(/[\s-]+/g, "_")
    .toLowerCase()
    .replace(/^_+/, "");
}

function activityFieldLabel(field: string) {
  const normalized = normalizeField(field);
  if (normalized === "due_at") return "due date";
  if (normalized === "owner_user_id" || normalized === "owner_agent_id") {
    return "assignee";
  }
  if (normalized === "open_engine_queue_key") return "OpenEngine queue";
  if (normalized.startsWith("open_engine_")) {
    return `OpenEngine ${normalized.replace(/^open_engine_/, "").replace(/_/g, " ")}`;
  }
  return normalized.replace(/_/g, " ");
}

function formatActivityDate(value: unknown) {
  const date = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(date);
}

function eventLabel(value?: string | null) {
  return String(value ?? "activity")
    .toLowerCase()
    .split(/[_\s-]+/)
    .filter(Boolean)
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}

function objectRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function stringValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function arrayOfStrings(value: unknown) {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : [];
}

function truthy(value: unknown) {
  return value === true || value === "true" || value === 1 || value === "1";
}

function stripFinalPeriod(value: string) {
  return value.replace(/\.$/, "");
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizeEventType(value?: string | null) {
  return String(value ?? "")
    .trim()
    .toLowerCase();
}
