import { useState, useEffect, useCallback, useMemo } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery, useMutation, useSubscription } from "urql";
import { type ColumnDef } from "@tanstack/react-table";
import { Activity, ChevronDown, Loader2, Trash2, Square } from "lucide-react";
import { toast } from "sonner";

import { useTenant } from "@/context/TenantContext";
import { useBreadcrumbs } from "@/context/BreadcrumbContext";
import { PageHeader } from "@/components/PageHeader";
import { PageSkeleton } from "@/components/PageSkeleton";
import { DataTable } from "@/components/ui/data-table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { relativeTime } from "@/lib/utils";
import {
  EvalRunQuery,
  EvalRunResultsQuery,
  EvalResultSpansQuery,
  DeleteEvalRunMutation,
  CancelEvalRunMutation,
  OnEvalRunUpdatedSubscription,
} from "@/lib/graphql-queries";
import {
  deriveEvalFailureMode,
  expectedSummary,
  parseAssertions,
  parseEvaluatorResults,
  parseSpanAttributes,
  sortEvalSpans,
  type EvalSpanRow,
} from "./-result-detail";

export const Route = createFileRoute("/_authed/_tenant/evaluations/$runId")({
  component: EvalRunDetailPage,
});

interface EvalResultRow {
  id: string;
  testCaseId: string | null;
  testCaseName: string | null;
  category: string | null;
  status: string;
  score: number | null;
  durationMs: number | null;
  agentSessionId: string | null;
  input: string | null;
  expected: string | null;
  actualOutput: string | null;
  assertions: unknown;
  evaluatorResults: unknown;
  errorMessage: string | null;
  createdAt: string;
}

function statusBadge(status: string) {
  switch (status) {
    case "pass":
    case "completed":
      return (
        <Badge className="bg-green-600 hover:bg-green-600 text-white">
          {status}
        </Badge>
      );
    case "fail":
    case "failed":
      return <Badge variant="destructive">{status}</Badge>;
    case "running":
      return (
        <Badge variant="outline" className="gap-1">
          <Loader2 className="h-3 w-3 animate-spin" />
          running
        </Badge>
      );
    case "pending":
      return (
        <Badge variant="secondary" className="gap-1">
          <Loader2 className="h-3 w-3 animate-spin" />
          pending
        </Badge>
      );
    case "waiting":
      return (
        <Badge variant="secondary" className="text-muted-foreground">
          waiting
        </Badge>
      );
    default:
      return <Badge variant="secondary">{status}</Badge>;
  }
}

const resultColumns: ColumnDef<EvalResultRow>[] = [
  {
    accessorKey: "testCaseName",
    header: "Test Name",
    cell: ({ row }) => (
      <p
        className="text-sm font-medium truncate"
        title={row.original.testCaseName ?? ""}
      >
        {row.original.testCaseName ?? "(unnamed)"}
      </p>
    ),
  },
  {
    accessorKey: "category",
    header: "Category",
    size: 140,
    cell: ({ row }) =>
      row.original.category ? (
        <Badge variant="outline" className="text-xs whitespace-nowrap">
          {row.original.category}
        </Badge>
      ) : null,
  },
  {
    accessorKey: "status",
    header: "Status",
    size: 70,
    cell: ({ row }) => statusBadge(row.original.status),
  },
  {
    accessorKey: "score",
    header: "Score",
    size: 70,
    cell: ({ row }) => (
      <span className="text-right tabular-nums">
        {row.original.score != null
          ? Number(row.original.score).toFixed(2)
          : "—"}
      </span>
    ),
  },
  {
    accessorKey: "durationMs",
    header: "Duration",
    size: 90,
    cell: ({ row }) => (
      <span className="text-right text-xs text-muted-foreground tabular-nums">
        {row.original.durationMs != null ? `${row.original.durationMs}ms` : "—"}
      </span>
    ),
  },
];

function EvalRunDetailPage() {
  const { runId } = Route.useParams();
  const { tenantId } = useTenant();
  const navigate = useNavigate();
  const [selectedResultId, setSelectedResultId] = useState<string | null>(null);
  const [categoryFilter, setCategoryFilter] = useState<string | null>(null);

  const [, deleteRun] = useMutation(DeleteEvalRunMutation);
  const [{ fetching: cancelling }, cancelRun] = useMutation(
    CancelEvalRunMutation,
  );

  const [runResult, refetchRun] = useQuery({
    query: EvalRunQuery,
    variables: { id: runId },
    pause: !runId,
    requestPolicy: "cache-and-network",
  });
  const [resultsResult, refetchResults] = useQuery({
    query: EvalRunResultsQuery,
    variables: { runId },
    pause: !runId,
    requestPolicy: "cache-and-network",
  });

  const silentRefetch = useCallback(() => {
    refetchRun({ requestPolicy: "network-only" });
    refetchResults({ requestPolicy: "network-only" });
  }, [refetchRun, refetchResults]);

  // Live updates via subscription
  const [evalSub] = useSubscription({
    query: OnEvalRunUpdatedSubscription,
    variables: { tenantId },
    pause: !tenantId,
  });
  useEffect(() => {
    if (
      (evalSub.data as { onEvalRunUpdated?: { runId?: string } } | undefined)
        ?.onEvalRunUpdated?.runId === runId
    ) {
      silentRefetch();
    }
  }, [evalSub.data, runId, silentRefetch]);

  // Poll every 3s while running
  const runDetail = runResult.data?.evalRun;
  const isRunning =
    runDetail?.status === "pending" || runDetail?.status === "running";
  useEffect(() => {
    if (!isRunning) return;
    const interval = setInterval(silentRefetch, 3000);
    return () => clearInterval(interval);
  }, [isRunning, silentRefetch]);

  useBreadcrumbs([
    { label: "Evaluations", href: "/evaluations" },
    { label: "Run Results" },
  ]);

  const runResults: EvalResultRow[] = resultsResult.data?.evalRunResults ?? [];

  const categories = useMemo(
    () =>
      Array.from(
        new Set(runResults.map((r) => r.category).filter(Boolean)),
      ) as string[],
    [runResults],
  );

  const categoryPassRates = useMemo(() => {
    const map: Record<string, number> = {};
    for (const cat of categories) {
      const catResults = runResults.filter(
        (r) => r.category === cat && r.status !== "waiting",
      );
      const catPassed = catResults.filter((r) => r.status === "pass").length;
      map[cat] = catResults.length > 0 ? catPassed / catResults.length : -1;
    }
    return map;
  }, [categories, runResults]);

  const filteredResults = categoryFilter
    ? runResults.filter((r) => r.category === categoryFilter)
    : runResults;

  const handleDelete = async () => {
    const result = await deleteRun({ id: runId });
    if (result.error) toast.error("Failed to delete: " + result.error.message);
    else {
      toast.success("Evaluation deleted");
      navigate({ to: "/evaluations" });
    }
  };

  const handleCancel = async () => {
    const result = await cancelRun({ id: runId });
    if (result.error) toast.error("Failed to cancel: " + result.error.message);
    else toast.success("Evaluation cancelled");
  };

  if (runResult.fetching && !runDetail) return <PageSkeleton />;
  if (!runDetail) return <div className="p-6">Run not found.</div>;

  const completed = (runDetail.passed ?? 0) + (runDetail.failed ?? 0);
  const passRate =
    completed > 0
      ? `${(((runDetail.passed ?? 0) / completed) * 100).toFixed(1)}%`
      : "—";
  const dateLabel = runDetail.completedAt
    ? relativeTime(runDetail.completedAt)
    : runDetail.startedAt
      ? relativeTime(runDetail.startedAt)
      : "";

  return (
    <div className="flex flex-col h-[calc(100vh-6.5rem)]">
      <div className="shrink-0 space-y-4 pb-4">
        <PageHeader
          title="Run Results"
          description={[
            runDetail.agentTemplateName ?? runDetail.agentName,
            `${runDetail.passed ?? 0} passed, ${runDetail.failed ?? 0} failed of ${runDetail.totalTests ?? 0} tests`,
          ]
            .filter(Boolean)
            .join(" — ")}
          actions={
            <div className="flex items-center gap-2">
              {statusBadge(runDetail.status)}
              <span className="text-sm text-muted-foreground tabular-nums">
                {passRate} pass rate
              </span>
              {runDetail.costUsd != null && Number(runDetail.costUsd) > 0 && (
                <span className="text-xs text-muted-foreground tabular-nums">
                  ${Number(runDetail.costUsd).toFixed(4)}
                </span>
              )}
              {dateLabel && (
                <span className="text-xs text-muted-foreground">
                  {dateLabel}
                </span>
              )}
              {isRunning ? (
                <Button
                  variant="ghost"
                  size="icon"
                  className="text-muted-foreground hover:text-destructive h-8 w-8"
                  onClick={handleCancel}
                  disabled={cancelling}
                >
                  {cancelling ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Square className="h-4 w-4" />
                  )}
                </Button>
              ) : (
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="text-muted-foreground hover:text-destructive h-8 w-8"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Delete Evaluation Run</AlertDialogTitle>
                      <AlertDialogDescription>
                        This will permanently delete this evaluation run and all
                        its test results. This action cannot be undone.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <AlertDialogAction
                        onClick={handleDelete}
                        className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                      >
                        Delete
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              )}
            </div>
          }
        />

        {/* Category filter badges — color-coded by per-category pass rate */}
        {categories.length > 0 && (
          <div className="flex flex-wrap gap-2">
            <Badge
              variant={categoryFilter === null ? "default" : "outline"}
              className="cursor-pointer"
              onClick={() => setCategoryFilter(null)}
            >
              All
            </Badge>
            {categories.map((cat) => {
              const rate = categoryPassRates[cat] ?? -1;
              const isSelected = categoryFilter === cat;
              let colorClass = "";
              if (rate >= 0) {
                if (isSelected) {
                  if (rate >= 0.9)
                    colorClass =
                      "bg-green-600 hover:bg-green-600 text-white border-green-600";
                  else if (rate >= 0.7)
                    colorClass =
                      "bg-yellow-500 hover:bg-yellow-500 text-black border-yellow-500";
                  else
                    colorClass =
                      "bg-red-600 hover:bg-red-600 text-white border-red-600";
                } else {
                  if (rate >= 0.9)
                    colorClass = "border-green-600 text-green-500";
                  else if (rate >= 0.7)
                    colorClass = "border-yellow-600 text-yellow-500";
                  else colorClass = "border-red-600 text-red-500";
                }
              }
              const pct = rate >= 0 ? ` ${(rate * 100).toFixed(0)}%` : "";
              return (
                <Badge
                  key={cat}
                  variant={isSelected && rate < 0 ? "default" : "outline"}
                  className={`cursor-pointer ${colorClass}`}
                  onClick={() =>
                    setCategoryFilter(cat === categoryFilter ? null : cat)
                  }
                >
                  {cat}
                  {pct}
                </Badge>
              );
            })}
          </div>
        )}
      </div>

      <div className="flex-1 min-h-0">
        <DataTable
          columns={resultColumns}
          data={filteredResults}
          pageSize={25}
          tableClassName="table-fixed"
          scrollable
          onRowClick={(result) => setSelectedResultId(result.id)}
        />
      </div>

      <ResultDetailSheet
        runId={runId}
        result={runResults.find((r) => r.id === selectedResultId)}
        open={!!selectedResultId}
        onOpenChange={(open) => {
          if (!open) setSelectedResultId(null);
        }}
      />
    </div>
  );
}

function ResultDetailSheet({
  runId,
  result,
  open,
  onOpenChange,
}: {
  runId: string;
  result: EvalResultRow | undefined;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [showTrace, setShowTrace] = useState(false);
  const traceEnabled = Boolean(open && showTrace && result?.testCaseId);
  const [traceResult] = useQuery({
    query: EvalResultSpansQuery,
    variables: { runId, testCaseId: result?.testCaseId ?? "" },
    pause: !traceEnabled,
    requestPolicy: "network-only",
  });

  useEffect(() => {
    setShowTrace(false);
  }, [result?.id]);

  if (!result) return null;

  const assertions = parseAssertions(result.assertions);
  const evaluatorResults = parseEvaluatorResults(result.evaluatorResults);
  const failureMode = deriveEvalFailureMode(result);
  const expected = expectedSummary(assertions);
  const spans = sortEvalSpans(
    ((traceResult.data?.evalResultSpans ?? []) as EvalSpanRow[]).map(
      (span) => ({
        ...span,
        attributes: parseSpanAttributes(span.attributes),
      }),
    ),
  );

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="sm:max-w-2xl overflow-y-auto">
        <SheetHeader className="px-6 pt-6">
          <SheetTitle className="text-base leading-snug">
            {result.testCaseName ?? "(unnamed)"}
          </SheetTitle>
        </SheetHeader>
        <div className="space-y-4 px-6 pb-6">
          <div className="flex items-center gap-2">
            {statusBadge(result.status)}
            {result.category && (
              <Badge variant="outline">{result.category}</Badge>
            )}
            {failureMode && (
              <Badge
                variant={failureMode === "timeout" ? "outline" : "destructive"}
              >
                {failureMode}
              </Badge>
            )}
            {result.score != null && (
              <span className="text-sm text-muted-foreground tabular-nums">
                Score: {Number(result.score).toFixed(2)}
              </span>
            )}
            {result.durationMs != null && (
              <span className="text-sm text-muted-foreground tabular-nums">
                {result.durationMs}ms
              </span>
            )}
          </div>

          {result.input && (
            <div>
              <h4 className="text-sm font-medium mb-1">Input</h4>
              <pre className="text-xs bg-muted/50 rounded-md p-3 overflow-x-auto whitespace-pre-wrap">
                {result.input}
              </pre>
            </div>
          )}

          {expected && (
            <div>
              <h4 className="text-sm font-medium mb-1">Expected</h4>
              <pre className="text-xs bg-muted/50 rounded-md p-3 overflow-x-auto whitespace-pre-wrap">
                {expected}
              </pre>
            </div>
          )}

          {result.actualOutput && (
            <div>
              <h4 className="text-sm font-medium mb-1">Actual Output</h4>
              <pre className="text-xs bg-muted/50 rounded-md p-3 overflow-x-auto whitespace-pre-wrap max-h-96">
                {result.actualOutput}
              </pre>
            </div>
          )}

          {assertions.length > 0 && (
            <div>
              <h4 className="text-sm font-medium mb-1">Assertions</h4>
              <pre className="text-xs bg-muted/50 rounded-md p-3 overflow-x-auto whitespace-pre-wrap">
                {JSON.stringify(assertions, null, 2)}
              </pre>
            </div>
          )}

          {evaluatorResults.length > 0 && (
            <div>
              <h4 className="text-sm font-medium mb-2">Evaluator Results</h4>
              <div className="space-y-2">
                {evaluatorResults.map((evaluator, index) => {
                  const score =
                    typeof evaluator.value === "number"
                      ? evaluator.value
                      : null;
                  const passed = score !== null && score >= 0.7;
                  return (
                    <div
                      key={`${evaluator.evaluator_id ?? evaluator.evaluatorId ?? index}`}
                      className="rounded-md border bg-background p-3"
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium">
                            {evaluator.evaluator_id ??
                              evaluator.evaluatorId ??
                              "Evaluator"}
                          </p>
                          {evaluator.label && (
                            <p className="text-xs text-muted-foreground">
                              {evaluator.label}
                            </p>
                          )}
                        </div>
                        <Badge
                          variant={passed ? "default" : "destructive"}
                          className="shrink-0 tabular-nums"
                        >
                          {score !== null ? score.toFixed(2) : "error"}
                        </Badge>
                      </div>
                      {evaluator.explanation && (
                        <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                          {evaluator.explanation}
                        </p>
                      )}
                      {evaluator.error && (
                        <p className="mt-2 text-xs text-destructive">
                          {evaluator.error}
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          <div>
            <div className="flex items-center justify-between gap-3">
              <h4 className="text-sm font-medium">Trace</h4>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-8 gap-2"
                disabled={!result.testCaseId}
                onClick={() => setShowTrace((value) => !value)}
              >
                {traceResult.fetching ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Activity className="h-3.5 w-3.5" />
                )}
                {showTrace ? "Hide trace" : "Show trace"}
                <ChevronDown
                  className={`h-3.5 w-3.5 transition-transform ${showTrace ? "rotate-180" : ""}`}
                />
              </Button>
            </div>
            {showTrace && (
              <div className="mt-2 space-y-2">
                {traceResult.error ? (
                  <div className="rounded border border-destructive/30 bg-destructive/5 p-3 text-xs text-destructive">
                    Trace unavailable
                  </div>
                ) : traceResult.fetching ? (
                  <div className="flex items-center gap-2 rounded-md border bg-muted/30 p-3 text-xs text-muted-foreground">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    Loading trace
                  </div>
                ) : spans.length === 0 ? (
                  <div className="rounded-md border bg-muted/30 p-3 text-xs text-muted-foreground">
                    No spans found
                  </div>
                ) : (
                  <div className="space-y-2">
                    {spans.map((span, index) => (
                      <div
                        key={`${span.timestamp ?? "untimed"}-${span.name}-${index}`}
                        className="rounded-md border bg-muted/30 p-3"
                      >
                        <div className="flex items-center justify-between gap-3">
                          <p className="truncate text-xs font-medium">
                            {span.name}
                          </p>
                          {span.timestamp && (
                            <span className="shrink-0 text-[11px] text-muted-foreground tabular-nums">
                              {new Date(span.timestamp).toLocaleTimeString()}
                            </span>
                          )}
                        </div>
                        <pre className="mt-2 max-h-48 overflow-auto text-[11px] leading-relaxed text-muted-foreground">
                          {JSON.stringify(span.attributes, null, 2)}
                        </pre>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {result.errorMessage && (
            <div className="rounded border border-destructive/30 bg-destructive/5 p-3 text-xs text-destructive">
              {result.errorMessage}
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
