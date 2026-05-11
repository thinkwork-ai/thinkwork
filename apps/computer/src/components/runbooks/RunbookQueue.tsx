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
} from "@/lib/ui-message-types";
import { cn } from "@/lib/utils";

export function RunbookQueue({
  data,
  className,
  compact = false,
}: {
  data: RunbookQueueData;
  className?: string;
  compact?: boolean;
}) {
  const phases = Array.isArray(data.phases) ? data.phases : [];
  const title = stringValue(data.displayName) ?? "Runbook plan";
  const status = normalizeStatus(data.status);
  const description = data.runbookRunId
    ? "Working through the approved runbook queue."
    : "Visible plan for this request.";

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
        {phases.length > 0 ? (
          phases.map((phase, index) => (
            <PhaseGroup
              key={stringValue(phase.id) ?? `phase-${index}`}
              phase={phase}
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

function PhaseGroup({
  phase,
  compact,
}: {
  phase: RunbookQueuePhase;
  compact?: boolean;
}) {
  const tasks = Array.isArray(phase.tasks) ? phase.tasks : [];
  return (
    <QueueGroup className={compact ? "gap-1.5" : undefined}>
      <QueueGroupTitle>
        {stringValue(phase.title) ?? stringValue(phase.id) ?? "Phase"}
      </QueueGroupTitle>
      <div className="grid gap-2">
        {tasks.length > 0 ? (
          tasks.map((task, index) => (
            <TaskRow
              key={stringValue(task.id) ?? `task-${index}`}
              task={task}
              compact={compact}
            />
          ))
        ) : (
          <p className="text-muted-foreground text-sm">
            No tasks in this phase.
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
  task: RunbookQueueTask;
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
