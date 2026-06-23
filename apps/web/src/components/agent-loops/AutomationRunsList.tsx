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
    <div className="overflow-x-auto rounded-md border border-border/70">
      <table className="w-full min-w-[760px] text-left text-sm">
        <thead className="border-b border-border/70 bg-muted/20 text-xs uppercase tracking-wide text-muted-foreground">
          <tr>
            <th className="px-4 py-3 font-medium">Status</th>
            <th className="px-4 py-3 font-medium">Trigger</th>
            <th className="px-4 py-3 font-medium">Started</th>
            <th className="px-4 py-3 font-medium">Iteration</th>
            <th className="px-4 py-3 font-medium">Duration</th>
            <th className="px-4 py-3 font-medium">Cost</th>
            <th className="px-4 py-3 text-right font-medium">Actions</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border/70">
          {runs.map((run) => (
            <tr key={run.id}>
              <td className="px-4 py-3">
                <StatusBadge status={run.status.toLowerCase()} size="sm" />
              </td>
              <td className="px-4 py-3">
                <Badge variant="outline" className="text-xs">
                  {titleize(run.triggerFamily)}
                </Badge>
              </td>
              <td className="whitespace-nowrap px-4 py-3 text-muted-foreground">
                {formatDateTime(run.startedAt ?? run.createdAt)}
              </td>
              <td className="px-4 py-3 text-muted-foreground">
                {run.currentIteration}
              </td>
              <td className="whitespace-nowrap px-4 py-3 text-muted-foreground">
                {formatDuration(run.startedAt, run.finishedAt)}
              </td>
              <td className="whitespace-nowrap px-4 py-3 text-muted-foreground">
                {formatCost(run.totalCostUsdCents)}
              </td>
              <td className="px-4 py-3">
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
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
