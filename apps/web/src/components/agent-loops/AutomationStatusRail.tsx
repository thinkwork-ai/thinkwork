import type { ReactNode } from "react";
import { Loader2, Pause, Play, Zap } from "lucide-react";
import { Badge, Button } from "@thinkwork/ui";
import { StatusBadge } from "@/components/StatusBadge";
import type { AgentLoopRow } from "./agent-loop-types";
import {
  formatCost,
  formatDateTime,
  jsonRecord,
  stringValue,
  titleize,
} from "./agent-loop-utils";

export function AutomationStatusRail({
  loop,
  pendingAction,
  onRun,
  onToggle,
}: {
  loop: AgentLoopRow;
  pendingAction: string | null;
  onRun: () => void;
  onToggle: () => void;
}) {
  const active = loop.lifecycleStatus === "active" && loop.enabled;
  const version = loop.currentVersion;
  const trigger = jsonRecord(version?.triggerSpec);
  const triggerConfig = jsonRecord(trigger.config);
  const lastRun = loop.runs?.[0] ?? null;
  const lastRunAt = lastRun?.startedAt ?? lastRun?.createdAt ?? loop.lastRunAt;
  const lastRunStatus = lastRun?.status ?? loop.lastRunStatus;

  return (
    <aside className="border-l border-border/70 pl-6">
      <div className="sticky top-4 space-y-6">
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
          <RailRow
            label="Schedule"
            value={stringValue(triggerConfig.scheduleExpression, "-")}
          />
          <RailRow
            label="Timezone"
            value={stringValue(triggerConfig.timezone, "-")}
          />
          <RailRow label="Last ran" value={formatDateTime(lastRunAt)} />
          <RailRow
            label="Last result"
            value={lastRunStatus ? titleize(lastRunStatus) : "-"}
          />
          <RailRow label="Cost" value={formatCost(loop.totalCostUsdCents)} />
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
