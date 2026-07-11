import { useMemo, useState } from "react";
import { X } from "lucide-react";
import { useQuery } from "urql";
import { Badge, Button, cn } from "@thinkwork/ui";
import { StatusBadge } from "@/components/StatusBadge";
import { RoutineFlowCanvas } from "@/components/routines/RoutineFlowCanvas";
import type { RoutineAslGraph } from "@/components/routines/routineAslGraph";
import type { AgentLoopRunDetail } from "@/components/agent-loops/agent-loop-types";
import {
  SettingsAgentLoopRunQuery,
  SettingsWorkflowRunQuery,
} from "@/lib/graphql-queries";
import type { WorkflowExecutionSummary } from "./workflow-execution-model";
import {
  DefinitionList,
  formatDateTime,
  formatDuration,
  jsonRecord,
  titleize,
} from "./workflow-ui";
import { WorkflowCanvasWorkspace } from "./WorkflowCanvasWorkspace";

const STATUS_BAR: Record<string, string> = {
  succeeded: "bg-emerald-500",
  failed: "bg-destructive",
  canceled: "bg-amber-500",
  running: "bg-blue-500",
  queued: "bg-blue-400",
  waiting_for_human: "bg-amber-500",
};

type WorkflowRunDetail = {
  id: string;
  status: string;
  triggerFamily: string;
  triggerSource?: string | null;
  correlationId?: string | null;
  backendExecutionId?: string | null;
  startedAt?: string | null;
  finishedAt?: string | null;
  errorCode?: string | null;
  errorMessage?: string | null;
  workflowVersion?: { versionNumber?: number | null } | null;
  events: Array<{
    id: string;
    eventType: string;
    eventStatus?: string | null;
    occurredAt: string;
    message?: string | null;
    payloadSummary?: unknown;
  }>;
};

export function WorkflowExecutionsTab({
  executions,
  graph,
}: {
  executions: WorkflowExecutionSummary[];
  graph: RoutineAslGraph;
}) {
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const selectedRun = useMemo(
    () =>
      executions.find((run) => run.id === selectedRunId) ??
      executions[0] ??
      null,
    [executions, selectedRunId],
  );

  const [workflowResult] = useQuery<{ workflowRun?: WorkflowRunDetail | null }>(
    {
      query: SettingsWorkflowRunQuery,
      variables: { id: selectedRun?.id ?? "" },
      pause: selectedRun?.source !== "workflow",
      requestPolicy: "cache-and-network",
    },
  );
  const [legacyResult] = useQuery<{
    agentLoopRun?: AgentLoopRunDetail | null;
  }>({
    query: SettingsAgentLoopRunQuery,
    variables: { id: selectedRun?.id ?? "" },
    pause: selectedRun?.source !== "agent_loop",
    requestPolicy: "cache-and-network",
  });

  if (executions.length === 0) {
    return (
      <div className="flex h-full items-center justify-center p-6">
        <p className="text-sm text-muted-foreground">
          This workflow has not recorded any executions yet.
        </p>
      </div>
    );
  }

  return (
    <WorkflowCanvasWorkspace
      leading={
        <aside className="flex min-w-0 flex-col overflow-hidden rounded-md border border-border bg-card">
          <div className="border-b border-border p-4">
            <span className="text-sm font-semibold">Executions</span>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Most recent first.
            </p>
          </div>
          <ul className="min-h-0 flex-1 overflow-y-auto">
            {executions.map((run) => {
              const active = selectedRun?.id === run.id;
              return (
                <li key={`${run.source}:${run.id}`}>
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedRunId(run.id);
                      setSelectedNodeId(null);
                    }}
                    className={cn(
                      "relative flex w-full flex-col gap-0.5 border-b border-border/60 py-3 pl-4 pr-3 text-left transition-colors",
                      active ? "bg-muted/60" : "hover:bg-muted/30",
                    )}
                  >
                    <span
                      className={cn(
                        "absolute inset-y-0 left-0 w-0.5",
                        STATUS_BAR[run.status] ?? "bg-muted-foreground/40",
                      )}
                      aria-hidden
                    />
                    <span className="whitespace-nowrap text-sm font-medium text-foreground">
                      {formatDateTime(run.startedAt ?? run.createdAt)}
                    </span>
                    <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      {titleize(run.status)}
                      {run.source === "agent_loop" ? (
                        <Badge
                          variant="outline"
                          className="h-4 px-1 text-[9px]"
                        >
                          Legacy
                        </Badge>
                      ) : null}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </aside>
      }
      canvas={
        <div className="relative flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-md border border-border">
          {selectedRun ? (
            <div className="flex flex-wrap items-center gap-2 border-b border-border bg-card px-4 py-2.5 pr-12">
              <StatusBadge status={selectedRun.status} size="sm" />
              <span className="text-sm text-muted-foreground">
                {formatDateTime(selectedRun.startedAt ?? selectedRun.createdAt)}
              </span>
              <Badge variant="outline" className="text-xs">
                {titleize(selectedRun.triggerFamily)}
              </Badge>
              {selectedRun.startedAt && selectedRun.finishedAt ? (
                <span className="text-xs text-muted-foreground">
                  {formatDuration(
                    selectedRun.startedAt,
                    selectedRun.finishedAt,
                  )}
                </span>
              ) : null}
            </div>
          ) : null}
          <div className="min-h-0 flex-1">
            <RoutineFlowCanvas
              mode="execution"
              aslJson={null}
              graph={graph}
              selectedNodeId={selectedNodeId}
              onSelectNode={setSelectedNodeId}
              className="h-full min-h-0 rounded-none border-0"
            />
          </div>
        </div>
      }
      inspector={
        <ExecutionInspector
          run={selectedRun}
          nodeId={selectedNodeId}
          workflowRun={workflowResult.data?.workflowRun ?? null}
          legacyRun={legacyResult.data?.agentLoopRun ?? null}
          fetching={
            selectedRun?.source === "workflow"
              ? workflowResult.fetching
              : legacyResult.fetching
          }
          error={
            selectedRun?.source === "workflow"
              ? workflowResult.error?.message
              : legacyResult.error?.message
          }
          onClearNode={() => setSelectedNodeId(null)}
        />
      }
      inspectorKey={selectedNodeId}
      onInspectorClose={() => setSelectedNodeId(null)}
    />
  );
}

function ExecutionInspector({
  run,
  nodeId,
  workflowRun,
  legacyRun,
  fetching,
  error,
  onClearNode,
}: {
  run: WorkflowExecutionSummary | null;
  nodeId: string | null;
  workflowRun: WorkflowRunDetail | null;
  legacyRun: AgentLoopRunDetail | null;
  fetching: boolean;
  error?: string;
  onClearNode: () => void;
}) {
  const nodeEvents = useMemo(() => {
    if (!nodeId || !workflowRun) return [];
    return workflowRun.events.filter((event) => {
      const payload = jsonRecord(event.payloadSummary);
      return (payload.stepId ?? payload.nodeId) === nodeId;
    });
  }, [nodeId, workflowRun]);

  return (
    <aside className="flex min-w-0 flex-col overflow-hidden rounded-md border border-border bg-card">
      <div className="flex items-start gap-2 border-b border-border p-4">
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-sm font-semibold">
            {nodeId ? titleize(nodeId) : "Execution information"}
          </h3>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {nodeId
              ? "Status and events for the selected node."
              : "Status and context for the selected run."}
          </p>
        </div>
        {nodeId ? (
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="Back to execution information"
            onClick={onClearNode}
          >
            <X className="size-4" />
          </Button>
        ) : null}
      </div>
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
        {!run ? null : error ? (
          <p className="text-sm text-destructive">{error}</p>
        ) : fetching && !workflowRun && !legacyRun ? (
          <p className="text-sm text-muted-foreground">
            Loading execution information…
          </p>
        ) : nodeId ? (
          run.source === "agent_loop" ? (
            <p className="text-sm text-muted-foreground">
              No step-level telemetry was recorded for this legacy execution.
            </p>
          ) : nodeEvents.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No events have been recorded for this node yet.
            </p>
          ) : (
            <div className="space-y-3">
              <StatusBadge
                status={
                  nodeEvents.at(-1)?.eventStatus ??
                  String(
                    jsonRecord(nodeEvents.at(-1)?.payloadSummary).status ??
                      "running",
                  )
                }
                size="sm"
              />
              {nodeEvents.map((event) => (
                <div
                  key={event.id}
                  className="rounded-md border border-border/70 p-3"
                >
                  <p className="text-xs font-medium">
                    {titleize(event.eventType)}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {formatDateTime(event.occurredAt)}
                  </p>
                  {event.message ? (
                    <p className="mt-2 text-sm text-muted-foreground">
                      {event.message}
                    </p>
                  ) : null}
                </div>
              ))}
            </div>
          )
        ) : (
          <DefinitionList
            items={[
              {
                label: "Status",
                value: <StatusBadge status={run.status} size="sm" />,
              },
              { label: "Trigger", value: titleize(run.triggerFamily) },
              {
                label: "Started",
                value: formatDateTime(run.startedAt ?? run.createdAt),
              },
              {
                label: "Duration",
                value: formatDuration(run.startedAt, run.finishedAt),
              },
              {
                label: "Source",
                value:
                  run.source === "workflow"
                    ? "Workflow ledger"
                    : "Legacy Automation ledger",
              },
              {
                label: "Version",
                value: workflowRun?.workflowVersion?.versionNumber ?? "—",
              },
              { label: "Correlation", value: run.correlationId ?? "—" },
              ...(legacyRun?.threadId
                ? [{ label: "Thread", value: legacyRun.threadId }]
                : []),
            ]}
          />
        )}
      </div>
    </aside>
  );
}
