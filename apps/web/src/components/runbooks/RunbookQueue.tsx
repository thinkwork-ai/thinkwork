"use client";

import { Badge } from "@thinkwork/ui/badge";
import {
  CheckCircle2,
  Circle,
  CircleAlert,
  CircleDot,
  CircleSlash,
  Clock,
} from "lucide-react";
import {
  Queue,
  QueueDescription,
  QueueGroup,
  QueueGroupTitle,
  QueueHeader,
  QueueItem,
  QueueList,
  QueueTitle,
} from "@/components/ai-elements/queue";
import type {
  RunbookQueueData,
  RunbookQueuePhase,
  RunbookQueueTask,
  TaskQueueData,
  TaskQueueGroup,
  TaskQueueItem,
} from "@/lib/ui-message-types";
import { cn } from "@/lib/utils";

export function TaskQueue({
  data,
  className,
  compact = false,
}: {
  data: TaskQueueData;
  className?: string;
  compact?: boolean;
}) {
  const groups = normalizeTaskQueueGroups(data);
  const title = stringValue(data.title) ?? "Task queue";
  const status = normalizeStatus(data.status);
  const description =
    stringValue(data.summary) ??
    (data.source?.type
      ? `Visible ${data.source.type.replace(/_/g, " ")} progress.`
      : "Visible plan for this request.");

  return (
    <Queue
      aria-label={`${title} queue`}
      className={cn(compact ? "gap-3 p-3 shadow-none" : undefined, className)}
    >
      <QueueHeader className={compact ? "gap-1" : undefined}>
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <QueueTitle>{title}</QueueTitle>
          {status ? <StatusBadge status={status} /> : null}
        </div>
        <QueueDescription>{description}</QueueDescription>
      </QueueHeader>
      <QueueList className={compact ? "gap-3" : undefined}>
        {groups.length > 0 ? (
          groups.map((group, index) => (
            <TaskQueueGroupView
              key={stringValue(group.id) ?? `group-${index}`}
              group={group}
              compact={compact}
            />
          ))
        ) : (
          <p className="text-muted-foreground text-sm">
            No tasks published yet.
          </p>
        )}
      </QueueList>
    </Queue>
  );
}

export function RunbookQueue({
  data,
  className,
  compact = false,
}: {
  data: RunbookQueueData;
  className?: string;
  compact?: boolean;
}) {
  return (
    <TaskQueue
      data={taskQueueFromRunbookQueue(data)}
      className={className}
      compact={compact}
    />
  );
}

function TaskQueueGroupView({
  group,
  compact,
}: {
  group: TaskQueueGroup;
  compact?: boolean;
}) {
  const items = Array.isArray(group.items) ? group.items : [];
  return (
    <QueueGroup className={compact ? "gap-1.5" : undefined}>
      <QueueGroupTitle>
        {stringValue(group.title) ?? stringValue(group.id) ?? "Tasks"}
      </QueueGroupTitle>
      <div className="grid gap-2">
        {items.length > 0 ? (
          items.map((item, index) => (
            <TaskRow
              key={stringValue(item.id) ?? `task-${index}`}
              task={item}
              compact={compact}
            />
          ))
        ) : (
          <p className="text-muted-foreground text-sm">
            No tasks in this group.
          </p>
        )}
      </div>
    </QueueGroup>
  );
}

function TaskRow({
  task,
  compact,
}: {
  task: RunbookQueueTask | TaskQueueItem;
  compact?: boolean;
}) {
  const status = normalizeStatus(task.status);
  const title =
    stringValue(task.title) ?? stringValue(task.summary) ?? "Untitled task";
  return (
    <QueueItem className={compact ? "px-2.5 py-2" : undefined}>
      <StatusIcon status={status} />
      <div className="grid min-w-0 gap-1">
        <p className="text-pretty break-words text-sm leading-5">{title}</p>
        {stringValue(task.summary) && stringValue(task.summary) !== title ? (
          <p className="text-pretty break-words text-muted-foreground text-xs leading-5">
            {stringValue(task.summary)}
          </p>
        ) : null}
      </div>
      <StatusBadge status={status} />
    </QueueItem>
  );
}

function normalizeTaskQueueGroups(data: TaskQueueData): TaskQueueGroup[] {
  if (Array.isArray(data.groups) && data.groups.length > 0) {
    return data.groups;
  }
  if (Array.isArray(data.items) && data.items.length > 0) {
    return [{ id: "tasks", title: "Tasks", items: data.items }];
  }
  return [];
}

export function taskQueueFromRunbookQueue(
  data: RunbookQueueData,
): TaskQueueData {
  return {
    queueId:
      stringValue(data.runbookRunId) ??
      stringValue(data.runbookSlug) ??
      undefined,
    title: stringValue(data.displayName) ?? "Runbook plan",
    status: data.status,
    source: {
      type: "runbook",
      id: stringValue(data.runbookRunId) ?? undefined,
      slug: stringValue(data.runbookSlug) ?? undefined,
    },
    summary: data.runbookRunId
      ? "Working through the approved runbook queue."
      : "Visible plan for this request.",
    groups: (Array.isArray(data.phases) ? data.phases : []).map(
      runbookPhaseToTaskQueueGroup,
    ),
  };
}

function runbookPhaseToTaskQueueGroup(
  phase: RunbookQueuePhase,
): TaskQueueGroup {
  return {
    id: stringValue(phase.id) ?? undefined,
    title: stringValue(phase.title) ?? stringValue(phase.id) ?? "Phase",
    items: (Array.isArray(phase.tasks) ? phase.tasks : []).map(
      runbookTaskToTaskQueueItem,
    ),
  };
}

function runbookTaskToTaskQueueItem(task: RunbookQueueTask): TaskQueueItem {
  const taskKey = stringValue(task.taskKey) ?? stringValue(task.key);
  return {
    id: stringValue(task.id) ?? taskKey ?? undefined,
    title:
      stringValue(task.title) ??
      stringValue(task.summary) ??
      taskKey ??
      undefined,
    summary: stringValue(task.summary),
    status: task.status,
    metadata: {
      taskKey,
      dependsOn: task.dependsOn,
      capabilityRoles: task.capabilityRoles,
      sortOrder: task.sortOrder,
    },
  };
}

function StatusBadge({ status }: { status: string }) {
  const tone = statusTone(status);
  return (
    <Badge
      variant={tone === "error" ? "destructive" : "secondary"}
      className="max-w-full shrink-0 capitalize"
    >
      {statusLabel(status)}
    </Badge>
  );
}

function StatusIcon({ status }: { status: string }) {
  const className = "mt-0.5 size-4 shrink-0";
  switch (status) {
    case "completed":
      return (
        <CheckCircle2 aria-hidden className={`${className} text-emerald-500`} />
      );
    case "running":
      return <CircleDot aria-hidden className={`${className} text-sky-500`} />;
    case "failed":
    case "error":
      return (
        <CircleAlert aria-hidden className={`${className} text-destructive`} />
      );
    case "skipped":
    case "cancelled":
      return (
        <CircleSlash
          aria-hidden
          className={`${className} text-muted-foreground`}
        />
      );
    case "pending":
      return (
        <Clock aria-hidden className={`${className} text-muted-foreground`} />
      );
    default:
      return (
        <Circle aria-hidden className={`${className} text-muted-foreground`} />
      );
  }
}

function normalizeStatus(value: unknown) {
  const raw = stringValue(value)?.toLowerCase().replace(/_/g, "-") ?? "";
  if (!raw) return "pending";
  return raw;
}

function statusLabel(status: string) {
  if (!status || status === "pending") return "Pending";
  return status.replace(/-/g, " ");
}

function statusTone(status: string) {
  return status === "failed" || status === "error" ? "error" : "neutral";
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
