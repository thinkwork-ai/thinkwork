import { useEffect } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "urql";
import { Badge, Button } from "@thinkwork/ui";
import { LoadingShimmer } from "@/components/LoadingShimmer";
import { StatusBadge } from "@/components/StatusBadge";
import { usePageHeaderActions } from "@/context/PageHeaderContext";
import {
  DefinitionList,
  InfoCard,
  JsonPreview,
} from "@/components/workflows/workflow-ui";
import { SettingsAgentLoopRunQuery } from "@/lib/graphql-queries";
import { AgentLoopEvidencePanel } from "./AgentLoopEvidencePanel";
import type {
  AgentLoopIteration,
  AgentLoopJudgment,
  AgentLoopRunDetail as AgentLoopRunDetailData,
} from "./agent-loop-types";
import {
  formatCost,
  formatDateTime,
  formatDuration,
  titleize,
} from "./agent-loop-utils";

type AgentLoopRunQueryData = {
  agentLoopRun?: AgentLoopRunDetailData | null;
};

const TERMINAL_STATUSES = new Set([
  "completed",
  "failed",
  "budget_stopped",
  "escalated",
  "canceled",
  "skipped",
]);

export function AgentLoopRunDetail({
  agentLoopId,
  runId,
}: {
  agentLoopId: string;
  runId: string;
}) {
  const [result, refetch] = useQuery<AgentLoopRunQueryData>({
    query: SettingsAgentLoopRunQuery,
    variables: { id: runId },
    requestPolicy: "cache-and-network",
  });

  const run = result.data?.agentLoopRun ?? null;
  const terminal = run ? TERMINAL_STATUSES.has(run.status.toLowerCase()) : true;
  const threadId =
    run?.threadId ??
    run?.iterations.find((iteration) => iteration.threadId)?.threadId ??
    null;

  useEffect(() => {
    if (terminal) return;
    const timer = setInterval(
      () => refetch({ requestPolicy: "network-only" }),
      5000,
    );
    return () => clearInterval(timer);
  }, [refetch, terminal]);

  usePageHeaderActions({
    title: run?.agentLoop?.name ?? "Automation run",
    breadcrumbs: [
      { label: "Automations", href: "/settings/automations" },
      {
        label: run?.agentLoop?.name ?? "Automation",
        href: `/settings/agent-loops/${agentLoopId}`,
      },
      { label: `Run ${runId.slice(0, 8)}` },
    ],
    action: run ? (
      <StatusBadge status={run.status.toLowerCase()} size="sm" />
    ) : undefined,
    actionKey: `agent-loop-run:${runId}:${run?.status ?? "loading"}`,
  });

  if (result.fetching && !run) {
    return (
      <div className="flex items-center justify-center py-24">
        <LoadingShimmer />
      </div>
    );
  }

  if (result.error || !run || run.agentLoopId !== agentLoopId) {
    return (
      <div className="w-full max-w-[750px] px-6 pb-10 pt-6">
        <InfoCard title="Automation run not found">
          <p className="text-sm text-muted-foreground">
            {result.error?.message ??
              "This run could not be loaded or does not belong to this automation."}
          </p>
        </InfoCard>
      </div>
    );
  }

  const waitingForHuman =
    run.status === "waiting_for_human" ||
    run.judgments.some(
      (judgment) => judgment.outcome === "needs_human_approval",
    );

  return (
    <div className="flex h-full min-h-0 w-full flex-col gap-4 overflow-y-auto p-6">
      {threadId ? (
        <InfoCard title="Thread conversation">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-muted-foreground">
              This automation run is executing in a Thread conversation.
            </p>
            <Button asChild type="button" variant="outline" size="sm">
              <Link to="/threads/$id" params={{ id: threadId }}>
                Open thread
              </Link>
            </Button>
          </div>
        </InfoCard>
      ) : null}

      {waitingForHuman ? (
        <InfoCard title="Waiting for human approval">
          <p className="text-sm text-muted-foreground">
            This run is paused for review. Approval and resume controls will
            appear here when review gates are enabled.
          </p>
        </InfoCard>
      ) : null}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(280px,360px)]">
        <InfoCard title="Run summary">
          <DefinitionList
            items={[
              {
                label: "Status",
                value: (
                  <StatusBadge status={run.status.toLowerCase()} size="sm" />
                ),
              },
              { label: "Trigger", value: titleize(run.triggerFamily) },
              { label: "Source", value: run.triggerSource ?? "-" },
              { label: "Iteration", value: run.currentIteration },
              { label: "Started", value: formatDateTime(run.startedAt) },
              {
                label: "Duration",
                value: formatDuration(run.startedAt, run.finishedAt),
              },
              { label: "Cost", value: formatCost(run.totalCostUsdCents) },
            ]}
          />
        </InfoCard>
        <InfoCard title="Version and policy">
          <DefinitionList
            items={[
              {
                label: "Version",
                value: run.agentLoopVersion?.versionNumber ?? "-",
              },
              { label: "Terminal reason", value: run.terminalReason ?? "-" },
              { label: "Correlation", value: run.correlationId ?? "-" },
              { label: "Idempotency", value: run.idempotencyKey ?? "-" },
              { label: "Scheduled job", value: run.scheduledJobId ?? "-" },
            ]}
          />
        </InfoCard>
      </div>

      {run.errorCode || run.errorMessage ? (
        <InfoCard title="Failure">
          <p className="text-sm text-destructive">
            {[run.errorCode, run.errorMessage].filter(Boolean).join(": ")}
          </p>
        </InfoCard>
      ) : null}

      <InfoCard title="Iterations">
        {run.iterations.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No iterations have been recorded yet.
          </p>
        ) : (
          <ol className="space-y-3">
            {run.iterations.map((iteration) => (
              <IterationCard key={iteration.id} iteration={iteration} />
            ))}
          </ol>
        )}
      </InfoCard>

      <InfoCard title="Judgments">
        {run.judgments.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No judgments have been recorded yet.
          </p>
        ) : (
          <div className="space-y-3">
            {run.judgments.map((judgment) => (
              <JudgmentCard key={judgment.id} judgment={judgment} />
            ))}
          </div>
        )}
      </InfoCard>

      <AgentLoopEvidencePanel evidence={run.evidence} />

      <div className="grid gap-4 xl:grid-cols-2">
        <InfoCard title="Input">
          <JsonPreview value={run.inputSummary} />
        </InfoCard>
        <InfoCard title="Output">
          <JsonPreview value={run.outputSummary} />
        </InfoCard>
        <InfoCard title="Policy snapshot">
          <JsonPreview value={run.policySnapshot} />
        </InfoCard>
        <InfoCard title="Version specs">
          <JsonPreview value={run.agentLoopVersion ?? null} />
        </InfoCard>
      </div>
    </div>
  );
}

function IterationCard({ iteration }: { iteration: AgentLoopIteration }) {
  return (
    <li className="rounded-md border border-border/70 p-3">
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <Badge variant="secondary" className="text-xs">
          Iteration {iteration.iterationNumber}
        </Badge>
        <StatusBadge status={iteration.status.toLowerCase()} size="sm" />
        <span className="text-xs text-muted-foreground">
          {formatDateTime(iteration.startedAt ?? iteration.createdAt)}
        </span>
      </div>
      <div className="mt-3 grid gap-3 md:grid-cols-2">
        <DefinitionList
          items={[
            { label: "Goal action", value: iteration.goalModeAction ?? "-" },
            {
              label: "Duration",
              value: formatDuration(iteration.startedAt, iteration.finishedAt),
            },
            { label: "Cost", value: formatCost(iteration.totalCostUsdCents) },
            { label: "Wakeup", value: iteration.agentWakeupRequestId ?? "-" },
          ]}
        />
        <div className="min-w-0 space-y-2">
          {iteration.threadTurnId ? (
            <div className="rounded-md border border-border/70 bg-muted/30 px-3 py-2">
              <div className="flex items-center justify-between gap-3">
                <div className="text-xs font-medium text-muted-foreground">
                  Thread turn
                </div>
                {iteration.threadId ? (
                  <Button asChild type="button" variant="ghost" size="sm">
                    <Link to="/threads/$id" params={{ id: iteration.threadId }}>
                      Open thread
                    </Link>
                  </Button>
                ) : null}
              </div>
              <div className="mt-1 break-all font-mono text-xs">
                {iteration.threadTurnId}
              </div>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              No linked thread turn yet.
            </p>
          )}
          {iteration.errorCode || iteration.errorMessage ? (
            <p className="text-sm text-destructive">
              {[iteration.errorCode, iteration.errorMessage]
                .filter(Boolean)
                .join(": ")}
            </p>
          ) : null}
        </div>
      </div>
      {iteration.judgments.length ? (
        <div className="mt-3 space-y-2">
          {iteration.judgments.map((judgment) => (
            <JudgmentCard key={judgment.id} judgment={judgment} compact />
          ))}
        </div>
      ) : null}
    </li>
  );
}

function JudgmentCard({
  judgment,
  compact,
}: {
  judgment: AgentLoopJudgment;
  compact?: boolean;
}) {
  return (
    <div className="rounded-md border border-border/70 p-3">
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <Badge variant="secondary" className="text-xs">
          {titleize(judgment.judgeMode)}
        </Badge>
        <Badge variant="outline" className="text-xs">
          {titleize(judgment.outcome)}
        </Badge>
        {judgment.confidence != null ? (
          <span className="text-xs text-muted-foreground">
            {judgment.confidence}% confidence
          </span>
        ) : null}
        <span className="text-xs text-muted-foreground">
          {formatDateTime(judgment.createdAt)}
        </span>
      </div>
      {judgment.rationale ? (
        <p className="mt-2 text-sm text-muted-foreground">
          {judgment.rationale}
        </p>
      ) : null}
      {judgment.terminalReason ? (
        <p className="mt-2 text-sm text-muted-foreground">
          Terminal reason: {judgment.terminalReason}
        </p>
      ) : null}
      {compact ? null : <JsonPreview value={judgment.structuredOutput} />}
    </div>
  );
}
