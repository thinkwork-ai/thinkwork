import { Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useMutation, useQuery, useSubscription } from "urql";
import { type ColumnDef } from "@tanstack/react-table";
import {
  AlertTriangle,
  CalendarClock,
  Cloud,
  Database,
  GitCompareArrows,
  History,
  Layers,
  Loader2,
  Play,
  RefreshCw,
  ShieldCheck,
  SlidersHorizontal,
} from "lucide-react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  DataTable,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  Label,
} from "@thinkwork/ui";
import { usePageHeaderActions } from "@/context/PageHeaderContext";
import { useTenant } from "@/context/TenantContext";
import { MetricCard } from "@/components/MetricCard";
import { LoadingShimmer } from "@/components/LoadingShimmer";
import {
  SettingsPageTitle,
  SettingsPane,
} from "@/components/settings/SettingsContent";
import { EVAL_CATEGORIES as CATEGORIES } from "@/lib/evaluation-options";
import {
  EvalDatasetsQuery,
  EvalProfilesQuery,
  EvalRunsQuery,
  EvalSummaryQuery,
  EvalTimeSeriesQuery,
  OnEvalRunUpdatedSubscription,
  StartEvalRunMutation,
} from "@/lib/evaluation-queries";
import { shortModelLabel } from "@/components/settings/SettingsEvalProfiles";
import { cn, relativeTime } from "@/lib/utils";
import {
  evalRunPassRateDisplay,
  isDesktopPiEvalRunProvenance,
} from "@/components/settings/eval-result-detail";
import {
  desktopToolbarButtonClassName,
  desktopToolbarGapClassName,
} from "@/lib/desktop-chrome";

function passRateColor(rate: number): string {
  if (rate >= 90) return "text-green-500";
  if (rate >= 70) return "text-yellow-500";
  return "text-red-500";
}

function statusBadge(status: string) {
  switch (status.toLowerCase()) {
    case "pass":
    case "completed":
      return (
        <Badge className="bg-green-600 hover:bg-green-600 text-white">
          {status.toLowerCase()}
        </Badge>
      );
    case "fail":
    case "failed":
      return <Badge variant="destructive">{status.toLowerCase()}</Badge>;
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
    case "cancelled":
      // Cancelled runs stay visible in the list but are excluded from
      // the summary cards and the trend (server-side filter).
      return (
        <Badge
          variant="outline"
          className="text-muted-foreground line-through decoration-1"
        >
          cancelled
        </Badge>
      );
    default:
      return <Badge variant="secondary">{status.toLowerCase()}</Badge>;
  }
}

type RunRow = {
  id: string;
  status: string;
  model: string | null;
  categories: string[];
  agentId: string | null;
  scheduledJobId: string | null;
  passed: number | null;
  failed: number | null;
  // Infra/judge errors (Trust Core U2) — excluded from the score; null
  // on legacy runs where errors were folded into `failed`.
  errored: number | null;
  // Unstable case verdicts (Eval Profiles U4) — scored trials splitting
  // with no majority; excluded from the score like errors.
  unstable: number | null;
  isLegacyScoring: boolean;
  datasetId: string | null;
  datasetVersion: number | null;
  // Eval Profile the run executed against (THINK-107); null on
  // pre-profile runs, which render "Legacy (pre-profile)".
  profileId: string | null;
  profileName: string | null;
  totalTests: number | null;
  passRate: number | null;
  costUsd: number | null;
  // Cost honesty (U5): true when costUsd understates real spend.
  costPartial: boolean;
  completedAt: string | null;
  startedAt: string | null;
  createdAt: string;
  executionTarget?: string | null;
  runtimeHost?: string | null;
};

export function isStartEvaluationDisabled(input: {
  submitting: boolean;
  selectedProfileId: string;
}): boolean {
  return input.submitting || !input.selectedProfileId;
}

/**
 * startEvalRun input builder: runs launch against an Eval Profile
 * (THINK-107) — the profile supplies model, judge pin, and trial count,
 * so the legacy scalar model override is gone from this surface. A
 * dataset launch (Trust Core U6) stays mutually exclusive with the
 * categories filter — picking a dataset drops the category selection
 * from the payload entirely.
 */
export function buildStartEvalRunInput(opts: {
  profileId: string;
  categories: string[];
  datasetSlug: string | null;
}): {
  profileId: string;
  categories?: string[] | null;
  datasetSlug?: string;
} {
  if (opts.datasetSlug) {
    return { profileId: opts.profileId, datasetSlug: opts.datasetSlug };
  }
  return {
    profileId: opts.profileId,
    // Empty selection = "All Categories" (run everything).
    categories: opts.categories.length > 0 ? opts.categories : null,
  };
}

export function isEvaluationDashboardRefreshActive(input: {
  manualRefreshing: boolean;
  summaryFetching: boolean;
  runsFetching: boolean;
  seriesFetching: boolean;
}): boolean {
  return (
    input.manualRefreshing ||
    input.summaryFetching ||
    input.runsFetching ||
    input.seriesFetching
  );
}

export function evalRunCategoryLabel(categories: string[]): string {
  if (categories.length === 0 || categories.length === CATEGORIES.length) {
    return "All Categories";
  }
  if (categories.length === 1) return categories[0] ?? "All Categories";
  return `${categories.length} Categories`;
}

export function evalRunSourceKind(
  run: Pick<RunRow, "executionTarget" | "runtimeHost" | "scheduledJobId">,
): "legacy" | "agentcore-pi" | "schedule" {
  if (isDesktopPiEvalRunProvenance(run)) return "legacy";
  if (run.scheduledJobId) return "schedule";
  return "agentcore-pi";
}

const runsColumns: ColumnDef<RunRow>[] = [
  {
    accessorKey: "status",
    header: "Status",
    cell: ({ row }) => statusBadge(row.original.status),
  },
  {
    accessorKey: "categories",
    header: "Categories",
    cell: ({ row }) => {
      const names = Array.isArray(row.original.categories)
        ? row.original.categories
        : [];
      return (
        <span className="text-sm whitespace-nowrap">
          {evalRunCategoryLabel(names)}
        </span>
      );
    },
  },
  {
    accessorKey: "scheduledJobId",
    header: "Source",
    cell: ({ row }) => {
      const scheduledJobId = row.original.scheduledJobId;
      const sourceKind = evalRunSourceKind(row.original);
      if (sourceKind === "legacy") {
        return (
          <Badge
            variant="secondary"
            className="gap-1 bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
          >
            <History className="h-3 w-3" />
            Legacy run
          </Badge>
        );
      }
      if (sourceKind === "agentcore-pi") {
        return (
          <Badge
            variant="secondary"
            className="gap-1 bg-sky-500/15 text-sky-600 dark:text-sky-400"
          >
            <Cloud className="h-3 w-3" />
            AgentCore Pi
          </Badge>
        );
      }
      return (
        <Link
          to="/settings/automations/$scheduledJobId"
          params={{ scheduledJobId: scheduledJobId ?? "" }}
          onClick={(event) => event.stopPropagation()}
        >
          <Badge
            variant="secondary"
            className="gap-1 bg-cyan-500/15 text-cyan-600 dark:text-cyan-400"
          >
            <CalendarClock className="h-3 w-3" />
            Schedule
          </Badge>
        </Link>
      );
    },
  },
  {
    accessorKey: "profileName",
    header: "Profile",
    cell: ({ row }) => {
      // Pre-profile runs (THINK-107) have no pinned profile — labeled,
      // never blended silently into profile comparisons.
      if (!row.original.profileId) {
        return (
          <Badge
            variant="outline"
            className="text-[10px] text-muted-foreground"
          >
            Legacy (pre-profile)
          </Badge>
        );
      }
      return (
        <span className="text-xs whitespace-nowrap">
          {row.original.profileName ?? "—"}
        </span>
      );
    },
  },
  {
    accessorKey: "model",
    header: "Model",
    cell: ({ row }) => {
      const model = row.original.model;
      if (!model)
        return <span className="text-xs text-muted-foreground">—</span>;
      return (
        <span className="text-xs text-muted-foreground whitespace-nowrap">
          {shortModelLabel(model)}
        </span>
      );
    },
  },
  {
    id: "tests",
    header: "Tests",
    cell: ({ row }) => (
      <span className="text-sm tabular-nums">
        {row.original.passed ?? 0}/{row.original.totalTests ?? 0}
      </span>
    ),
  },
  {
    accessorKey: "passRate",
    header: "Pass Rate",
    cell: ({ row }) => {
      // Score over clean executions (errors excluded, overrides applied
      // server-side). Null pass rate renders "No score" — never 0%.
      const display = evalRunPassRateDisplay(row.original);
      const pct = display.endsWith("%") ? parseFloat(display) : null;
      return (
        <span className="flex items-center gap-1.5 whitespace-nowrap">
          <span
            className={cn(
              "text-sm font-medium tabular-nums",
              pct != null ? passRateColor(pct) : "text-muted-foreground",
            )}
          >
            {display}
          </span>
          {row.original.isLegacyScoring && (
            <Badge
              variant="outline"
              className="text-[10px] text-muted-foreground"
              title="Scored before scoring v2: errors counted as failures. Not comparable to current pass rates."
            >
              legacy scoring
            </Badge>
          )}
        </span>
      );
    },
  },
  {
    accessorKey: "errored",
    header: "Errors",
    cell: ({ row }) => {
      const errored = row.original.errored ?? 0;
      if (errored <= 0)
        return <span className="text-xs text-muted-foreground">—</span>;
      return (
        <Badge
          variant="outline"
          className="gap-1 border-amber-500/50 text-amber-600 dark:text-amber-400 tabular-nums"
          title="Infra/judge errors — excluded from the score. Open the run for the cause breakdown."
        >
          <AlertTriangle className="h-3 w-3" />
          {errored}
        </Badge>
      );
    },
  },
  {
    accessorKey: "unstable",
    header: "Unstable",
    cell: ({ row }) => {
      const unstable = row.original.unstable ?? 0;
      if (unstable <= 0)
        return <span className="text-xs text-muted-foreground">—</span>;
      return (
        <Badge
          variant="outline"
          className="gap-1 border-purple-500/50 text-purple-600 dark:text-purple-400 tabular-nums"
          title="Cases whose scored trials split with no majority — excluded from the score like errors."
        >
          {unstable}
        </Badge>
      );
    },
  },
  {
    accessorKey: "costUsd",
    header: "Cost",
    cell: ({ row }) => (
      <span className="text-xs text-muted-foreground tabular-nums whitespace-nowrap">
        {row.original.costUsd != null
          ? `$${Number(row.original.costUsd).toFixed(4)}`
          : "—"}
        {row.original.costUsd != null && row.original.costPartial && (
          <span
            className="ml-1 text-amber-600 dark:text-amber-400"
            title="Some result rows are missing priced agent-turn cost — this total understates real spend."
          >
            (partial)
          </span>
        )}
      </span>
    ),
  },
  {
    id: "date",
    header: "Date",
    cell: ({ row }) => (
      <span className="text-xs text-muted-foreground whitespace-nowrap">
        {row.original.completedAt
          ? relativeTime(row.original.completedAt)
          : row.original.startedAt
            ? relativeTime(row.original.startedAt)
            : relativeTime(row.original.createdAt)}
      </span>
    ),
  },
];

// Zero-fill the last 30 days so the chart always renders with a consistent
// x-axis even when there are few runs.
function buildLast30Days(
  timeSeries: Array<{
    day: string;
    passRate?: number | null;
    passed?: number;
    failed?: number;
  }>,
) {
  const lookup = new Map(
    timeSeries.map((d) => [
      d.day,
      { ...d, passRate: d.passRate != null ? d.passRate * 100 : null },
    ]),
  );
  const days: Array<{ day: string; passRate: number | null }> = [];
  const now = new Date();
  for (let i = 29; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    days.push(lookup.get(key) ?? { day: key, passRate: null });
  }
  return days;
}

export function SettingsEvaluations() {
  const { tenantId } = useTenant();
  const navigate = useNavigate();
  const [manualRefreshing, setManualRefreshing] = useState(false);

  const [summary, refetchSummary] = useQuery({
    query: EvalSummaryQuery,
    variables: { tenantId: tenantId ?? "" },
    pause: !tenantId,
  });
  const [runs, refetchRuns] = useQuery({
    query: EvalRunsQuery,
    variables: { tenantId: tenantId ?? "", limit: 25, offset: 0 },
    pause: !tenantId,
  });
  const [series, refetchSeries] = useQuery({
    query: EvalTimeSeriesQuery,
    variables: { tenantId: tenantId ?? "", days: 30 },
    pause: !tenantId,
  });

  const refreshEvaluationDashboard = () => {
    setManualRefreshing(true);
    refetchSummary({ requestPolicy: "network-only" });
    refetchRuns({ requestPolicy: "network-only" });
    refetchSeries({ requestPolicy: "network-only" });
  };

  const dashboardRefreshing = isEvaluationDashboardRefreshActive({
    manualRefreshing,
    summaryFetching: summary.fetching,
    runsFetching: runs.fetching,
    seriesFetching: series.fetching,
  });

  useEffect(() => {
    if (!manualRefreshing) return;
    if (summary.fetching || runs.fetching || series.fetching) return;
    const timeout = window.setTimeout(() => setManualRefreshing(false), 250);
    return () => window.clearTimeout(timeout);
  }, [manualRefreshing, runs.fetching, series.fetching, summary.fetching]);

  // Refetch summary, runs, and trend data on subscription pings.
  useSubscription(
    {
      query: OnEvalRunUpdatedSubscription,
      variables: { tenantId: tenantId ?? "" },
      pause: !tenantId,
    },
    () => {
      refetchSummary({ requestPolicy: "network-only" });
      refetchRuns({ requestPolicy: "network-only" });
      refetchSeries({ requestPolicy: "network-only" });
      return null;
    },
  );

  const s = summary.data?.evalSummary;
  const items = (runs.data?.evalRuns?.items ?? []) as unknown as RunRow[];
  const points = series.data?.evalTimeSeries ?? [];
  const hasActiveRun = items.some((run) =>
    ["pending", "running"].includes(String(run.status).toLowerCase()),
  );

  useEffect(() => {
    if (!hasActiveRun) return;
    const interval = window.setInterval(() => {
      refetchSummary({ requestPolicy: "network-only" });
      refetchRuns({ requestPolicy: "network-only" });
      refetchSeries({ requestPolicy: "network-only" });
    }, 3000);
    return () => window.clearInterval(interval);
  }, [hasActiveRun, refetchRuns, refetchSeries, refetchSummary]);

  usePageHeaderActions({
    title: "Evaluations",
    breadcrumbs: [{ label: "Evaluations" }],
    action: tenantId ? (
      <div className={cn("flex items-center", desktopToolbarGapClassName)}>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          title="Refresh evaluations"
          aria-label="Refresh evaluations"
          className={desktopToolbarButtonClassName}
          disabled={dashboardRefreshing}
          onClick={refreshEvaluationDashboard}
        >
          <RefreshCw
            className={cn("size-4", dashboardRefreshing && "animate-spin")}
          />
        </Button>
        <Button
          asChild
          variant="ghost"
          size="icon-sm"
          title="Datasets"
          aria-label="Datasets"
          className={desktopToolbarButtonClassName}
        >
          <Link to="/settings/evaluations/datasets">
            <Database className="size-4" />
          </Link>
        </Button>
        <Button
          asChild
          variant="ghost"
          size="icon-sm"
          title="Profiles"
          aria-label="Profiles"
          className={desktopToolbarButtonClassName}
        >
          <Link to="/settings/evaluations/profiles">
            <Layers className="size-4" />
          </Link>
        </Button>
        <Button
          asChild
          variant="ghost"
          size="icon-sm"
          title="Compare profiles"
          aria-label="Compare profiles"
          className={desktopToolbarButtonClassName}
        >
          <Link to="/settings/evaluations/compare">
            <GitCompareArrows className="size-4" />
          </Link>
        </Button>
        <Button
          asChild
          variant="ghost"
          size="icon-sm"
          title="Studio"
          aria-label="Studio"
          className={desktopToolbarButtonClassName}
        >
          <Link to="/settings/evaluations/studio">
            <SlidersHorizontal className="size-4" />
          </Link>
        </Button>
        <Button
          asChild
          variant="ghost"
          size="icon-sm"
          title="Replay tools"
          aria-label="Replay tools"
          className={desktopToolbarButtonClassName}
        >
          <Link to="/settings/evaluations/replay-tools">
            <ShieldCheck className="size-4" />
          </Link>
        </Button>
        <RunEvaluationButton
          tenantId={tenantId}
          onStarted={() => {
            refetchSummary({ requestPolicy: "network-only" });
            refetchRuns({ requestPolicy: "network-only" });
            refetchSeries({ requestPolicy: "network-only" });
          }}
        />
      </div>
    ) : undefined,
    actionKey: `evals:${tenantId ?? ""}:${dashboardRefreshing ? "refreshing" : "idle"}`,
  });

  if (!tenantId) {
    return (
      <div className="flex h-full items-center justify-center">
        <LoadingShimmer />
      </div>
    );
  }

  return (
    <SettingsPane className="max-w-none">
      <SettingsPageTitle
        title="Evaluations"
        description="Author test cases and review automated evaluation runs."
      />
      <div className="space-y-6">
        {/* Summary metric cards */}
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4 *:data-[slot=card]:shadow-xs dark:*:data-[slot=card]:bg-card">
          <MetricCard
            label="Total Runs"
            value={s?.totalRuns ?? 0}
            icon={<ShieldCheck className="h-4 w-4" />}
          />
          <MetricCard
            label="Latest Pass Rate"
            value={
              s?.latestPassRate != null
                ? `${(s.latestPassRate * 100).toFixed(1)}%`
                : "No score"
            }
            subtitle="Over clean executions — errors excluded"
            icon={<ShieldCheck className="h-4 w-4" />}
            className={
              s?.latestPassRate != null
                ? passRateColor(s.latestPassRate * 100)
                : "text-muted-foreground"
            }
          />
          <MetricCard
            label="Average Score"
            value={
              s?.avgPassRate != null
                ? `${(s.avgPassRate * 100).toFixed(1)}%`
                : "No score"
            }
            subtitle="Over clean executions — errors excluded"
            icon={<ShieldCheck className="h-4 w-4" />}
          />
          <MetricCard
            label="Regressions"
            value={s?.regressionCount ?? 0}
            icon={<AlertTriangle className="h-4 w-4" />}
            className={(s?.regressionCount ?? 0) > 0 ? "text-red-500" : ""}
          />
        </div>

        {/* Pass Rate Trend — zero-filled 30 days so the chart stays consistent */}
        <Card>
          <CardHeader>
            <CardTitle>Pass Rate Trend</CardTitle>
            <CardDescription>
              Last 30 days · scoring v2 — pass rate over clean executions;
              errors and cancelled runs excluded. Runs scored under legacy
              semantics are not plotted.
            </CardDescription>
          </CardHeader>
          <CardContent style={{ height: 280 }}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={buildLast30Days(points)}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="day" />
                <YAxis domain={[0, 100]} unit="%" />
                <Tooltip />
                <Line
                  type="monotone"
                  dataKey="passRate"
                  stroke="#22c55e"
                  strokeWidth={2}
                  dot={{ r: 3 }}
                  connectNulls
                />
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        {/* Recent Runs — DataTable with row-click → run detail */}
        <div className="space-y-2">
          <h3 className="text-sm font-semibold uppercase tracking-wide">
            Recent Runs
          </h3>
          {items.length === 0 ? (
            <Card>
              <CardContent className="py-8 text-center text-sm text-muted-foreground">
                No runs yet — click "Run Evaluation" to start.
              </CardContent>
            </Card>
          ) : (
            <DataTable
              columns={runsColumns}
              data={items}
              pageSize={25}
              onRowClick={(run) =>
                navigate({
                  to: "/settings/evaluations/$runId",
                  params: { runId: run.id },
                })
              }
            />
          )}
        </div>
      </div>
    </SettingsPane>
  );
}

function RunEvaluationButton({
  tenantId,
  onStarted,
}: {
  tenantId: string;
  onStarted: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [selectedCats, setSelectedCats] = useState<string[]>([]);
  const [selectedDataset, setSelectedDataset] = useState<string | null>(null);
  const [selectedProfileId, setSelectedProfileId] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [, startEvalRun] = useMutation(StartEvalRunMutation);

  // Dataset launches (Trust Core U6) are mutually exclusive with the
  // categories filter — picking one clears the other.
  const [datasetsResult] = useQuery({
    query: EvalDatasetsQuery,
    variables: { tenantId },
    pause: !open,
  });
  const datasets = datasetsResult.data?.evalDatasets ?? [];

  // Eval Profiles (THINK-107): the run executes against a profile —
  // model, judge pin, and trial count all come from it. Archived
  // profiles are excluded server-side; the tenant default preselects.
  const [profilesResult] = useQuery({
    query: EvalProfilesQuery,
    variables: { tenantId },
    pause: !open,
  });
  const profiles = profilesResult.data?.evalProfiles ?? [];
  const selectedProfile =
    profiles.find((p) => p.id === selectedProfileId) ?? null;
  useEffect(() => {
    if (selectedProfileId || profiles.length === 0) return;
    const preselected = profiles.find((p) => p.isDefault) ?? profiles[0];
    if (preselected) setSelectedProfileId(preselected.id);
  }, [profiles, selectedProfileId]);

  function toggleCat(id: string) {
    setSelectedDataset(null);
    setSelectedCats((cur) =>
      cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id],
    );
  }

  function pickDataset(slug: string | null) {
    setSelectedDataset(slug);
    if (slug) setSelectedCats([]);
  }

  async function handleStart() {
    setSubmitting(true);
    try {
      const res = await startEvalRun({
        tenantId,
        input: buildStartEvalRunInput({
          profileId: selectedProfileId,
          categories: selectedCats,
          datasetSlug: selectedDataset,
        }),
      });
      if (res.error) {
        alert(`Run failed: ${res.error.message}`);
        return;
      }
      onStarted();
      setOpen(false);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          title="Run evaluation"
          aria-label="Run evaluation"
          className={desktopToolbarButtonClassName}
        >
          <Play className="size-4" />
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Run Evaluation</DialogTitle>
          <DialogDescription>
            Run selected tests directly against the selected or default Agent.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label>Profile</Label>
            <p className="text-xs text-muted-foreground">
              The run executes against a profile — its model, judge pin, and
              trial count are pinned at dispatch.{" "}
              <Link
                to="/settings/evaluations/profiles"
                className="underline underline-offset-2"
                onClick={() => setOpen(false)}
              >
                Manage profiles
              </Link>
            </p>
            <div className="flex flex-wrap gap-2">
              {profiles.map((profile) => (
                <Chip
                  key={profile.id}
                  selected={selectedProfileId === profile.id}
                  onClick={() => setSelectedProfileId(profile.id)}
                >
                  {profile.name}
                  {profile.isDefault && (
                    <span className="ml-1 text-xs opacity-70">default</span>
                  )}
                </Chip>
              ))}
            </div>
            {selectedProfile && (
              <p className="text-xs text-muted-foreground">
                Model {shortModelLabel(selectedProfile.model)} · Judge{" "}
                {selectedProfile.judgeModel
                  ? shortModelLabel(selectedProfile.judgeModel)
                  : "platform default"}{" "}
                · {selectedProfile.trials}{" "}
                {selectedProfile.trials === 1 ? "trial" : "trials"}
              </p>
            )}
          </div>

          <div className="flex flex-col gap-2">
            <Label>Categories</Label>
            <div className="flex flex-wrap gap-2">
              <Chip
                selected={selectedDataset === null && selectedCats.length === 0}
                onClick={() => {
                  setSelectedDataset(null);
                  setSelectedCats([]);
                }}
              >
                All Categories
              </Chip>
              {CATEGORIES.map((c) => (
                <Chip
                  key={c.id}
                  selected={selectedCats.includes(c.id)}
                  onClick={() => toggleCat(c.id)}
                >
                  {c.label}
                </Chip>
              ))}
            </div>
          </div>

          {datasets.length > 0 && (
            <div className="flex flex-col gap-2">
              <Label>Dataset</Label>
              <p className="text-xs text-muted-foreground">
                Run one dataset instead of categories. The run pins the
                dataset&apos;s current version — mid-run edits can&apos;t change
                what it scores.
              </p>
              <div className="flex flex-wrap gap-2">
                {datasets.map((dataset) => (
                  <Chip
                    key={dataset.slug}
                    selected={selectedDataset === dataset.slug}
                    onClick={() =>
                      pickDataset(
                        selectedDataset === dataset.slug ? null : dataset.slug,
                      )
                    }
                  >
                    {dataset.name ?? dataset.slug}
                    <span className="ml-1 text-xs opacity-70">
                      {dataset.kind} · v{dataset.version}
                    </span>
                  </Chip>
                ))}
              </div>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => setOpen(false)}
            disabled={submitting}
          >
            Cancel
          </Button>
          <Button
            onClick={handleStart}
            disabled={isStartEvaluationDisabled({
              submitting,
              selectedProfileId,
            })}
          >
            {submitting ? "Starting…" : "Start Evaluation"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Chip({
  selected,
  onClick,
  children,
}: {
  selected: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-full border px-3 py-1 text-sm transition-colors",
        selected
          ? "bg-foreground text-background border-foreground"
          : "bg-transparent text-foreground border-border hover:bg-accent",
      )}
    >
      {children}
    </button>
  );
}
