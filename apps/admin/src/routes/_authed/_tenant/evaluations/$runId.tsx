import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useSubscription } from "urql";

import { useTenant } from "@/context/TenantContext";
import { useBreadcrumbs } from "@/context/BreadcrumbContext";
import { PageHeader } from "@/components/PageHeader";
import { PageLayout } from "@/components/PageLayout";
import { PageSkeleton } from "@/components/PageSkeleton";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { relativeTime } from "@/lib/utils";
import { EvalRunQuery, EvalRunResultsQuery, OnEvalRunUpdatedSubscription } from "@/lib/graphql-queries";

export const Route = createFileRoute("/_authed/_tenant/evaluations/$runId")({
  component: EvalRunDetailPage,
});

function EvalRunDetailPage() {
  const { runId } = Route.useParams();
  const { tenantId } = useTenant();
  useBreadcrumbs([
    { label: "Evaluations", href: "/evaluations" },
    { label: `Run ${runId.slice(0, 8)}` },
  ]);

  const [run, refetchRun] = useQuery({ query: EvalRunQuery, variables: { id: runId }, pause: !runId });
  const [results, refetchResults] = useQuery({ query: EvalRunResultsQuery, variables: { runId }, pause: !runId });

  // Live-update on subscription pings.
  useSubscription({
    query: OnEvalRunUpdatedSubscription,
    variables: { tenantId },
    pause: !tenantId,
  }, () => {
    refetchRun({ requestPolicy: "network-only" });
    refetchResults({ requestPolicy: "network-only" });
    return null;
  });

  if (run.fetching || !run.data) return <PageSkeleton />;
  const r = run.data.evalRun;
  if (!r) return <div className="p-6">Run not found.</div>;

  const items = results.data?.evalRunResults ?? [];
  const fmtPct = (n?: number | null) => (typeof n === "number" ? `${(n * 100).toFixed(1)}%` : "—");

  return (
    <PageLayout
      header={
        <PageHeader
          title={`Run ${r.id.slice(0, 8)}`}
          description={`${r.status} · ${r.passed}/${r.totalTests} passed`}
        />
      }
    >
      <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle>Run summary</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm md:grid-cols-4">
            <div>
              <dt className="text-muted-foreground">Status</dt>
              <dd>
                <Badge variant={r.status === "completed" ? "default" : r.status === "failed" ? "destructive" : "secondary"}>{r.status}</Badge>
                {r.regression && <Badge variant="destructive" className="ml-1">regression</Badge>}
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Pass rate</dt>
              <dd className="font-medium tabular-nums">{fmtPct(r.passRate)}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Cost</dt>
              <dd className="font-medium tabular-nums">{r.costUsd ? `$${Number(r.costUsd).toFixed(4)}` : "—"}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Model</dt>
              <dd className="text-xs">{r.model ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Categories</dt>
              <dd className="text-xs">{r.categories?.join(", ") || "all"}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Agent</dt>
              <dd className="text-xs">{r.agentName ?? r.agentId ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Started</dt>
              <dd className="text-xs">{r.startedAt ? relativeTime(r.startedAt) : "—"}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Completed</dt>
              <dd className="text-xs">{r.completedAt ? relativeTime(r.completedAt) : "—"}</dd>
            </div>
          </dl>
          {r.errorMessage && (
            <div className="mt-3 rounded border border-destructive/30 bg-destructive/5 p-3 text-xs text-destructive">
              {r.errorMessage}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Per-test results ({items.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {items.length === 0 ? (
            <div className="py-8 text-center text-sm text-muted-foreground">
              {r.status === "running" || r.status === "pending" ? "Waiting for results…" : "No results recorded."}
            </div>
          ) : (
            <div className="space-y-2">
              {items.map((item: any) => {
                let evaluatorList: any[] = [];
                let assertionList: any[] = [];
                try { evaluatorList = JSON.parse(item.evaluatorResults || "[]"); } catch {}
                try { assertionList = JSON.parse(item.assertions || "[]"); } catch {}
                return (
                  <Collapsible key={item.id} className="rounded-md border">
                    <CollapsibleTrigger className="flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-muted/50">
                      <Badge variant={item.status === "pass" ? "default" : "destructive"}>{item.status}</Badge>
                      <span className="flex-1 font-medium">{item.testCaseName ?? "(unnamed)"}</span>
                      <span className="text-xs text-muted-foreground">{item.category ?? ""}</span>
                      <span className="tabular-nums text-sm">{fmtPct(item.score)}</span>
                    </CollapsibleTrigger>
                    <CollapsibleContent className="space-y-3 border-t px-3 py-3 text-sm">
                      <div>
                        <div className="text-xs font-medium text-muted-foreground">Input</div>
                        <pre className="whitespace-pre-wrap rounded bg-muted p-2 text-xs">{item.input || "—"}</pre>
                      </div>
                      <div>
                        <div className="text-xs font-medium text-muted-foreground">Output</div>
                        <pre className="whitespace-pre-wrap rounded bg-muted p-2 text-xs">{item.actualOutput || "—"}</pre>
                      </div>
                      {evaluatorList.length > 0 && (
                        <div>
                          <div className="text-xs font-medium text-muted-foreground">Evaluators</div>
                          <ul className="mt-1 space-y-1">
                            {evaluatorList.map((e, i) => (
                              <li key={i} className="rounded bg-muted/50 p-2 text-xs">
                                <div className="flex items-center justify-between">
                                  <span className="font-medium">{e.evaluator_id}</span>
                                  <span className="tabular-nums">{typeof e.value === "number" ? e.value.toFixed(2) : "—"} {e.label && `· ${e.label}`}</span>
                                </div>
                                {e.explanation && <div className="mt-1 text-muted-foreground">{e.explanation}</div>}
                                {e.error && <div className="mt-1 text-destructive">error: {e.error}</div>}
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                      {assertionList.length > 0 && (
                        <div>
                          <div className="text-xs font-medium text-muted-foreground">Assertions</div>
                          <ul className="mt-1 space-y-1">
                            {assertionList.map((a, i) => (
                              <li key={i} className="text-xs">
                                <Badge variant={a.passed ? "default" : "destructive"} className="mr-1">{a.passed ? "✓" : "✗"}</Badge>
                                <span className="font-mono">{a.type}</span>
                                {a.value && <span className="ml-1 text-muted-foreground">{JSON.stringify(a.value)}</span>}
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                      {item.errorMessage && (
                        <div className="rounded border border-destructive/30 bg-destructive/5 p-2 text-xs text-destructive">
                          {item.errorMessage}
                        </div>
                      )}
                    </CollapsibleContent>
                  </Collapsible>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
      </div>
    </PageLayout>
  );
}
