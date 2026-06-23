import { Badge, Button } from "@thinkwork/ui";
import { StatusBadge } from "@/components/StatusBadge";
import type { AgentLoopRunSummary } from "./agent-loop-types";
import {
  formatCost,
  formatDateTime,
  formatDuration,
  titleize,
} from "./agent-loop-utils";

export function AutomationRunsList({
  runs,
  onOpenRun,
}: {
  runs: AgentLoopRunSummary[];
  onOpenRun: (run: AgentLoopRunSummary) => void;
}) {
  if (runs.length === 0) {
    return (
      <div className="rounded-md border border-dashed border-border/70 py-10 text-center text-sm text-muted-foreground">
        No runs recorded yet.
      </div>
    );
  }

  return (
    <div className="divide-y divide-border rounded-md border border-border/70">
      {runs.map((run) => (
        <div
          key={run.id}
          className="grid gap-3 px-4 py-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-center"
        >
          <div className="min-w-0 space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge status={run.status.toLowerCase()} size="sm" />
              <Badge variant="outline" className="text-xs">
                {titleize(run.triggerFamily)}
              </Badge>
              <span className="text-xs text-muted-foreground">
                {formatDateTime(run.startedAt ?? run.createdAt)}
              </span>
            </div>
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
              <span>Iteration {run.currentIteration}</span>
              <span>{formatDuration(run.startedAt, run.finishedAt)}</span>
              <span>{formatCost(run.totalCostUsdCents)}</span>
            </div>
          </div>
          <div className="flex items-center justify-end gap-2">
            {run.threadId ? (
              <Button type="button" variant="outline" size="sm" asChild>
                <a href={`/threads/${run.threadId}`}>Open thread</a>
              </Button>
            ) : null}
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => onOpenRun(run)}
            >
              Run details
            </Button>
          </div>
        </div>
      ))}
    </div>
  );
}
