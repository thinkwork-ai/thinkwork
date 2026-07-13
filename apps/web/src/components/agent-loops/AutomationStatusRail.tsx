import type { ReactNode } from "react";
import { Loader2, Pause, Play, Zap } from "lucide-react";
import { Badge, Button } from "@thinkwork/ui";
import { StatusBadge } from "@/components/StatusBadge";
import type {
  AgentLoopMemberOption,
  AgentLoopRow,
  AgentLoopSpaceOption,
} from "./agent-loop-types";
import {
  formatDateTime,
  jsonRecord,
  readTargetSpec,
  titleize,
} from "./agent-loop-utils";
import { formatWorkflowSchedule } from "@/components/workflows/workflow-schedule-display";

const TARGET_LABELS: Record<string, string> = {
  agent_thread: "Agent thread",
  routine: "Routine",
  workflow: "Workflow",
  memory_pipeline: "Memory pipeline",
};

export function AutomationStatusRail({
  loop,
  pendingAction,
  spaceOptions = [],
  memberOptions = [],
  variant = "rail",
  showActions = true,
  onRun,
  onToggle,
}: {
  loop: AgentLoopRow;
  pendingAction: string | null;
  spaceOptions?: AgentLoopSpaceOption[];
  memberOptions?: AgentLoopMemberOption[];
  /** "rail" = classic bordered sidebar; "card" = the canvas right-rail card
   * matching the node inspectors (THINK-247). */
  variant?: "rail" | "card";
  showActions?: boolean;
  onRun: () => void;
  onToggle: () => void;
}) {
  const active = loop.lifecycleStatus === "active" && loop.enabled;
  const version = loop.currentVersion;
  const trigger = jsonRecord(version?.triggerSpec);
  const triggerConfig = jsonRecord(trigger.config);
  const target = readTargetSpec(version);
  // THINK-264: the system memory loop's schedule lives on the processor's
  // scheduled job, not in the trigger spec, and readTargetSpec normalizes its
  // unknown target kind away — read both off the pipeline view instead.
  const memoryPipeline = loop.memoryPipeline ?? null;
  const scheduleExpression =
    typeof triggerConfig.scheduleExpression === "string"
      ? triggerConfig.scheduleExpression
      : (memoryPipeline?.scheduleExpression ?? null);
  const scheduleTimezone =
    typeof triggerConfig.timezone === "string"
      ? triggerConfig.timezone
      : (memoryPipeline?.scheduleTimezone ?? null);
  const targetLabel = memoryPipeline
    ? TARGET_LABELS.memory_pipeline
    : TARGET_LABELS[target.kind];
  const lastRun = loop.runs?.[0] ?? null;
  const lastRunAt = lastRun?.startedAt ?? lastRun?.createdAt ?? loop.lastRunAt;
  const lastRunStatus = lastRun?.status ?? loop.lastRunStatus;
  const spaceName =
    spaceOptions.find((space) => space.id === loop.spaceId)?.name ??
    (loop.spaceId ? loop.spaceId : "-");
  const runAsName =
    memberOptions.find((member) => member.id === loop.runAsUserId)?.label ??
    (loop.runAsUserId ? loop.runAsUserId : "You");

  return (
    <aside
      className={
        variant === "card"
          ? "rounded-md border border-border/70 bg-muted/10 p-4"
          : "border-l border-border/70 pl-6"
      }
    >
      <div
        className={variant === "card" ? "space-y-6" : "sticky top-4 space-y-6"}
      >
        <h3 className="text-sm font-semibold">General information</h3>
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge status={loop.lifecycleStatus} size="sm" />
          <Badge variant="outline" className="text-xs">
            v{loop.currentVersionNumber ?? "-"}
          </Badge>
        </div>

        <div className="grid gap-3 text-sm">
          <RailRow
            label="Status"
            value={active ? "Active" : titleize(loop.lifecycleStatus)}
          />
          <RailRow
            label="Trigger"
            value={titleize(loop.primaryTriggerFamily)}
          />
          {loop.primaryTriggerFamily === "schedule" ? (
            <RailRow
              label="Schedule"
              value={formatWorkflowSchedule(
                scheduleExpression,
                scheduleTimezone,
              )}
            />
          ) : null}
          <RailRow label="Target" value={targetLabel} />
          <RailRow label="Run as" value={runAsName} />
          <RailRow label="Space" value={spaceName} />
          <RailRow label="Last ran" value={formatDateTime(lastRunAt)} />
          <RailRow
            label="Last result"
            value={lastRunStatus ? titleize(lastRunStatus) : "-"}
          />
          <RailRow
            label="Last thread"
            value={
              lastRun?.threadId ? (
                <a
                  className="text-primary hover:underline"
                  href={`/threads/${lastRun.threadId}`}
                >
                  Open thread
                </a>
              ) : (
                "-"
              )
            }
          />
        </div>

        {showActions ? (
          <div className="grid grid-cols-2 gap-2 @max-[650px]:grid-cols-1">
            <Button
              type="button"
              onClick={onRun}
              disabled={pendingAction !== null || !active}
            >
              {pendingAction === "run" ? (
                <Loader2 className="mr-2 size-4 animate-spin" />
              ) : (
                <Zap className="mr-2 size-4" />
              )}
              Run now
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={onToggle}
              disabled={pendingAction !== null}
            >
              {pendingAction === "pause" ? (
                <Loader2 className="mr-2 size-4 animate-spin" />
              ) : active ? (
                <Pause className="mr-2 size-4" />
              ) : (
                <Play className="mr-2 size-4" />
              )}
              {active ? "Pause" : "Resume"}
            </Button>
          </div>
        ) : null}
      </div>
    </aside>
  );
}

function RailRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <span className="text-muted-foreground">{label}</span>
      <span className="max-w-48 text-right text-foreground">{value}</span>
    </div>
  );
}
