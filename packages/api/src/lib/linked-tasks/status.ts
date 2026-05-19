export const LINKED_TASK_STATUSES = [
  "unknown",
  "todo",
  "in_progress",
  "completed",
  "blocked",
  "cancelled",
] as const;

export const LINKED_TASK_SYNC_STATUSES = [
  "pending",
  "synced",
  "warning",
  "error",
] as const;

export type LinkedTaskStatus = (typeof LINKED_TASK_STATUSES)[number];
export type LinkedTaskSyncStatus = (typeof LINKED_TASK_SYNC_STATUSES)[number];

export interface NormalizedLinkedTaskStatus {
  status: LinkedTaskStatus;
  blocked: boolean;
  syncStatus: LinkedTaskSyncStatus;
}

export interface RequiredCompletionTask {
  required?: boolean | null;
  status?: LinkedTaskStatus | string | null;
}

export function normalizeExternalTaskStatus(
  value: unknown,
): NormalizedLinkedTaskStatus {
  const normalized = normalizeStatusToken(value);
  if (!normalized) {
    return { status: "unknown", blocked: false, syncStatus: "warning" };
  }

  if (
    normalized === "completed" ||
    normalized === "complete" ||
    normalized === "done" ||
    normalized === "closed"
  ) {
    return { status: "completed", blocked: false, syncStatus: "synced" };
  }

  if (
    normalized === "blocked" ||
    normalized === "on_hold" ||
    normalized === "waiting" ||
    normalized === "stalled"
  ) {
    return { status: "blocked", blocked: true, syncStatus: "synced" };
  }

  if (
    normalized === "in_progress" ||
    normalized === "started" ||
    normalized === "working" ||
    normalized === "active"
  ) {
    return { status: "in_progress", blocked: false, syncStatus: "synced" };
  }

  if (
    normalized === "todo" ||
    normalized === "to_do" ||
    normalized === "open" ||
    normalized === "new" ||
    normalized === "not_started"
  ) {
    return { status: "todo", blocked: false, syncStatus: "synced" };
  }

  if (
    normalized === "cancelled" ||
    normalized === "canceled" ||
    normalized === "void"
  ) {
    return { status: "cancelled", blocked: false, syncStatus: "synced" };
  }

  return { status: "unknown", blocked: false, syncStatus: "warning" };
}

export function requiredTasksComplete(
  tasks: RequiredCompletionTask[],
): boolean {
  const requiredTasks = tasks.filter((task) => task.required !== false);
  if (requiredTasks.length === 0) return false;
  return requiredTasks.every(
    (task) => normalizeStatusToken(task.status) === "completed",
  );
}

export function countRequiredTasks(tasks: RequiredCompletionTask[]) {
  let required = 0;
  let completed = 0;
  for (const task of tasks) {
    if (task.required === false) continue;
    required += 1;
    if (normalizeStatusToken(task.status) === "completed") completed += 1;
  }
  return { required, completed };
}

function normalizeStatusToken(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  const normalized = String(value)
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
  return normalized.length > 0 ? normalized : null;
}
