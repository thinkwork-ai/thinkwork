import { Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useMutation, useQuery, useSubscription } from "urql";
import { type ColumnDef } from "@tanstack/react-table";
import {
  AlertTriangle,
  CalendarClock,
  Cloud,
  Loader2,
  MonitorCog,
  Play,
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
  Input,
  Label,
} from "@thinkwork/ui";
import { usePageHeaderActions } from "@/context/PageHeaderContext";
import { useTenant } from "@/context/TenantContext";
import { ModelSelect } from "@/components/agents/ModelSelect";
import { MetricCard } from "@/components/MetricCard";
import { LoadingShimmer } from "@/components/LoadingShimmer";
import {
  SettingsPageTitle,
  SettingsPane,
} from "@/components/settings/SettingsContent";
import { EVAL_CATEGORIES as CATEGORIES } from "@/lib/evaluation-options";
import {
  EvalRunsQuery,
  EvalSummaryQuery,
  EvalTimeSeriesQuery,
  OnEvalRunUpdatedSubscription,
  StartEvalRunMutation,
} from "@/lib/evaluation-queries";
import { cn, relativeTime } from "@/lib/utils";
import {
  canStartDesktopPiEval,
  desktopPiEvalTargetStatus,
  getDesktopBridge,
} from "@/lib/desktop-runtime";
import { rememberDesktopPiEvalRequest } from "@/lib/desktop-pi-eval-requests";
import { useDesktopLocalPiStatus } from "@/lib/use-desktop-local-pi-status";
import { isDesktopPiEvalRunProvenance } from "@/components/settings/eval-result-detail";
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
  totalTests: number | null;
  passRate: number | null;
  costUsd: number | null;
  completedAt: string | null;
  startedAt: string | null;
  createdAt: string;
  executionTarget?: string | null;
  runtimeHost?: string | null;
};

type EvalExecutionTarget = "cloud" | "desktop-pi";
const DESKTOP_PI_EVAL_PARALLEL_THREADS_DEFAULT = 1;
const DESKTOP_PI_EVAL_PARALLEL_THREADS_MIN = 1;
const DESKTOP_PI_EVAL_PARALLEL_THREADS_MAX = 8;

export function shouldShowDesktopPiEvalTarget(
  status: ReturnType<typeof desktopPiEvalTargetStatus>,
): boolean {
  return status !== "hidden";
}

export function isStartEvaluationDisabled(input: {
  submitting: boolean;
  selectedModel: string;
  target: EvalExecutionTarget;
  desktopPiEnabled: boolean;
  desktopPiParallelThreads?: string;
}): boolean {
  return (
    input.submitting ||
    !input.selectedModel ||
    (input.target === "desktop-pi" &&
      (!input.desktopPiEnabled ||
        !isDesktopPiEvalParallelThreadsValid(
          input.desktopPiParallelThreads ??
            String(DESKTOP_PI_EVAL_PARALLEL_THREADS_DEFAULT),
        )))
  );
}

export function normalizeDesktopPiEvalParallelThreads(value: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return DESKTOP_PI_EVAL_PARALLEL_THREADS_DEFAULT;
  return Math.max(
    DESKTOP_PI_EVAL_PARALLEL_THREADS_MIN,
    Math.min(DESKTOP_PI_EVAL_PARALLEL_THREADS_MAX, parsed),
  );
}

export function isDesktopPiEvalParallelThreadsValid(value: string): boolean {
  if (!/^\d+$/.test(value.trim())) return false;
  const parsed = Number.parseInt(value, 10);
  return (
    parsed >= DESKTOP_PI_EVAL_PARALLEL_THREADS_MIN &&
    parsed <= DESKTOP_PI_EVAL_PARALLEL_THREADS_MAX
  );
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
      if (names.length === 0)
        return <span className="text-xs text-muted-foreground">—</span>;
      if (names.length === CATEGORIES.length)
        return (
          <span className="text-sm whitespace-nowrap">All Categories</span>
        );
      if (names.length === 1)
        return <span className="text-sm whitespace-nowrap">{names[0]}</span>;
      return (
        <span className="text-sm whitespace-nowrap">
          {names.length} Categories
        </span>
      );
    },
  },
  {
    accessorKey: "scheduledJobId",
    header: "Source",
    cell: ({ row }) => {
      const scheduledJobId = row.original.scheduledJobId;
      if (isDesktopPiEvalRunProvenance(row.original)) {
        return (
          <Badge
            variant="secondary"
            className="gap-1 bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
          >
            <MonitorCog className="h-3 w-3" />
            Desktop Pi
          </Badge>
        );
      }
      if (!scheduledJobId)
        return <span className="text-xs text-muted-foreground">Manual</span>;
      return (
        <Link
          to="/settings/automations/$scheduledJobId"
          params={{ scheduledJobId }}
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
    accessorKey: "model",
    header: "Model",
    cell: ({ row }) => {
      const model = row.original.model;
      if (!model)
        return <span className="text-xs text-muted-foreground">—</span>;
      const short = model
        .replace(/^us\.anthropic\./, "")
        .replace(/^anthropic\./, "")
        .replace(/^moonshotai\./, "")
        .replace(/^amazon\./, "")
        .replace(/-v\d+:\d+$/, "")
        .replace(/-\d{8}$/, "");
      return (
        <span className="text-xs text-muted-foreground whitespace-nowrap">
          {short}
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
      const { passed, failed, passRate } = row.original;
      const completed = (passed ?? 0) + (failed ?? 0);
      const pct =
        completed > 0
          ? ((passed ?? 0) / completed) * 100
          : passRate != null
            ? passRate * 100
            : null;
      return (
        <span
          className={`text-sm font-medium tabular-nums ${passRateColor(pct ?? 0)}`}
        >
          {pct != null ? `${pct.toFixed(1)}%` : "—"}
        </span>
      );
    },
  },
  {
    accessorKey: "costUsd",
    header: "Cost",
    cell: ({ row }) => (
      <span className="text-xs text-muted-foreground tabular-nums">
        {row.original.costUsd != null
          ? `$${Number(row.original.costUsd).toFixed(4)}`
          : "—"}
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
  const [series] = useQuery({
    query: EvalTimeSeriesQuery,
    variables: { tenantId: tenantId ?? "", days: 30 },
    pause: !tenantId,
  });

  // Refetch summary + runs on subscription pings.
  useSubscription(
    {
      query: OnEvalRunUpdatedSubscription,
      variables: { tenantId: tenantId ?? "" },
      pause: !tenantId,
    },
    () => {
      refetchSummary({ requestPolicy: "network-only" });
      refetchRuns({ requestPolicy: "network-only" });
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
    }, 3000);
    return () => window.clearInterval(interval);
  }, [hasActiveRun, refetchRuns, refetchSummary]);

  usePageHeaderActions({
    title: "Evaluations",
    breadcrumbs: [{ label: "Evaluations" }],
    action: tenantId ? (
      <div className={cn("flex items-center", desktopToolbarGapClassName)}>
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
        <RunEvaluationButton
          tenantId={tenantId}
          onStarted={() => {
            refetchSummary({ requestPolicy: "network-only" });
            refetchRuns({ requestPolicy: "network-only" });
          }}
        />
      </div>
    ) : undefined,
    actionKey: `evals:${tenantId ?? ""}`,
  });

  if (!tenantId) {
    return (
      <div className="flex h-full items-center justify-center">
        <LoadingShimmer />
      </div>
    );
  }

  return (
    <SettingsPane className="max-w-5xl">
      <SettingsPageTitle title="Evaluations" />
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
            value={`${((s?.latestPassRate ?? 0) * 100).toFixed(1)}%`}
            icon={<ShieldCheck className="h-4 w-4" />}
            className={passRateColor((s?.latestPassRate ?? 0) * 100)}
          />
          <MetricCard
            label="Average Score"
            value={`${((s?.avgPassRate ?? 0) * 100).toFixed(1)}%`}
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
            <CardDescription>Last 30 days</CardDescription>
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

const DEFAULT_EVAL_MODEL_ID = "moonshotai.kimi-k2.5";

function RunEvaluationButton({
  tenantId,
  onStarted,
}: {
  tenantId: string;
  onStarted: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [selectedCats, setSelectedCats] = useState<string[]>([]);
  const [selectedModel, setSelectedModel] = useState(DEFAULT_EVAL_MODEL_ID);
  const [target, setTarget] = useState<EvalExecutionTarget>("cloud");
  const [desktopPiParallelThreads, setDesktopPiParallelThreads] = useState(
    String(DESKTOP_PI_EVAL_PARALLEL_THREADS_DEFAULT),
  );
  const [submitting, setSubmitting] = useState(false);
  const [, startEvalRun] = useMutation(StartEvalRunMutation);
  const navigate = useNavigate();
  const localPiDisplayStatus = useDesktopLocalPiStatus();
  const desktopPiStatus = desktopPiEvalTargetStatus(localPiDisplayStatus);
  const desktopPiVisible = shouldShowDesktopPiEvalTarget(desktopPiStatus);
  const desktopPiEnabled = canStartDesktopPiEval(desktopPiStatus);

  useEffect(() => {
    if (!desktopPiVisible && target === "desktop-pi") setTarget("cloud");
  }, [desktopPiVisible, target]);

  function toggleCat(id: string) {
    setSelectedCats((cur) =>
      cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id],
    );
  }

  async function handleStart() {
    setSubmitting(true);
    try {
      if (target === "desktop-pi") {
        const bridge = getDesktopBridge();
        if (!bridge?.pi || !desktopPiEnabled) {
          alert("Desktop Pi is not available for evaluation runs.");
          return;
        }
        try {
          const result = await bridge.pi.startEvalRun({
            tenantId,
            model: selectedModel,
            categories: selectedCats.length > 0 ? selectedCats : undefined,
            parallelThreads: normalizeDesktopPiEvalParallelThreads(
              desktopPiParallelThreads,
            ),
          });
          rememberDesktopPiEvalRequest(result.runId, result.requestId);
          onStarted();
          setOpen(false);
          navigate({
            to: "/settings/evaluations/$runId",
            params: { runId: result.runId },
          });
        } catch (error) {
          alert(
            `Run failed: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
        return;
      }

      const res = await startEvalRun({
        tenantId,
        input: {
          model: selectedModel,
          // Empty selection = "All Categories" (run everything).
          categories: selectedCats.length > 0 ? selectedCats : null,
        },
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
          <div
            className={cn(
              "grid gap-3",
              desktopPiVisible
                ? "grid-cols-[minmax(0,1fr)_8rem]"
                : "grid-cols-1",
            )}
          >
            <div className="flex flex-col gap-1.5">
              <Label>Model</Label>
              <ModelSelect
                value={selectedModel}
                onValueChange={setSelectedModel}
                className="w-full"
              />
            </div>
            {desktopPiVisible && (
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="desktop-pi-eval-parallel-threads">
                  Parallel threads
                </Label>
                <Input
                  id="desktop-pi-eval-parallel-threads"
                  type="number"
                  inputMode="numeric"
                  min={DESKTOP_PI_EVAL_PARALLEL_THREADS_MIN}
                  max={DESKTOP_PI_EVAL_PARALLEL_THREADS_MAX}
                  step={1}
                  value={desktopPiParallelThreads}
                  disabled={target !== "desktop-pi"}
                  onChange={(event) =>
                    setDesktopPiParallelThreads(event.currentTarget.value)
                  }
                  onBlur={() =>
                    setDesktopPiParallelThreads((value) =>
                      String(normalizeDesktopPiEvalParallelThreads(value)),
                    )
                  }
                  aria-invalid={
                    target === "desktop-pi" &&
                    !isDesktopPiEvalParallelThreadsValid(
                      desktopPiParallelThreads,
                    )
                  }
                />
              </div>
            )}
          </div>

          {desktopPiVisible && (
            <div className="flex flex-col gap-2">
              <Label>Target</Label>
              <div className="grid grid-cols-2 gap-2">
                <Button
                  type="button"
                  variant={target === "cloud" ? "default" : "outline"}
                  className="justify-start gap-2"
                  onClick={() => setTarget("cloud")}
                >
                  <Cloud className="h-4 w-4" />
                  Cloud
                </Button>
                <Button
                  type="button"
                  variant={target === "desktop-pi" ? "default" : "outline"}
                  className="justify-start gap-2"
                  disabled={!desktopPiEnabled}
                  title={
                    desktopPiEnabled
                      ? "Desktop Pi"
                      : desktopPiStatus === "busy"
                        ? "Desktop Pi is running another local turn"
                        : "Desktop Pi is unavailable"
                  }
                  onClick={() => setTarget("desktop-pi")}
                >
                  <MonitorCog className="h-4 w-4" />
                  Desktop Pi
                </Button>
              </div>
            </div>
          )}

          <div className="flex flex-col gap-2">
            <Label>Categories</Label>
            <div className="flex flex-wrap gap-2">
              <Chip
                selected={selectedCats.length === 0}
                onClick={() => setSelectedCats([])}
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
              selectedModel,
              target,
              desktopPiEnabled,
              desktopPiParallelThreads,
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
