import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { ExternalLink } from "lucide-react";
import { Badge, Button, cn } from "@thinkwork/ui";
import { StatusBadge } from "@/components/StatusBadge";
import { WorkflowDefinitionCanvas } from "./WorkflowDefinitionCanvas";
import {
  formatDateTime,
  formatDuration,
  titleize,
  type WorkflowRunSummary,
} from "./workflow-ui";

/**
 * Executions tab (THINK-218 feedback pass, n8n-style): a left-hand list of
 * this workflow's executions with the canvas on the right. Selecting an
 * execution focuses it; the full run floor (timeline, evidence, diagnostics)
 * stays one click away via "Open run detail".
 */

const STATUS_BAR: Record<string, string> = {
  succeeded: "bg-emerald-500",
  failed: "bg-destructive",
  canceled: "bg-amber-500",
  running: "bg-blue-500",
};

function statusBarClass(status: string): string {
  return STATUS_BAR[status.toLowerCase()] ?? "bg-muted-foreground/40";
}

export function WorkflowExecutionsTab({
  workflowId,
  runs,
  definition,
}: {
  workflowId: string;
  runs: WorkflowRunSummary[];
  definition: unknown;
}) {
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const selectedRun = useMemo(
    () => runs.find((run) => run.id === selectedRunId) ?? runs[0] ?? null,
    [runs, selectedRunId],
  );

  if (runs.length === 0) {
    return (
      <div className="flex h-full items-center justify-center p-6">
        <p className="text-sm text-muted-foreground">
          This workflow has not recorded any executions yet.
        </p>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 gap-4">
      <aside className="flex w-[280px] shrink-0 flex-col overflow-hidden rounded-md border border-border bg-card xl:w-[320px]">
        <div className="border-b border-border p-4">
          <span className="text-sm font-semibold">Executions</span>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Most recent first.
          </p>
        </div>
        <ul className="min-h-0 flex-1 overflow-y-auto">
          {runs.map((run) => {
            const active = selectedRun?.id === run.id;
            return (
              <li key={run.id}>
                <button
                  type="button"
                  onClick={() => setSelectedRunId(run.id)}
                  className={cn(
                    "relative flex w-full flex-col gap-0.5 border-b border-border/60 py-3 pl-4 pr-3 text-left transition-colors",
                    active ? "bg-muted/60" : "hover:bg-muted/30",
                  )}
                >
                  <span
                    className={cn(
                      "absolute inset-y-0 left-0 w-0.5",
                      statusBarClass(run.status),
                    )}
                    aria-hidden
                  />
                  <span className="text-sm font-medium text-foreground">
                    {formatDateTime(run.startedAt)}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {titleize(run.status)}
                    {run.startedAt && run.finishedAt
                      ? ` in ${formatDuration(run.startedAt, run.finishedAt)}`
                      : ""}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </aside>

      <div className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-md border border-border">
        {selectedRun ? (
          <div className="flex flex-wrap items-center gap-2 border-b border-border bg-card px-4 py-2.5">
            <StatusBadge status={selectedRun.status.toLowerCase()} size="sm" />
            <span className="text-sm text-muted-foreground">
              {formatDateTime(selectedRun.startedAt)}
            </span>
            <Badge variant="outline" className="text-xs">
              {titleize(selectedRun.triggerFamily)}
            </Badge>
            {selectedRun.startedAt && selectedRun.finishedAt ? (
              <span className="text-xs text-muted-foreground">
                {formatDuration(selectedRun.startedAt, selectedRun.finishedAt)}
              </span>
            ) : null}
            <Button
              asChild
              size="sm"
              variant="outline"
              className="ml-auto gap-1.5"
            >
              <Link
                to="/settings/workflows/$workflowId/runs/$runId"
                params={{ workflowId, runId: selectedRun.id }}
              >
                Open run detail
                <ExternalLink className="size-3.5" />
              </Link>
            </Button>
          </div>
        ) : null}
        <div className="min-h-0 flex-1">
          <WorkflowDefinitionCanvas
            definition={definition}
            className="h-full min-h-0 rounded-none border-0"
          />
        </div>
      </div>
    </div>
  );
}
