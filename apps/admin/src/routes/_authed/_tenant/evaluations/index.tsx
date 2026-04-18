import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useSubscription, useMutation } from "urql";
import { type ColumnDef } from "@tanstack/react-table";
import { AlertTriangle, Beaker, Calendar, Loader2, Play, ShieldCheck } from "lucide-react";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";

import { useTenant } from "@/context/TenantContext";
import { useBreadcrumbs } from "@/context/BreadcrumbContext";
import { PageHeader } from "@/components/PageHeader";
import { PageLayout } from "@/components/PageLayout";
import { PageSkeleton } from "@/components/PageSkeleton";
import { MetricCard } from "@/components/MetricCard";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { DataTable } from "@/components/ui/data-table";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { cn, relativeTime } from "@/lib/utils";
import {
  AgentTemplatesListQuery,
  ModelCatalogQuery,
  EvalSummaryQuery,
  EvalRunsQuery,
  EvalTimeSeriesQuery,
  StartEvalRunMutation,
  OnEvalRunUpdatedSubscription,
} from "@/lib/graphql-queries";

// Mirror maniflow's RunEvaluationDialog category list. Labels are
// title-case versions of the seed-pack category slugs (see
// seeds/eval-test-cases/*.json).
const CATEGORIES: Array<{ id: string; label: string }> = [
  { id: "email-calendar", label: "Email & Calendar" },
  { id: "knowledge-base", label: "Knowledge Base" },
  { id: "mcp-gateway", label: "MCP Gateway" },
  { id: "red-team", label: "Red Team" },
  { id: "sub-agents", label: "Sub-Agents" },
  { id: "thread-management", label: "Thread Management" },
  { id: "tool-safety", label: "Tool Safety" },
  { id: "workspace-memory", label: "Workspace Memory" },
  { id: "workspace-routing", label: "Workspace Routing" },
];

// ---------------------------------------------------------------------------
// Recent Runs table — ported from maniflow for row clickability, colour-coded
// pass rates, shortened model names, and "N Categories" summary.
// ---------------------------------------------------------------------------

function passRateColor(rate: number): string {
  if (rate >= 90) return "text-green-500";
  if (rate >= 70) return "text-yellow-500";
  return "text-red-500";
}

function statusBadge(status: string) {
  switch (status.toLowerCase()) {
    case "pass":
    case "completed":
      return <Badge className="bg-green-600 hover:bg-green-600 text-white">{status.toLowerCase()}</Badge>;
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
  agentTemplateId: string | null;
  agentTemplateName: string | null;
  passed: number | null;
  failed: number | null;
  totalTests: number | null;
  passRate: number | null;
  costUsd: number | null;
  completedAt: string | null;
  startedAt: string | null;
  createdAt: string;
};

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
      const names = Array.isArray(row.original.categories) ? row.original.categories : [];
      if (names.length === 0) return <span className="text-xs text-muted-foreground">—</span>;
      if (names.length === CATEGORIES.length) return <span className="text-sm whitespace-nowrap">All Categories</span>;
      if (names.length === 1) return <span className="text-sm whitespace-nowrap">{names[0]}</span>;
      return <span className="text-sm whitespace-nowrap">{names.length} Categories</span>;
    },
  },
  {
    accessorKey: "agentTemplateName",
    header: "Template",
    cell: ({ row }) => {
      const name = row.original.agentTemplateName;
      if (!name) return <span className="text-xs text-muted-foreground">—</span>;
      return <span className="text-sm whitespace-nowrap">{name}</span>;
    },
  },
  {
    accessorKey: "model",
    header: "Model",
    cell: ({ row }) => {
      const model = row.original.model;
      if (!model) return <span className="text-xs text-muted-foreground">—</span>;
      const short = model
        .replace(/^us\.anthropic\./, "")
        .replace(/^anthropic\./, "")
        .replace(/^moonshotai\./, "")
        .replace(/^amazon\./, "")
        .replace(/-v\d+:\d+$/, "")
        .replace(/-\d{8}$/, "");
      return <span className="text-xs text-muted-foreground whitespace-nowrap">{short}</span>;
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
      const pct = completed > 0
        ? ((passed ?? 0) / completed) * 100
        : passRate != null ? passRate * 100 : null;
      return (
        <span className={`text-sm font-medium tabular-nums ${passRateColor(pct ?? 0)}`}>
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
        {row.original.costUsd != null ? `$${Number(row.original.costUsd).toFixed(4)}` : "—"}
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
function buildLast30Days(timeSeries: Array<{ day: string; passRate: number | null; passed?: number; failed?: number }>) {
  const lookup = new Map(
    timeSeries.map((d) => [d.day, { ...d, passRate: d.passRate != null ? d.passRate * 100 : null }]),
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

const INVOCATION_MODES = [
  { id: "end_to_end", label: "End-to-End (full agent runtime)" },
  { id: "direct", label: "Direct (Bedrock only)" },
];

export const Route = createFileRoute("/_authed/_tenant/evaluations/")({
  component: EvaluationsPage,
});

function EvaluationsPage() {
  const { tenantId } = useTenant();
  const navigate = useNavigate();
  useBreadcrumbs([{ label: "Evaluations" }]);

  const [summary, refetchSummary] = useQuery({
    query: EvalSummaryQuery,
    variables: { tenantId },
    pause: !tenantId,
  });
  const [runs, refetchRuns] = useQuery({
    query: EvalRunsQuery,
    variables: { tenantId, limit: 25, offset: 0 },
    pause: !tenantId,
  });
  const [series] = useQuery({
    query: EvalTimeSeriesQuery,
    variables: { tenantId, days: 30 },
    pause: !tenantId,
  });

  // Refetch summary + runs on subscription pings.
  useSubscription({
    query: OnEvalRunUpdatedSubscription,
    variables: { tenantId },
    pause: !tenantId,
  }, () => {
    refetchSummary({ requestPolicy: "network-only" });
    refetchRuns({ requestPolicy: "network-only" });
    return null;
  });

  if (!tenantId) return <PageSkeleton />;

  const s = summary.data?.evalSummary;
  const items = runs.data?.evalRuns?.items ?? [];
  const points = series.data?.evalTimeSeries ?? [];

  return (
    <PageLayout
      header={
        <PageHeader
          title="Evaluations"
          description={s ? `${s.totalRuns} total runs` : ""}
          actions={
            <div className="flex gap-2">
              <Button asChild variant="outline" size="sm">
                <Link to="/evaluations/studio">
                  <Beaker className="mr-1 h-4 w-4" /> Studio
                </Link>
              </Button>
              <Button asChild variant="outline" size="sm">
                <Link to="/scheduled-jobs" search={{ type: "eval_scheduled" }}>
                  <Calendar className="mr-1 h-4 w-4" /> Schedules
                </Link>
              </Button>
              <RunEvaluationButton tenantId={tenantId} onStarted={() => {
                refetchSummary({ requestPolicy: "network-only" });
                refetchRuns({ requestPolicy: "network-only" });
              }} />
            </div>
          }
        />
      }
    >
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
            className={passRateColor(((s?.latestPassRate ?? 0) * 100))}
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
          <h3 className="text-sm font-semibold uppercase tracking-wide">Recent Runs</h3>
          {items.length === 0 ? (
            <Card>
              <CardContent className="py-8 text-center text-sm text-muted-foreground">
                No runs yet — click "Run Evaluation" to start.
              </CardContent>
            </Card>
          ) : (
            <DataTable
              columns={runsColumns}
              data={items as RunRow[]}
              pageSize={25}
              onRowClick={(run) =>
                navigate({ to: "/evaluations/$runId", params: { runId: run.id } })
              }
            />
          )}
        </div>
      </div>
    </PageLayout>
  );
}

// ---------------------------------------------------------------------------
// Run Evaluation dialog (inline — keeps the route self-contained for v1)
// ---------------------------------------------------------------------------

function RunEvaluationButton({ tenantId, onStarted }: { tenantId: string; onStarted: () => void }) {
  const [open, setOpen] = useState(false);
  // The agent itself is always the eval test agent (a generic AgentCore
  // Runtime instance). What the user picks here is which template the
  // test agent loads — that determines workspace / tools / model.
  const [agentTemplateId, setAgentTemplateId] = useState<string>("");
  const [model, setModel] = useState<string>("");
  const [invocationMode, setInvocationMode] = useState<string>("end_to_end");
  const [selectedCats, setSelectedCats] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [, startEvalRun] = useMutation(StartEvalRunMutation);

  // Pull agent templates and the model catalog (separate queries — the
  // codegen-typed AgentTemplatesListQuery doesn't include modelCatalog).
  const [templatesRes] = useQuery({
    query: AgentTemplatesListQuery,
    variables: { tenantId },
    pause: !tenantId || !open,
  });
  const [modelsRes] = useQuery({ query: ModelCatalogQuery, pause: !open });
  const templates = (templatesRes.data?.agentTemplates ?? []) as Array<{ id: string; name: string }>;
  const modelCatalog = (modelsRes.data?.modelCatalog ?? []) as Array<{ modelId: string; displayName: string }>;

  function toggleCat(id: string) {
    setSelectedCats((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));
  }

  async function handleStart() {
    if (!agentTemplateId) return; // template is required
    setSubmitting(true);
    try {
      const res = await startEvalRun({
        tenantId,
        input: {
          agentTemplateId,
          model: model || null,
          // Empty selection = "All Categories" (run everything).
          categories: selectedCats.length > 0 ? selectedCats : null,
        },
      });
      if (res.error) {
        alert(`Run failed: ${res.error.message}\n\nIf this mentions an unknown field like 'agentTemplateId', the deployed graphql-http hasn't picked up the latest schema yet. Wait for the next deploy on main.`);
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
        <Button size="sm">
          <Play className="mr-1 h-4 w-4" /> Run Evaluation
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Run Evaluation</DialogTitle>
          <DialogDescription>
            The eval test agent loads the chosen template's workspace + tools and runs every selected test case through it.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="re-template">Agent template</Label>
            <Select value={agentTemplateId} onValueChange={setAgentTemplateId}>
              <SelectTrigger id="re-template">
                <SelectValue placeholder="Pick a template" />
              </SelectTrigger>
              <SelectContent>
                {templates.map((t) => (
                  <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              The eval test agent loads this template's workspace, skills, and default model. Per-test-case template overrides still apply.
            </p>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="re-model">Model</Label>
            <Select value={model} onValueChange={setModel}>
              <SelectTrigger id="re-model">
                <SelectValue placeholder="Use template default" />
              </SelectTrigger>
              <SelectContent>
                {modelCatalog.map((m) => (
                  <SelectItem key={m.modelId} value={m.modelId}>{m.displayName}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="re-mode">Invocation Mode</Label>
            <Select value={invocationMode} onValueChange={setInvocationMode}>
              <SelectTrigger id="re-mode">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {INVOCATION_MODES.map((m) => (
                  <SelectItem key={m.id} value={m.id}>{m.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

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
          <Button variant="outline" onClick={() => setOpen(false)} disabled={submitting}>Cancel</Button>
          <Button onClick={handleStart} disabled={submitting || !agentTemplateId}>{submitting ? "Starting…" : "Start Evaluation"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// Pill-style category chip — matches maniflow's selected/unselected look.
function Chip({ selected, onClick, children }: { selected: boolean; onClick: () => void; children: React.ReactNode }) {
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
