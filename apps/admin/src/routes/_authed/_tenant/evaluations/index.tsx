import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useSubscription, useMutation } from "urql";
import { Beaker, Calendar, Play, ShieldAlert, ShieldCheck, TrendingUp } from "lucide-react";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";

import { useTenant } from "@/context/TenantContext";
import { useBreadcrumbs } from "@/context/BreadcrumbContext";
import { PageHeader } from "@/components/PageHeader";
import { PageLayout } from "@/components/PageLayout";
import { PageSkeleton } from "@/components/PageSkeleton";
import { MetricCard } from "@/components/MetricCard";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
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

const INVOCATION_MODES = [
  { id: "end_to_end", label: "End-to-End (full agent runtime)" },
  { id: "direct", label: "Direct (Bedrock only)" },
];

export const Route = createFileRoute("/_authed/_tenant/evaluations/")({
  component: EvaluationsPage,
});

function EvaluationsPage() {
  const { tenantId } = useTenant();
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

  const fmtPct = (n?: number | null) => (typeof n === "number" ? `${(n * 100).toFixed(1)}%` : "—");

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
      <div className="flex flex-col gap-6">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard label="Total Runs" value={s?.totalRuns ?? 0} icon={<TrendingUp className="h-4 w-4" />} />
        <MetricCard label="Latest Pass Rate" value={fmtPct(s?.latestPassRate)} icon={<ShieldCheck className="h-4 w-4" />} />
        <MetricCard label="Average Score" value={fmtPct(s?.avgPassRate)} icon={<TrendingUp className="h-4 w-4" />} />
        <MetricCard label="Regressions" value={s?.regressionCount ?? 0} icon={<ShieldAlert className="h-4 w-4" />} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Pass Rate Trend</CardTitle>
          <p className="text-sm text-muted-foreground">Last 30 days</p>
        </CardHeader>
        <CardContent style={{ height: 280 }}>
          {points.length === 0 ? (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
              No completed runs yet
            </div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={points.map((p: any) => ({ ...p, passRatePct: p.passRate ? p.passRate * 100 : null }))}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="day" />
                <YAxis domain={[0, 100]} unit="%" />
                <Tooltip />
                <Line type="monotone" dataKey="passRatePct" stroke="#22c55e" strokeWidth={2} dot={{ r: 3 }} />
              </LineChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Recent Runs</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Status</TableHead>
                <TableHead>Categories</TableHead>
                <TableHead>Model</TableHead>
                <TableHead>Tests</TableHead>
                <TableHead>Pass Rate</TableHead>
                <TableHead>Cost</TableHead>
                <TableHead>Date</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center text-muted-foreground">
                    No runs yet — click "Run Evaluation" to start.
                  </TableCell>
                </TableRow>
              ) : (
                items.map((r: any) => (
                  <TableRow key={r.id}>
                    <TableCell>
                      <Badge variant={r.status === "completed" ? "default" : r.status === "failed" ? "destructive" : "secondary"}>
                        {r.status}
                      </Badge>
                      {r.regression && <Badge variant="destructive" className="ml-1">regression</Badge>}
                    </TableCell>
                    <TableCell>{r.categories?.length ? `${r.categories.length} categories` : "—"}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{r.model ?? "—"}</TableCell>
                    <TableCell>{r.passed}/{r.totalTests}</TableCell>
                    <TableCell className={r.passRate && r.passRate >= 0.9 ? "text-green-600" : r.passRate && r.passRate >= 0.7 ? "text-yellow-600" : "text-red-600"}>
                      {fmtPct(r.passRate)}
                    </TableCell>
                    <TableCell className="text-xs">{r.costUsd ? `$${Number(r.costUsd).toFixed(4)}` : "—"}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      <Link to="/evaluations/$runId" params={{ runId: r.id }} className="hover:underline">
                        {relativeTime(r.completedAt ?? r.createdAt)}
                      </Link>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
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
  const [runImprovement, setRunImprovement] = useState<boolean>(false);
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

          <div className="flex items-start gap-3 rounded-md border p-3">
            <Switch id="re-improve" checked={runImprovement} onCheckedChange={setRunImprovement} />
            <div className="flex flex-col">
              <Label htmlFor="re-improve" className="font-medium">Run Improvement Agent</Label>
              <p className="text-xs text-muted-foreground">Analyze failures and suggest fixes after eval completes</p>
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
