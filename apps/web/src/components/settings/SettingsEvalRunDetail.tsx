import {
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import { useNavigate, useParams } from "@tanstack/react-router";
import { useMutation, useQuery, useSubscription } from "urql";
import { type ColumnDef } from "@tanstack/react-table";
import {
  Activity,
  AlertTriangle,
  ChevronDown,
  Database,
  FileText,
  GitCompareArrows,
  History,
  Loader2,
  Pencil,
  Square,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";

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
  Badge,
  Button,
  DataTable,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  Textarea,
} from "@thinkwork/ui";
import { usePageHeaderActions } from "@/context/PageHeaderContext";
import { useTenant } from "@/context/TenantContext";
import { EvalTestCaseForm } from "@/components/settings/EvalTestCaseForm";
import { SystemPromptSheet } from "@/components/SystemPromptSheet";
import { LoadingShimmer } from "@/components/LoadingShimmer";
import {
  CancelEvalRunMutation,
  DeleteEvalRunMutation,
  EvalDatasetsQuery,
  EvalResultSpansQuery,
  EvalRunQuery,
  EvalRunResultsQuery,
  EvalRunsQuery,
  EvalTestCaseQuery,
  OnEvalRunUpdatedSubscription,
  OverrideEvalResultMutation,
} from "@/lib/evaluation-queries";
import { cn, relativeTime } from "@/lib/utils";
import {
  canEditEvalResult,
  computeEvalRunComparison,
  countEvalVerdictGroups,
  deriveEvalFailureMode,
  evalErrorCauseBreakdown,
  evalErrorCauseDescription,
  evalErrorCauseLabel,
  evalFailureModeDescription,
  evalFailureModeLabel,
  evalResultVerdictGroup,
  evalRunPassRateDisplay,
  evalRunTransitionLabel,
  evaluatorDisplayStatus,
  expectedSummary,
  openEvalResultEditor,
  isDesktopPiEvalRunProvenance,
  parseAssertions,
  parseEvaluatorResults,
  parseSpanAttributes,
  sortEvalSpans,
  type EvalRunTransition,
  type EvalSpanRow,
  type EvalVerdictGroup,
} from "@/components/settings/eval-result-detail";

const EVAL_RESULT_SHEET_WIDTH_CLASS = "data-[side=right]:max-w-none";
const EVAL_RESULT_SHEET_STYLE = {
  width: "min(750px, calc(100vw - 2rem))",
  maxWidth: "none",
};

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
  systemPrompt: string | null;
  assertions: unknown;
  evaluatorResults: unknown;
  errorMessage: string | null;
  // Why an error-status row errored (Trust Core U2): timeout | throttle |
  // evaluator_error | reconciler | infra_other. Error rows render by
  // cause, never by score.
  errorCause: string | null;
  // Operator verdict override (Trust Core U9). The judge's verdict stays
  // in `status`; `effectiveStatus` (override ?? status) is what
  // aggregation counts and what the UI displays.
  overrideStatus: string | null;
  overriddenBy: string | null;
  overriddenAt: string | null;
  overrideReason: string | null;
  effectiveStatus: string;
  createdAt: string;
}

type CategoryPassRateResult = Pick<EvalResultRow, "category" | "status"> & {
  effectiveStatus?: string | null;
};

// Errors never score (Trust Core U2): error rows are infra noise and
// stay out of the per-category denominators, matching the run-level
// clean-execution pass rate.
function isScoredResultStatus(status: string): boolean {
  return ["pass", "fail", "completed", "failed"].includes(status);
}

function isPassingResultStatus(status: string): boolean {
  return status === "pass" || status === "completed";
}

export function calculateCategoryPassRates(
  results: CategoryPassRateResult[],
): Record<string, number> {
  const totals = new Map<string, { passed: number; completed: number }>();

  for (const result of results) {
    // Operator overrides correct the per-category rates too.
    const status = result.effectiveStatus ?? result.status;
    if (!result.category || !isScoredResultStatus(status)) continue;

    const current = totals.get(result.category) ?? { passed: 0, completed: 0 };
    current.completed += 1;
    if (isPassingResultStatus(status)) current.passed += 1;
    totals.set(result.category, current);
  }

  return Object.fromEntries(
    [...totals.entries()].map(([category, total]) => [
      category,
      total.completed > 0 ? total.passed / total.completed : -1,
    ]),
  );
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
    case "error":
      // Infra noise, not behavior — visually distinct from fail and
      // excluded from the score.
      return (
        <Badge
          variant="outline"
          className="gap-1 border-amber-500/50 text-amber-600 dark:text-amber-400"
        >
          <AlertTriangle className="h-3 w-3" />
          error
        </Badge>
      );
    case "cancelled":
      return (
        <Badge
          variant="outline"
          className="text-muted-foreground line-through decoration-1"
        >
          cancelled
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
    cell: ({ row }) => (
      <div className="flex items-center gap-1">
        {statusBadge(row.original.effectiveStatus ?? row.original.status)}
        {row.original.overrideStatus && (
          <Badge
            variant="outline"
            className="text-[10px] text-muted-foreground"
            title={`Judge verdict: ${row.original.status}`}
          >
            overridden
          </Badge>
        )}
      </div>
    ),
  },
  {
    accessorKey: "score",
    header: "Score",
    size: 70,
    cell: ({ row }) => {
      // Error rows render by cause, never by score — the stored score on
      // an error row is a pinned quirk, not a verdict.
      if (row.original.status === "error") {
        return (
          <span className="text-xs text-amber-600 dark:text-amber-400 whitespace-nowrap">
            {evalErrorCauseLabel(row.original.errorCause)}
          </span>
        );
      }
      return (
        <span className="text-right tabular-nums">
          {row.original.score != null
            ? Number(row.original.score).toFixed(2)
            : "—"}
        </span>
      );
    },
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

export function SettingsEvalRunDetail() {
  const { runId } = useParams({
    from: "/_authed/settings/evaluations/$runId",
  });
  const { tenantId } = useTenant();
  const navigate = useNavigate();
  const [selectedResultId, setSelectedResultId] = useState<string | null>(null);
  const [editingTestCaseId, setEditingTestCaseId] = useState<string | null>(
    null,
  );
  const [categoryFilter, setCategoryFilter] = useState<string | null>(null);
  // Verdict filter (Trust Core U11): errors grouped apart from
  // behavioral failures. Combines with the category filter.
  const [verdictFilter, setVerdictFilter] = useState<EvalVerdictGroup | null>(
    null,
  );
  const [compareOpen, setCompareOpen] = useState(false);

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
    variables: { tenantId: tenantId ?? "" },
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
  const isLegacyDesktopRun = runDetail
    ? isDesktopPiEvalRunProvenance(runDetail)
    : false;
  const isRunning =
    runDetail?.status === "pending" || runDetail?.status === "running";
  useEffect(() => {
    if (!isRunning) return;
    const interval = setInterval(silentRefetch, 3000);
    return () => clearInterval(interval);
  }, [isRunning, silentRefetch]);

  const runResults = (resultsResult.data?.evalRunResults ??
    []) as unknown as EvalResultRow[];

  const categories = useMemo(
    () =>
      Array.from(
        new Set(runResults.map((r) => r.category).filter(Boolean)),
      ) as string[],
    [runResults],
  );

  const categoryPassRates = useMemo(() => {
    return calculateCategoryPassRates(runResults);
  }, [runResults]);

  const verdictCounts = useMemo(
    () => countEvalVerdictGroups(runResults),
    [runResults],
  );
  const errorBreakdown = useMemo(
    () => evalErrorCauseBreakdown(runResults),
    [runResults],
  );

  const filteredResults = runResults.filter(
    (r) =>
      (!categoryFilter || r.category === categoryFilter) &&
      (!verdictFilter || evalResultVerdictGroup(r) === verdictFilter),
  );

  const handleDelete = useCallback(async () => {
    const result = await deleteRun({ id: runId });
    if (result.error) toast.error("Failed to delete: " + result.error.message);
    else {
      toast.success("Evaluation deleted");
      navigate({ to: "/settings/evaluations" });
    }
  }, [deleteRun, navigate, runId]);

  const handleCancel = useCallback(async () => {
    const result = await cancelRun({ id: runId });
    if (result.error) toast.error("Failed to cancel: " + result.error.message);
    else toast.success("Evaluation cancelled");
  }, [cancelRun, runId]);

  // Score over clean executions (server-computed, override-corrected).
  // Null pass rate on a terminal run renders "No score" — never 0%.
  const passRate = runDetail ? evalRunPassRateDisplay(runDetail) : "—";
  // Dataset-pinned runs (Trust Core U6) show the dataset name + pinned
  // version in the header. includeArchived so archived datasets still
  // label their historical runs.
  const [datasetsResult] = useQuery({
    query: EvalDatasetsQuery,
    variables: { tenantId: tenantId ?? "", includeArchived: true },
    pause: !tenantId || !runDetail?.datasetId,
  });
  const runDataset = runDetail?.datasetId
    ? (datasetsResult.data?.evalDatasets ?? []).find(
        (dataset) => dataset.id === runDetail.datasetId,
      )
    : undefined;
  const dateLabel = runDetail?.completedAt
    ? relativeTime(runDetail.completedAt)
    : runDetail?.startedAt
      ? relativeTime(runDetail.startedAt)
      : "";

  usePageHeaderActions({
    title: "Run Results",
    breadcrumbs: [
      { label: "Evaluations", href: "/settings/evaluations" },
      { label: `Run ${runId.slice(0, 8)}` },
    ],
    subtitle: runDetail
      ? [
          runDetail.agentName,
          `${runDetail.passed ?? 0} passed, ${runDetail.failed ?? 0} failed${
            (runDetail.errored ?? 0) > 0 ? `, ${runDetail.errored} errored` : ""
          } of ${runDetail.totalTests ?? 0} tests`,
        ]
          .filter(Boolean)
          .join(" — ")
      : undefined,
    action: runDetail ? (
      <div className="flex items-center gap-2">
        {statusBadge(runDetail.status)}
        {isLegacyDesktopRun && (
          <Badge
            variant="secondary"
            className="gap-1 bg-slate-500/15 text-slate-600 dark:text-slate-300"
          >
            <History className="h-3 w-3" />
            Legacy run
          </Badge>
        )}
        {runDetail.isLegacyScoring && (
          <Badge
            variant="outline"
            className="text-muted-foreground"
            title="Scored before scoring v2: errors counted as failures. Not comparable to current pass rates."
          >
            legacy scoring
          </Badge>
        )}
        {runDataset && (
          <Badge variant="secondary" className="gap-1">
            <Database className="h-3 w-3" />
            {runDataset.name ?? runDataset.slug}
            {runDetail.datasetVersion != null &&
              ` · v${runDetail.datasetVersion}`}
          </Badge>
        )}
        <span className="text-sm text-muted-foreground tabular-nums">
          {passRate}
          {passRate.endsWith("%") ? " pass rate" : ""}
        </span>
        {(runDetail.errored ?? 0) > 0 && (
          <Badge
            variant="outline"
            className="gap-1 border-amber-500/50 text-amber-600 dark:text-amber-400 tabular-nums"
            title="Infra/judge errors — excluded from the score."
          >
            <AlertTriangle className="h-3 w-3" />
            {runDetail.errored} errored
          </Badge>
        )}
        {runDetail.datasetId && !isRunning && (
          <Button
            variant="ghost"
            size="icon"
            className="text-muted-foreground h-8 w-8"
            title="Compare with previous run"
            aria-label="Compare with previous run"
            onClick={() => setCompareOpen(true)}
          >
            <GitCompareArrows className="h-4 w-4" />
          </Button>
        )}
        {runDetail.costUsd != null && Number(runDetail.costUsd) > 0 && (
          <span className="text-xs text-muted-foreground tabular-nums">
            ${Number(runDetail.costUsd).toFixed(4)}
          </span>
        )}
        {dateLabel && (
          <span className="text-xs text-muted-foreground">{dateLabel}</span>
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
                  This will permanently delete this evaluation run and all its
                  test results. This action cannot be undone.
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
    ) : undefined,
    actionKey: `eval-run:${runId}:${runDetail?.status ?? "loading"}:${cancelling}:${passRate}:${runDetail?.errored ?? ""}:${runDataset?.slug ?? ""}`,
  });

  if (runResult.fetching && !runDetail) {
    return (
      <div className="flex h-full items-center justify-center">
        <LoadingShimmer />
      </div>
    );
  }
  if (!runDetail) {
    return (
      <div className="w-full max-w-[750px] px-6 pb-10 pt-6">
        <p className="text-sm text-muted-foreground">Run not found.</p>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 w-full flex-col p-6">
      {/* Verdict filter — errors grouped apart from behavioral failures.
          Error rows are infra noise excluded from the score; the chips
          carry the per-cause breakdown. */}
      {runResults.length > 0 && (
        <div className="mb-3 flex shrink-0 flex-wrap items-center gap-2">
          <Badge
            variant={verdictFilter === null ? "default" : "outline"}
            className="cursor-pointer"
            onClick={() => setVerdictFilter(null)}
          >
            All {runResults.length}
          </Badge>
          <Badge
            variant={verdictFilter === "pass" ? "default" : "outline"}
            className={cn(
              "cursor-pointer",
              verdictFilter !== "pass" && "border-green-600 text-green-500",
            )}
            onClick={() =>
              setVerdictFilter((cur) => (cur === "pass" ? null : "pass"))
            }
          >
            Passed {verdictCounts.pass}
          </Badge>
          <Badge
            variant={verdictFilter === "fail" ? "default" : "outline"}
            className={cn(
              "cursor-pointer",
              verdictFilter !== "fail" && "border-red-600 text-red-500",
            )}
            onClick={() =>
              setVerdictFilter((cur) => (cur === "fail" ? null : "fail"))
            }
          >
            Behavioral failures {verdictCounts.fail}
          </Badge>
          <Badge
            variant={verdictFilter === "error" ? "default" : "outline"}
            className={cn(
              "cursor-pointer",
              verdictFilter !== "error" &&
                "border-amber-500/60 text-amber-600 dark:text-amber-400",
            )}
            title="Infra/judge errors — excluded from the score"
            onClick={() =>
              setVerdictFilter((cur) => (cur === "error" ? null : "error"))
            }
          >
            Errors {verdictCounts.error}
          </Badge>
          {errorBreakdown.length > 0 && (
            <span className="text-xs text-muted-foreground">
              {errorBreakdown
                .map((entry) => `${entry.label} ${entry.count}`)
                .join(" · ")}
            </span>
          )}
        </div>
      )}

      {/* Category filter badges — color-coded by per-category pass rate */}
      {categories.length > 0 && (
        <div className="mb-4 flex shrink-0 flex-wrap gap-2">
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
                if (rate >= 0.9) colorClass = "border-green-600 text-green-500";
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

      <div className="min-h-0 flex-1">
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
        onEditTestCase={setEditingTestCaseId}
        onOpenChange={(open) => {
          if (!open) setSelectedResultId(null);
        }}
      />
      <EditEvalTestCaseSheet
        testCaseId={editingTestCaseId}
        open={!!editingTestCaseId}
        onOpenChange={(open) => {
          if (!open) setEditingTestCaseId(null);
        }}
        onSaved={() => {
          setEditingTestCaseId(null);
          silentRefetch();
        }}
      />
      {runDetail.datasetId && tenantId && (
        <RunComparisonSheet
          tenantId={tenantId}
          run={{
            id: runDetail.id,
            datasetId: runDetail.datasetId,
            createdAt: runDetail.createdAt,
          }}
          currentResults={runResults}
          datasetLabel={
            runDataset ? (runDataset.name ?? runDataset.slug) : undefined
          }
          open={compareOpen}
          onOpenChange={setCompareOpen}
        />
      )}
    </div>
  );
}

/**
 * Run comparison (Trust Core R13): for a dataset-pinned run, find the
 * previous completed run of the same dataset and list per-case verdict
 * transitions (fail→pass, pass→fail, new errors). Covers AE4: a case
 * failing in run N-1 and passing in run N shows as fail→pass.
 */
function RunComparisonSheet({
  tenantId,
  run,
  currentResults,
  datasetLabel,
  open,
  onOpenChange,
}: {
  tenantId: string;
  run: { id: string; datasetId: string; createdAt: string };
  currentResults: EvalResultRow[];
  datasetLabel?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [runsResult] = useQuery({
    query: EvalRunsQuery,
    variables: { tenantId, limit: 50, offset: 0 },
    pause: !open,
    requestPolicy: "cache-and-network",
  });

  // Previous completed run of the same dataset (client-side filter —
  // the runs list is small and already tenant-scoped).
  const previousRun = useMemo(() => {
    const items = runsResult.data?.evalRuns?.items ?? [];
    return items
      .filter(
        (candidate) =>
          candidate.id !== run.id &&
          candidate.datasetId === run.datasetId &&
          candidate.status === "completed" &&
          Date.parse(candidate.createdAt) < Date.parse(run.createdAt),
      )
      .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))[0];
  }, [runsResult.data, run.id, run.datasetId, run.createdAt]);

  const [previousResults] = useQuery({
    query: EvalRunResultsQuery,
    variables: { runId: previousRun?.id ?? "" },
    pause: !open || !previousRun,
    requestPolicy: "cache-and-network",
  });

  const transitions: EvalRunTransition[] = useMemo(() => {
    if (!previousRun || !previousResults.data?.evalRunResults) return [];
    return computeEvalRunComparison(
      previousResults.data.evalRunResults as EvalResultRow[],
      currentResults,
    );
  }, [previousRun, previousResults.data, currentResults]);

  const loading =
    runsResult.fetching || (Boolean(previousRun) && previousResults.fetching);

  const transitionBadge = (transition: EvalRunTransition) => {
    switch (transition.kind) {
      case "fail-to-pass":
        return (
          <Badge className="bg-green-600 hover:bg-green-600 text-white shrink-0">
            {evalRunTransitionLabel(transition.kind)}
          </Badge>
        );
      case "pass-to-fail":
        return (
          <Badge variant="destructive" className="shrink-0">
            {evalRunTransitionLabel(transition.kind)}
          </Badge>
        );
      case "new-error":
        return (
          <Badge
            variant="outline"
            className="shrink-0 border-amber-500/50 text-amber-600 dark:text-amber-400"
          >
            {evalRunTransitionLabel(transition.kind)}
          </Badge>
        );
      case "error-resolved":
        return (
          <Badge variant="secondary" className="shrink-0">
            {evalRunTransitionLabel(transition.kind)}
          </Badge>
        );
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        className={`${EVAL_RESULT_SHEET_WIDTH_CLASS} overflow-y-auto`}
        style={EVAL_RESULT_SHEET_STYLE}
      >
        <SheetHeader className="px-6 pt-6 pr-14">
          <SheetTitle className="text-base leading-snug">
            Compare with previous run
          </SheetTitle>
          <SheetDescription>
            Per-case verdict transitions
            {datasetLabel ? ` for dataset "${datasetLabel}"` : ""} against the
            previous completed run of the same dataset.
          </SheetDescription>
        </SheetHeader>
        <div className="space-y-4 px-6 pb-6">
          {loading ? (
            <div className="flex items-center gap-2 rounded-md border bg-muted/30 p-3 text-xs text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Loading comparison
            </div>
          ) : !previousRun ? (
            <div className="rounded-md border bg-muted/30 p-3 text-xs text-muted-foreground">
              No previous completed run of this dataset to compare against.
            </div>
          ) : (
            <>
              <p className="text-xs text-muted-foreground">
                Previous run: {previousRun.id.slice(0, 8)} ·{" "}
                {relativeTime(previousRun.createdAt)}
                {previousRun.datasetVersion != null &&
                  ` · dataset v${previousRun.datasetVersion}`}
              </p>
              {transitions.length === 0 ? (
                <div className="rounded-md border bg-muted/30 p-3 text-xs text-muted-foreground">
                  No verdict changes between these runs.
                </div>
              ) : (
                <div className="space-y-2" data-testid="run-comparison-list">
                  {transitions.map((transition) => (
                    <div
                      key={transition.key}
                      className="flex items-center justify-between gap-3 rounded-md border bg-background p-3"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">
                          {transition.name ?? "(unnamed)"}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {transition.from} → {transition.to}
                        </p>
                      </div>
                      {transitionBadge(transition)}
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

function ResultDetailSheet({
  runId,
  result,
  open,
  onEditTestCase,
  onOpenChange,
}: {
  runId: string;
  result: EvalResultRow | undefined;
  open: boolean;
  onEditTestCase: (testCaseId: string) => void;
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

  const [showSystemPrompt, setShowSystemPrompt] = useState(false);

  // Operator verdict override (Trust Core U9). The mutation pushes
  // notifyEvalRunUpdate, so the run-level subscription in
  // SettingsEvalRunDetail refetches both the run summary and the result
  // rows; the doc cache also invalidates EvalResult-typed queries.
  const { isOperator } = useTenant();
  const resultId = result?.id;
  const [{ fetching: overriding }, overrideResult] = useMutation(
    OverrideEvalResultMutation,
  );
  const handleOverride = useCallback(
    async (overrideStatus: "pass" | "fail" | null, reason: string) => {
      if (!resultId) return;
      const response = await overrideResult({
        input: {
          resultId,
          overrideStatus,
          reason: overrideStatus === null ? undefined : reason,
        },
      });
      if (response.error) {
        toast.error("Failed to update override: " + response.error.message);
      } else {
        toast.success(
          overrideStatus === null ? "Override cleared" : "Verdict overridden",
        );
      }
    },
    [overrideResult, resultId],
  );

  useEffect(() => {
    setShowTrace(false);
    setShowSystemPrompt(false);
  }, [result?.id]);

  if (!result) return null;

  const assertions = parseAssertions(result.assertions);
  const evaluatorResults = parseEvaluatorResults(result.evaluatorResults);
  // Error rows render by error_cause, never by score or failure-mode
  // heuristics — they are infra noise excluded from the run's score.
  const isErrorRow = result.status === "error";
  const failureMode = isErrorRow ? null : deriveEvalFailureMode(result);
  const failureModeLabel = evalFailureModeLabel(failureMode);
  const failureModeDescription = evalFailureModeDescription(failureMode);
  const expected = expectedSummary(assertions);
  const canEdit = canEditEvalResult(result.testCaseId);
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
      <SheetContent
        className={`${EVAL_RESULT_SHEET_WIDTH_CLASS} overflow-y-auto`}
        style={EVAL_RESULT_SHEET_STYLE}
      >
        <SheetHeader className="px-6 pt-6 pr-14">
          <div className="flex items-start justify-between gap-3">
            <SheetTitle className="text-base leading-snug">
              {result.testCaseName ?? "(unnamed)"}
            </SheetTitle>
            {canEdit && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-8 shrink-0 gap-2"
                onClick={() =>
                  openEvalResultEditor(result.testCaseId, onEditTestCase)
                }
              >
                <Pencil className="h-3.5 w-3.5" />
                Edit Eval
              </Button>
            )}
          </div>
        </SheetHeader>
        <div className="space-y-4 px-6 pb-6">
          <div className="flex items-center gap-2">
            {statusBadge(result.effectiveStatus ?? result.status)}
            {result.overrideStatus && (
              <Badge
                variant="outline"
                className="text-muted-foreground"
                title={`Judge verdict: ${result.status}`}
              >
                overridden
              </Badge>
            )}
            {result.category && (
              <Badge variant="outline">{result.category}</Badge>
            )}
            {isErrorRow && (
              <Badge
                variant="outline"
                className="gap-1 border-amber-500/50 text-amber-600 dark:text-amber-400"
              >
                <AlertTriangle className="h-3 w-3" />
                {evalErrorCauseLabel(result.errorCause)}
              </Badge>
            )}
            {failureMode && (
              <Badge
                variant={failureMode === "timeout" ? "outline" : "destructive"}
              >
                {failureMode}
              </Badge>
            )}
            {!isErrorRow && result.score != null && (
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

          {isErrorRow && (
            <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-3">
              <h4 className="text-sm font-medium">
                {evalErrorCauseLabel(result.errorCause)}
              </h4>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                {evalErrorCauseDescription(result.errorCause)}
              </p>
            </div>
          )}

          {failureModeLabel && failureModeDescription && (
            <div className="rounded-md border border-border bg-muted/30 p-3">
              <h4 className="text-sm font-medium">{failureModeLabel}</h4>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                {failureModeDescription}
              </p>
            </div>
          )}

          <EvalResultOverrideControl
            result={result}
            isOperator={isOperator}
            submitting={overriding}
            onSubmit={handleOverride}
          />

          {result.input && (
            <div>
              <div className="mb-1 flex items-center justify-between gap-2">
                <h4 className="text-sm font-medium">Input</h4>
                {result.testCaseId && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-7 gap-1 px-2 text-xs text-muted-foreground hover:text-foreground"
                    onClick={() => setShowSystemPrompt(true)}
                  >
                    <FileText className="h-3.5 w-3.5" />
                    System prompt
                  </Button>
                )}
              </div>
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
                  const displayStatus = evaluatorDisplayStatus(evaluator);
                  const badgeLabel =
                    score !== null ? score.toFixed(2) : displayStatus;
                  const badgeVariant =
                    displayStatus === "pass"
                      ? "default"
                      : displayStatus === "skipped"
                        ? "secondary"
                        : "destructive";
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
                          variant={badgeVariant}
                          className="shrink-0 tabular-nums"
                        >
                          {badgeLabel}
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
        <SystemPromptSheet
          evalTestCaseId={result.testCaseId}
          titleSuffix={result.testCaseName}
          capturedSystemPrompt={result.systemPrompt}
          open={showSystemPrompt}
          onOpenChange={setShowSystemPrompt}
        />
      </SheetContent>
    </Sheet>
  );
}

/**
 * Operator-gated verdict override (Trust Core U9). Only renders for
 * operators on scored results (status pass|fail) — error rows have no
 * verdict to overturn. The judge's original verdict is shown beside the
 * override (it is never mutated); the reason is required before either
 * override button enables. Clearing restores the judge's verdict to
 * aggregation.
 */
export function EvalResultOverrideControl({
  result,
  isOperator,
  submitting,
  onSubmit,
}: {
  result: Pick<
    EvalResultRow,
    | "status"
    | "overrideStatus"
    | "overriddenBy"
    | "overriddenAt"
    | "overrideReason"
  >;
  isOperator: boolean;
  submitting?: boolean;
  onSubmit: (overrideStatus: "pass" | "fail" | null, reason: string) => void;
}) {
  const [reason, setReason] = useState("");
  const isScored = result.status === "pass" || result.status === "fail";
  if (!isOperator || !isScored) return null;

  const trimmedReason = reason.trim();
  const submitOverride = (overrideStatus: "pass" | "fail") => {
    if (!trimmedReason) return;
    onSubmit(overrideStatus, trimmedReason);
    setReason("");
  };

  return (
    <div className="rounded-md border border-border bg-muted/30 p-3">
      <h4 className="text-sm font-medium">Operator override</h4>
      {result.overrideStatus ? (
        <div className="mt-2 space-y-1 text-xs text-muted-foreground">
          <p>
            Overridden to{" "}
            <span className="font-medium text-foreground">
              {result.overrideStatus}
            </span>{" "}
            — original judge verdict:{" "}
            <span className="font-medium text-foreground">{result.status}</span>
          </p>
          <p>
            By {result.overriddenBy ?? "unknown"}
            {result.overriddenAt
              ? ` · ${relativeTime(result.overriddenAt)}`
              : ""}
          </p>
          {result.overrideReason && <p>Reason: {result.overrideReason}</p>}
        </div>
      ) : (
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
          Overturn the judge&apos;s verdict for this result. The original
          verdict stays recorded; the run&apos;s pass rate recomputes from the
          override.
        </p>
      )}
      <Textarea
        aria-label="Override reason"
        placeholder="Reason (required)"
        value={reason}
        onChange={(event) => setReason(event.target.value)}
        className="mt-2 min-h-16 text-xs"
      />
      <div className="mt-2 flex items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-8"
          disabled={!trimmedReason || submitting}
          onClick={() => submitOverride("pass")}
        >
          Mark pass
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-8"
          disabled={!trimmedReason || submitting}
          onClick={() => submitOverride("fail")}
        >
          Mark fail
        </Button>
        {result.overrideStatus && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-8 text-muted-foreground"
            disabled={submitting}
            onClick={() => onSubmit(null, "")}
          >
            Clear override
          </Button>
        )}
      </div>
    </div>
  );
}

function EditEvalTestCaseSheet({
  testCaseId,
  open,
  onOpenChange,
  onSaved,
}: {
  testCaseId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}) {
  const [actions, setActions] = useState<ReactNode>(null);
  const handleCancel = useCallback(() => {
    onOpenChange(false);
  }, [onOpenChange]);
  const [tc] = useQuery({
    query: EvalTestCaseQuery,
    variables: { id: testCaseId ?? "" },
    pause: !open || !testCaseId,
    requestPolicy: "network-only",
  });

  const initial = tc.data?.evalTestCase;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        className={cn(EVAL_RESULT_SHEET_WIDTH_CLASS, "overflow-y-auto")}
        style={EVAL_RESULT_SHEET_STYLE}
      >
        <SheetHeader className="border-b border-border/70 px-6 py-4 pr-14">
          <div className="flex items-start justify-between gap-3">
            <SheetTitle className="text-base leading-snug">
              {initial?.name ? `Edit: ${initial.name}` : "Edit Eval"}
            </SheetTitle>
            {actions && (
              <div className="flex shrink-0 items-center gap-2">{actions}</div>
            )}
          </div>
          <SheetDescription className="sr-only">
            Edit the evaluation test case associated with the selected run
            result.
          </SheetDescription>
        </SheetHeader>
        <div className="px-6 pb-6">
          {tc.fetching && !initial ? (
            <div className="flex items-center justify-center py-12">
              <LoadingShimmer />
            </div>
          ) : !initial ? (
            <div className="py-8 text-sm text-muted-foreground">
              Test case not found.
            </div>
          ) : (
            <EvalTestCaseForm
              initial={
                initial as unknown as Parameters<
                  typeof EvalTestCaseForm
                >[0]["initial"]
              }
              isEdit
              onActions={setActions}
              onCancel={handleCancel}
              onSaved={onSaved}
            />
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
