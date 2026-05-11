export type TaskQueuePart = {
  type: "data-task-queue";
  id: string;
  data: TaskQueueData;
};

export type TaskQueueStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "cancelled"
  | string;

export type TaskQueueItemStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "skipped"
  | "cancelled"
  | string;

export type TaskQueueData = {
  queueId?: string;
  title?: string;
  status?: TaskQueueStatus;
  source?: {
    type?: string;
    id?: string;
    slug?: string;
  };
  summary?: string;
  groups?: Array<{
    id?: string;
    title?: string;
    items?: Array<{
      id?: string;
      title?: string;
      summary?: string | null;
      status?: TaskQueueItemStatus;
      output?: unknown;
      error?: unknown;
      startedAt?: string | null;
      completedAt?: string | null;
      metadata?: Record<string, unknown>;
    }>;
  }>;
  items?: Array<{
    id?: string;
    title?: string;
    summary?: string | null;
    status?: TaskQueueItemStatus;
    output?: unknown;
    error?: unknown;
    startedAt?: string | null;
    completedAt?: string | null;
    metadata?: Record<string, unknown>;
  }>;
};

export function taskQueuePart(input: {
  queueId: string;
  data: TaskQueueData;
}): TaskQueuePart {
  return {
    type: "data-task-queue",
    id: `task-queue:${input.queueId}`,
    data: {
      ...input.data,
      queueId: input.data.queueId ?? input.queueId,
    },
  };
}

export function upsertTaskQueuePart(
  parts: unknown,
  part: TaskQueuePart,
): unknown[] {
  const next = Array.isArray(parts) ? [...parts] : [];
  const index = next.findIndex((candidate) => {
    const record = recordValue(candidate);
    return record.type === part.type && record.id === part.id;
  });
  if (index >= 0) {
    next[index] = part;
    return next;
  }
  return [...next, part];
}

export function taskQueueThreadMetadata(
  metadata: unknown,
  queueId: string | null,
): Record<string, unknown> {
  const next = { ...recordValue(metadata) };
  if (queueId) {
    next.activeTaskQueueId = queueId;
  } else {
    delete next.activeTaskQueueId;
  }
  return next;
}

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
