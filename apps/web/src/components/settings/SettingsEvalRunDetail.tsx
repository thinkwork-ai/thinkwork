import {
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import { useNavigate, useParams } from "@tanstack/react-router";
import { useMutation, useQuery, useSubscription } from "urql";
import {
  type ColumnDef,
  type ColumnFiltersState,
  getCoreRowModel,
  getFilteredRowModel,
  useReactTable,
} from "@tanstack/react-table";
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
  DataTableTokenFilter,
  type DataTableTokenFilterColumn,
  dataTableTokenFilterFns,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  Textarea,
  TooltipIconButton,
} from "@thinkwork/ui";
import { usePageHeaderActions } from "@/context/PageHeaderContext";
import { CollapsedFilterSearch } from "@/components/artifacts/CollapsedFilterSearch";
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
  aggregateTrialCaseVerdicts,
  type TrialResultInput,
} from "@thinkwork/evals-core";
import {
  canEditEvalResult,
  computeEvalRunComparison,
  countEvalVerdictGroups,
  deriveEvalFailureMode,
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
} from "@/components/settings/eval-result-detail";

// Hidden-column ids for the Work Items-style filter table on this page.
const FILTER_COLUMNS = {
  search: "filterSearch",
  category: "filterCategory",
  status: "filterStatus",
} as const;

/** Read the contains-search string out of the token-filter state. */
function tokenFilterSearchValue(
  columnFilters: ColumnFiltersState,
  id: string,
): string {
  const raw = columnFilters.find((filter) => filter.id === id)?.value;
  if (raw && typeof raw === "object" && "value" in raw) {
    const value = (raw as { value: unknown }).value;
    if (typeof value === "string") return value;
  }
  return "";
}

/** Read the selected option values (an "is any of" set) out of the state. */
function tokenFilterOptionValues(
  columnFilters: ColumnFiltersState,
  id: string,
): string[] {
  const raw = columnFilters.find((filter) => filter.id === id)?.value;
  if (!raw || typeof raw !== "object" || !("value" in raw)) return [];
  const value = (raw as { value: unknown }).value;
  if (Array.isArray(value)) return value.map(String);
  if (value == null) return [];
  return [String(value)];
}

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
  // Which trial of the case this row is (Eval Profiles U4); 0 on legacy
  // single-trial rows.
  trialIndex: number;
  // Which tier actually executed (Eval Execution Tiers v1): 'model' =
  // stateless call against the run's pinned composed prompt; 'agent' =
  // full Pi turn. Historical rows predate the column ('agent').
  executionTier: string;
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

/**
 * Deleted test cases must not remain visible in evaluation detail. Older API
 * deployments unlinked historical result rows by clearing testCaseId, so keep
 * the UI resilient while those rows are removed by the server-side fix.
 */
export function visibleEvalResults(results: EvalResultRow[]): EvalResultRow[] {
  return results.filter(
    (result) =>
      typeof result.testCaseId === "string" && result.testCaseId.length > 0,
  );
}

interface VisibleEvalSummary {
  totalTests: number;
  passed: number;
  failed: number;
  errored: number;
  unstable: number;
  passRate: number | null;
}

/** Rebuild the visible case summary when a legacy orphan was filtered out. */
export function summarizeVisibleEvalResults(
  results: EvalResultRow[],
): VisibleEvalSummary {
  const groups = groupEvalResultsByCase(results);
  const summary = {
    totalTests: groups.length,
    passed: 0,
    failed: 0,
    errored: 0,
    unstable: 0,
    passRate: null as number | null,
  };

  for (const group of groups) {
    if (group.verdict === "pass") summary.passed += 1;
    else if (group.verdict === "fail") summary.failed += 1;
    else if (group.verdict === "unstable") summary.unstable += 1;
    else summary.errored += 1;
  }
  const scored = summary.passed + summary.failed;
  summary.passRate = scored > 0 ? summary.passed / scored : null;
  return summary;
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
    case "unstable":
      // Scored trials split with no majority (Eval Profiles U4) —
      // excluded from the score like errors, but a distinct signal:
      // the case is flaky under this profile, not broken infra.
      return (
        <Badge
          variant="outline"
          className="border-purple-500/60 text-purple-600 dark:text-purple-400"
        >
          unstable
        </Badge>
      );
    default:
      return <Badge variant="secondary">{status}</Badge>;
  }
}

// ---------------------------------------------------------------------------
// Case-grouped view (Eval Profiles KTD12): multi-trial runs read
// case-level verdicts through the same evals-core aggregation layer the
// worker finalizes with — trial rows never render as top-level results.
// ---------------------------------------------------------------------------

export interface EvalCaseGroup {
  testCaseId: string;
  testCaseName: string | null;
  category: string | null;
  verdict: "pass" | "fail" | "error" | "unstable";
  /** Trial rows for the case, ordered by trialIndex. */
  trials: EvalResultRow[];
  passVotes: number;
  scoredCount: number;
}

function trialAggregationStatus(status: string): "pass" | "fail" | "error" {
  if (status === "pass" || status === "completed") return "pass";
  if (status === "fail" || status === "failed") return "fail";
  return "error";
}

/**
 * Group per-trial rows by case and derive each case's verdict via the
 * shared evals-core aggregation (majority of scored trials; tie →
 * unstable; sub-quorum → error; row-level overrides applied as effective
 * statuses). Case-level overrides are applied server-side to the run
 * summary; this view reflects row data.
 */
export function groupEvalResultsByCase(rows: EvalResultRow[]): EvalCaseGroup[] {
  const trialInputs: TrialResultInput[] = rows.map((row) => ({
    testCaseId: row.testCaseId ?? row.id,
    trialIndex: row.trialIndex ?? 0,
    status: trialAggregationStatus(row.status),
    overrideStatus:
      row.overrideStatus === "pass" || row.overrideStatus === "fail"
        ? row.overrideStatus
        : null,
  }));
  const verdicts = aggregateTrialCaseVerdicts(trialInputs);
  const verdictByCase = new Map(verdicts.map((v) => [v.testCaseId, v]));

  const byCase = new Map<string, EvalResultRow[]>();
  for (const row of rows) {
    const key = row.testCaseId ?? row.id;
    const existing = byCase.get(key);
    if (existing) existing.push(row);
    else byCase.set(key, [row]);
  }

  return [...byCase.entries()].map(([testCaseId, trials]) => {
    const ordered = [...trials].sort(
      (a, b) => (a.trialIndex ?? 0) - (b.trialIndex ?? 0),
    );
    const aggregate = verdictByCase.get(testCaseId);
    const effective = ordered.map((t) =>
      trialAggregationStatus(t.overrideStatus ?? t.status),
    );
    return {
      testCaseId,
      testCaseName: ordered[0]?.testCaseName ?? null,
      category: ordered[0]?.category ?? null,
      verdict: aggregate?.verdict ?? "error",
      trials: ordered,
      passVotes: effective.filter((s) => s === "pass").length,
      scoredCount: effective.filter((s) => s === "pass" || s === "fail").length,
    };
  });
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
        {row.original.executionTier === "model" && (
          <Badge
            variant="outline"
            className="text-[10px] text-muted-foreground"
            title="Executed as one stateless model call against the run's pinned composed prompt — no tools, no workspace."
          >
            model call
          </Badge>
        )}
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

/**
 * Delete-run cache invalidation: urql's default document cache invalidates
 * cached queries by the typenames present in a mutation response, and
 * `deleteEvalRun` returns a bare Boolean — no typenames. Passing the
 * Evaluations-dashboard typenames via `additionalTypenames` is what makes
 * the Recent Runs list (plus the summary cards and pass-rate trend fed by
 * the same cache) refetch instead of serving the deleted run from cache
 * after navigating back to /settings/evaluations.
 */
export const DELETED_EVAL_RUN_TYPENAMES = [
  "EvalRun",
  "EvalRunsPage",
  "EvalSummary",
  "EvalTimeSeriesPoint",
];

export async function performEvalRunDelete(opts: {
  runId: string;
  deleteRun: (
    variables: { id: string },
    context: { additionalTypenames: string[] },
  ) => Promise<{ error?: { message: string } }>;
  onError: (message: string) => void;
  onDeleted: () => void;
}): Promise<void> {
  const result = await opts.deleteRun(
    { id: opts.runId },
    { additionalTypenames: DELETED_EVAL_RUN_TYPENAMES },
  );
  if (result.error) opts.onError(result.error.message);
  else opts.onDeleted();
}

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
  // Filters follow the Work Items list idiom (collapsed search + token
  // filters): a hidden react-table holds the filter state and drives the
  // category/status token pickers and the free-text search over test names.
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);
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

  const rawRunResults = (resultsResult.data?.evalRunResults ??
    []) as unknown as EvalResultRow[];
  const runResults = visibleEvalResults(rawRunResults);
  const orphanAdjustedSummary = useMemo(
    () =>
      rawRunResults.length === runResults.length
        ? null
        : summarizeVisibleEvalResults(runResults),
    [rawRunResults, runResults],
  );

  const categories = useMemo(
    () =>
      Array.from(
        new Set(runResults.map((r) => r.category).filter(Boolean)),
      ) as string[],
    [runResults],
  );

  const verdictCounts = useMemo(
    () => countEvalVerdictGroups(runResults),
    [runResults],
  );
  // Hidden filter table (Work Items idiom): each result maps to a filter row
  // whose text/option columns feed the search + token pickers. The flat view
  // renders `filteredResults`; the multi-trial view derives the same
  // selections and applies them to case groups.
  const filterRows = useMemo(
    () =>
      runResults.map((result) => ({
        result,
        filterSearch: `${result.testCaseName ?? ""} ${result.category ?? ""}`,
        filterCategory: result.category ?? "",
        filterStatus: evalResultVerdictGroup(result),
      })),
    [runResults],
  );
  type EvalFilterRow = (typeof filterRows)[number];

  const filterColumns = useMemo<ColumnDef<EvalFilterRow>[]>(
    () => [
      {
        id: FILTER_COLUMNS.search,
        accessorKey: "filterSearch",
        filterFn: dataTableTokenFilterFns.text,
      },
      {
        id: FILTER_COLUMNS.category,
        accessorKey: "filterCategory",
        filterFn: dataTableTokenFilterFns.option,
      },
      {
        id: FILTER_COLUMNS.status,
        accessorKey: "filterStatus",
        filterFn: dataTableTokenFilterFns.option,
      },
    ],
    [],
  );

  const filterTable = useReactTable({
    data: filterRows,
    columns: filterColumns,
    autoResetPageIndex: false,
    state: { columnFilters },
    onColumnFiltersChange: setColumnFilters,
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
  });

  const filteredResults = filterTable
    .getFilteredRowModel()
    .rows.map((row) => row.original.result);

  const searchValue = tokenFilterSearchValue(
    columnFilters,
    FILTER_COLUMNS.search,
  );
  const selectedCategories = tokenFilterOptionValues(
    columnFilters,
    FILTER_COLUMNS.category,
  );
  const selectedStatuses = tokenFilterOptionValues(
    columnFilters,
    FILTER_COLUMNS.status,
  );

  const tokenFilterColumns = useMemo<DataTableTokenFilterColumn[]>(() => {
    const cols: DataTableTokenFilterColumn[] = [];
    if (categories.length > 0) {
      cols.push({
        id: FILTER_COLUMNS.category,
        label: "Category",
        type: "option",
        options: categories.map((cat) => ({ value: cat, label: cat })),
      });
    }
    cols.push({
      id: FILTER_COLUMNS.status,
      label: "Status",
      type: "option",
      options: [
        { value: "pass", label: "Passed" },
        { value: "fail", label: "Behavioral failures" },
        { value: "error", label: "Errors" },
        ...(verdictCounts.other > 0
          ? [{ value: "other", label: "Other" }]
          : []),
      ],
    });
    return cols;
  }, [categories, verdictCounts.other]);

  // The summary-bar counts double as one-click Status filters (a single
  // selected verdict), so "2 errored" jumps straight to the errored evals.
  const statusActive = (value: string) =>
    selectedStatuses.length === 1 && selectedStatuses[0] === value;
  const toggleStatusFilter = (value: string) =>
    filterTable
      .getColumn(FILTER_COLUMNS.status)
      ?.setFilterValue(
        statusActive(value)
          ? undefined
          : { operator: "is_any_of", value: [value] },
      );
  const countButtonClass = (value: string) =>
    cn(
      "rounded underline-offset-2 hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
      statusActive(value) && "text-foreground font-medium underline",
    );

  // Case-grouped view (KTD12): a multi-trial run (any trialIndex > 0)
  // renders case verdicts with per-trial rows nested — trial rows never
  // render as top-level results.
  const isMultiTrial = runResults.some((r) => (r.trialIndex ?? 0) > 0);
  const caseGroups = useMemo(
    () => (isMultiTrial ? groupEvalResultsByCase(runResults) : []),
    [isMultiTrial, runResults],
  );
  const filteredCaseGroups = caseGroups.filter(
    (group) =>
      (selectedCategories.length === 0 ||
        (group.category != null &&
          selectedCategories.includes(group.category))) &&
      (selectedStatuses.length === 0 ||
        selectedStatuses.includes(group.verdict)) &&
      (searchValue.trim() === "" ||
        (group.testCaseName ?? "")
          .toLowerCase()
          .includes(searchValue.trim().toLowerCase())),
  );
  const [expandedCases, setExpandedCases] = useState<Set<string>>(
    () => new Set(),
  );
  function toggleCase(testCaseId: string) {
    setExpandedCases((cur) => {
      const next = new Set(cur);
      if (next.has(testCaseId)) next.delete(testCaseId);
      else next.add(testCaseId);
      return next;
    });
  }

  const handleDelete = useCallback(
    () =>
      performEvalRunDelete({
        runId,
        deleteRun,
        onError: (message) => toast.error("Failed to delete: " + message),
        onDeleted: () => {
          toast.success("Evaluation deleted");
          navigate({ to: "/settings/evaluations" });
        },
      }),
    [deleteRun, navigate, runId],
  );

  const handleCancel = useCallback(async () => {
    const result = await cancelRun({ id: runId });
    if (result.error) toast.error("Failed to cancel: " + result.error.message);
    else toast.success("Evaluation cancelled");
  }, [cancelRun, runId]);

  // Score over clean executions (server-computed, override-corrected).
  // Null pass rate on a terminal run renders "No score" — never 0%.
  const passRate = orphanAdjustedSummary
    ? orphanAdjustedSummary.passRate === null
      ? "No score"
      : `${(orphanAdjustedSummary.passRate * 100).toFixed(1)}%`
    : runDetail
      ? evalRunPassRateDisplay(runDetail)
      : "—";
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
    backHref: "/settings/evaluations",
    backBehavior: "history",
    // Timestamp + the run-level control (cancel while running, else delete)
    // stay anchored in the AppTopBar; the descriptive metrics move to the
    // content summary below.
    action: runDetail ? (
      <div className="flex items-center gap-2">
        {dateLabel && (
          <span className="text-xs text-muted-foreground">{dateLabel}</span>
        )}
        {isRunning ? (
          <TooltipIconButton
            label="Stop run"
            size="icon"
            className="h-8 w-8 hover:text-destructive"
            onClick={handleCancel}
            disabled={cancelling}
          >
            {cancelling ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Square className="h-4 w-4" />
            )}
          </TooltipIconButton>
        ) : (
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <TooltipIconButton
                label="Delete run"
                size="icon"
                className="h-8 w-8 hover:text-destructive"
              >
                <Trash2 className="h-4 w-4" />
              </TooltipIconButton>
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
    actionKey: `eval-run:${runId}:${runDetail?.status ?? "loading"}:${cancelling}:${dateLabel}`,
  });

  // The run summary lives at the top of the content area (not crammed into
  // the AppTopBar) so the title + back arrow stay legible.
  const runSummary = runDetail ? (
    <div className="mb-4 flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2">
      {runDetail.agentName && (
        <span className="text-sm font-medium">{runDetail.agentName}</span>
      )}
      <span className="flex flex-wrap items-center gap-x-1 text-sm text-muted-foreground">
        <button
          type="button"
          className={countButtonClass("pass")}
          onClick={() => toggleStatusFilter("pass")}
          title="Show only passed"
        >
          {orphanAdjustedSummary?.passed ?? runDetail.passed ?? 0} passed
        </button>
        <span>,</span>
        <button
          type="button"
          className={countButtonClass("fail")}
          onClick={() => toggleStatusFilter("fail")}
          title="Show only behavioral failures"
        >
          {orphanAdjustedSummary?.failed ?? runDetail.failed ?? 0} failed
        </button>
        {(orphanAdjustedSummary?.errored ?? runDetail.errored ?? 0) > 0 && (
          <>
            <span>,</span>
            <button
              type="button"
              className={countButtonClass("error")}
              onClick={() => toggleStatusFilter("error")}
              title="Show only errored evals"
            >
              {orphanAdjustedSummary?.errored ?? runDetail.errored} errored
            </button>
          </>
        )}
        <span>
          of {orphanAdjustedSummary?.totalTests ?? runDetail.totalTests ?? 0}{" "}
          tests
        </span>
      </span>
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
      {/* Eval Profile provenance (THINK-107): pre-profile runs are
            labeled, never blended silently into profile comparisons. */}
      {runDetail.profileId ? (
        <Badge variant="secondary" className="whitespace-nowrap">
          {runDetail.profileName ?? "Profile"}
        </Badge>
      ) : (
        <Badge
          variant="outline"
          className="text-muted-foreground whitespace-nowrap"
        >
          Legacy (pre-profile)
        </Badge>
      )}
      <span className="text-sm text-muted-foreground tabular-nums">
        {passRate}
        {passRate.endsWith("%") ? " pass rate" : ""}
      </span>
      {(orphanAdjustedSummary?.errored ?? runDetail.errored ?? 0) > 0 && (
        <Badge
          variant="outline"
          className={cn(
            "cursor-pointer gap-1 border-amber-500/50 text-amber-600 tabular-nums dark:text-amber-400",
            statusActive("error") && "bg-amber-500/15",
          )}
          title="Infra/judge errors — excluded from the score. Click to filter."
          onClick={() => toggleStatusFilter("error")}
        >
          <AlertTriangle className="h-3 w-3" />
          {orphanAdjustedSummary?.errored ?? runDetail.errored} errored
        </Badge>
      )}
      {(orphanAdjustedSummary?.unstable ?? runDetail.unstable ?? 0) > 0 && (
        <Badge
          variant="outline"
          className="gap-1 border-purple-500/60 text-purple-600 dark:text-purple-400 tabular-nums"
          title="Cases whose scored trials split with no majority — excluded from the score like errors."
        >
          {orphanAdjustedSummary?.unstable ?? runDetail.unstable} unstable
        </Badge>
      )}
      {(runDetail.latencyP50Ms != null || runDetail.latencyP95Ms != null) && (
        <span
          className="text-xs text-muted-foreground tabular-nums whitespace-nowrap"
          title="Agent-turn latency percentiles over this run's results"
        >
          p50 {runDetail.latencyP50Ms ?? "—"}ms · p95{" "}
          {runDetail.latencyP95Ms ?? "—"}ms
        </span>
      )}
      {runDetail.datasetId && !isRunning && (
        <TooltipIconButton
          size="icon"
          className="text-muted-foreground h-8 w-8"
          label="Compare with previous run"
          onClick={() => setCompareOpen(true)}
        >
          <GitCompareArrows className="h-4 w-4" />
        </TooltipIconButton>
      )}
      {runDetail.costUsd != null && Number(runDetail.costUsd) > 0 && (
        <span className="text-xs text-muted-foreground tabular-nums whitespace-nowrap">
          ${Number(runDetail.costUsd).toFixed(4)}
          {runDetail.costPartial && (
            <span
              className="ml-1 text-amber-600 dark:text-amber-400"
              title="Some result rows are missing priced agent-turn cost — this total understates real spend."
            >
              (partial)
            </span>
          )}
        </span>
      )}
    </div>
  ) : null;

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
      {runSummary}

      {/* Filters follow the Work Items list idiom: a collapsed search over
          test names plus token pickers for category and verdict/status. */}
      {runResults.length > 0 && (
        <div className="mb-4 flex shrink-0 flex-wrap items-center gap-2">
          <CollapsedFilterSearch
            value={searchValue}
            onChange={(value) =>
              filterTable
                .getColumn(FILTER_COLUMNS.search)
                ?.setFilterValue(
                  value ? { operator: "contains", value } : undefined,
                )
            }
            label="Search tests"
            placeholder="Search tests..."
          />
          <DataTableTokenFilter
            table={filterTable}
            columns={tokenFilterColumns}
            addLabel="Filter"
            showAddLabel={false}
            clearLabel="Clear filters"
            flattenToolbar
            className="max-w-full"
            popoverClassName="w-[min(16rem,calc(100vw-2rem))]"
          />
        </div>
      )}

      <div className="min-h-0 flex-1">
        {isMultiTrial ? (
          <div className="h-full overflow-auto rounded-md border">
            {filteredCaseGroups.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">
                No cases match the current filters.
              </p>
            ) : (
              filteredCaseGroups.map((group) => (
                <div
                  key={group.testCaseId}
                  className="border-b last:border-b-0"
                >
                  <button
                    type="button"
                    className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-accent/50"
                    onClick={() => toggleCase(group.testCaseId)}
                    aria-expanded={expandedCases.has(group.testCaseId)}
                  >
                    <ChevronDown
                      className={cn(
                        "h-4 w-4 shrink-0 text-muted-foreground transition-transform",
                        !expandedCases.has(group.testCaseId) && "-rotate-90",
                      )}
                    />
                    <span
                      className="min-w-0 flex-1 truncate text-sm font-medium"
                      title={group.testCaseName ?? group.testCaseId}
                    >
                      {group.testCaseName ?? "(unnamed)"}
                    </span>
                    {group.category && (
                      <Badge
                        variant="outline"
                        className="text-xs whitespace-nowrap"
                      >
                        {group.category}
                      </Badge>
                    )}
                    <span className="text-xs text-muted-foreground tabular-nums whitespace-nowrap">
                      {group.passVotes}/{group.scoredCount} pass ·{" "}
                      {group.trials.length}{" "}
                      {group.trials.length === 1 ? "trial" : "trials"}
                    </span>
                    {statusBadge(group.verdict)}
                  </button>
                  {expandedCases.has(group.testCaseId) && (
                    <div className="bg-muted/30">
                      {group.trials.map((trial) => (
                        <button
                          key={trial.id}
                          type="button"
                          className="flex w-full items-center gap-3 border-t px-3 py-1.5 pl-9 text-left text-sm hover:bg-accent/50"
                          onClick={() => setSelectedResultId(trial.id)}
                        >
                          <span className="w-14 text-xs text-muted-foreground">
                            Trial {(trial.trialIndex ?? 0) + 1}
                          </span>
                          {statusBadge(trial.effectiveStatus ?? trial.status)}
                          {trial.overrideStatus && (
                            <Badge
                              variant="outline"
                              className="text-[10px] text-muted-foreground"
                              title={`Judge verdict: ${trial.status}`}
                            >
                              overridden
                            </Badge>
                          )}
                          <span className="ml-auto text-xs text-muted-foreground tabular-nums">
                            {trial.status === "error"
                              ? evalErrorCauseLabel(trial.errorCause)
                              : trial.score != null
                                ? Number(trial.score).toFixed(2)
                                : "—"}
                          </span>
                          <span className="w-16 text-right text-xs text-muted-foreground tabular-nums">
                            {trial.durationMs != null
                              ? `${trial.durationMs}ms`
                              : "—"}
                          </span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        ) : (
          <DataTable
            columns={resultColumns}
            data={filteredResults}
            pageSize={25}
            tableClassName="table-fixed"
            scrollable
            onRowClick={(result) => setSelectedResultId(result.id)}
          />
        )}
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
        onDeleted={() => {
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
  onDeleted,
}: {
  testCaseId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
  onDeleted: () => void;
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
              onDeleted={onDeleted}
            />
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
