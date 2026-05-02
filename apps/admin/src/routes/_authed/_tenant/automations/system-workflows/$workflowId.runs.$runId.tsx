import { useEffect, useMemo } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "urql";
import { ArrowLeft } from "lucide-react";
import { useBreadcrumbs } from "@/context/BreadcrumbContext";
import { PageHeader } from "@/components/PageHeader";
import { PageLayout } from "@/components/PageLayout";
import { PageSkeleton } from "@/components/PageSkeleton";
import { StatusBadge } from "@/components/StatusBadge";
import { Button } from "@/components/ui/button";
import { SystemWorkflowRunDetailQuery } from "@/lib/graphql-queries";
import { formatDateTime } from "@/lib/utils";

export const Route = createFileRoute(
  "/_authed/_tenant/automations/system-workflows/$workflowId/runs/$runId",
)({
  component: SystemWorkflowRunDetailPage,
});

const TERMINAL_STATUSES = new Set([
  "succeeded",
  "failed",
  "cancelled",
  "timed_out",
]);

function stringifyJson(value: unknown): string {
  if (value == null) return "—";
  if (typeof value === "string") return value;
  return JSON.stringify(value, null, 2);
}

function SystemWorkflowRunDetailPage() {
  const { workflowId, runId } = Route.useParams();
  const [{ data, fetching, error }, refetch] = useQuery({
    query: SystemWorkflowRunDetailQuery,
    variables: { id: runId },
    requestPolicy: "cache-and-network",
  });

  const run = data?.systemWorkflowRun;
  const workflow = run?.workflow;
  const isTerminal = run ? TERMINAL_STATUSES.has(run.status) : false;

  useEffect(() => {
    if (isTerminal || !runId) return;
    const timer = setInterval(
      () => refetch({ requestPolicy: "network-only" }),
      5000,
    );
    return () => clearInterval(timer);
  }, [isTerminal, refetch, runId]);

  useBreadcrumbs(
    workflow
      ? [
          {
            label: "System Workflows",
            href: "/automations/system-workflows",
          },
          {
            label: workflow.name,
            href: `/automations/system-workflows/${workflowId}`,
          },
          { label: `Run ${runId.slice(0, 8)}` },
        ]
      : [{ label: "System Workflows", href: "/automations/system-workflows" }],
  );

  const sortedEvents = useMemo(
    () =>
      [...(run?.stepEvents ?? [])].sort((a, b) =>
        (a.startedAt ?? a.createdAt).localeCompare(b.startedAt ?? b.createdAt),
      ),
    [run?.stepEvents],
  );

  if (fetching && !run) return <PageSkeleton />;
  if (error || !run) {
    return (
      <PageLayout
        header={
          <PageHeader
            title="System Workflow run not found"
            description={error?.message ?? "No run row matches that id."}
          />
        }
      />
    );
  }

  return (
    <PageLayout
      header={
        <PageHeader
          title={workflow?.name ?? "System Workflow run"}
          description={`Run ${run.id.slice(0, 8)} · ${run.triggerSource}`}
          actions={<StatusBadge status={run.status.toLowerCase()} />}
        />
      }
    >
      <div className="mb-4">
        <Button variant="ghost" size="sm" asChild>
          <Link
            to="/automations/system-workflows/$workflowId"
            params={{ workflowId }}
          >
            <ArrowLeft className="h-4 w-4" />
            Back to workflow
          </Link>
        </Button>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <section className="space-y-3 rounded-md border p-4">
          <h2 className="text-sm font-semibold">Run</h2>
          <dl className="grid gap-2 text-sm">
            <div className="flex justify-between gap-4">
              <dt className="text-muted-foreground">Definition</dt>
              <dd>{run.definitionVersion}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-muted-foreground">Runtime</dt>
              <dd>{run.runtimeShape.replace(/_/g, " ")}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-muted-foreground">Started</dt>
              <dd>{run.startedAt ? formatDateTime(run.startedAt) : "—"}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-muted-foreground">Finished</dt>
              <dd>{run.finishedAt ? formatDateTime(run.finishedAt) : "—"}</dd>
            </div>
          </dl>
        </section>

        <section className="space-y-3 rounded-md border p-4 lg:col-span-2">
          <h2 className="text-sm font-semibold">Evidence Summary</h2>
          <pre className="max-h-48 overflow-auto rounded bg-muted p-3 text-xs">
            {stringifyJson(run.evidenceSummaryJson)}
          </pre>
        </section>
      </div>

      <section className="mt-6 space-y-3 rounded-md border p-4">
        <h2 className="text-sm font-semibold">Step Events</h2>
        <div className="divide-y rounded-md border">
          {sortedEvents.map((event) => (
            <div
              key={event.id}
              className="grid gap-2 p-3 text-sm md:grid-cols-[180px_1fr_120px]"
            >
              <div>
                <div className="font-medium">{event.nodeId}</div>
                <div className="text-xs text-muted-foreground">
                  {event.stepType}
                </div>
              </div>
              <div className="text-xs text-muted-foreground">
                {event.startedAt ? formatDateTime(event.startedAt) : "—"}
                {event.finishedAt
                  ? ` → ${formatDateTime(event.finishedAt)}`
                  : ""}
              </div>
              <StatusBadge status={event.status.toLowerCase()} size="sm" />
            </div>
          ))}
          {sortedEvents.length === 0 && (
            <div className="p-6 text-sm text-muted-foreground">
              No step events recorded yet.
            </div>
          )}
        </div>
      </section>

      <section className="mt-6 space-y-3 rounded-md border p-4">
        <h2 className="text-sm font-semibold">Evidence</h2>
        <div className="divide-y rounded-md border">
          {run.evidence.map((item) => (
            <div key={item.id} className="space-y-1 p-3 text-sm">
              <div className="font-medium">{item.title}</div>
              <div className="text-xs text-muted-foreground">
                {item.summary ?? item.evidenceType}
              </div>
              {item.artifactUri && (
                <div className="text-xs text-muted-foreground">
                  {item.artifactUri}
                </div>
              )}
            </div>
          ))}
          {run.evidence.length === 0 && (
            <div className="p-6 text-sm text-muted-foreground">
              No evidence artifacts recorded yet.
            </div>
          )}
        </div>
      </section>
    </PageLayout>
  );
}
