import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useQuery, useSubscription, useMutation } from "urql";
import { Beaker, Calendar, Play, ShieldAlert, ShieldCheck, TrendingUp } from "lucide-react";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";

import { useTenant } from "@/context/TenantContext";
import { PageHeader } from "@/components/PageHeader";
import { PageSkeleton } from "@/components/PageSkeleton";
import { MetricCard } from "@/components/MetricCard";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { relativeTime } from "@/lib/utils";
import {
  EvalSummaryQuery,
  EvalRunsQuery,
  EvalTimeSeriesQuery,
  StartEvalRunMutation,
  OnEvalRunUpdatedSubscription,
} from "@/lib/graphql-queries";

export const Route = createFileRoute("/_authed/_tenant/evaluations/")({
  component: EvaluationsPage,
});

function EvaluationsPage() {
  const { tenantId } = useTenant();

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
    <div className="flex flex-col gap-6 p-6">
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
  );
}

// ---------------------------------------------------------------------------
// Run Evaluation dialog (inline — keeps the route self-contained for v1)
// ---------------------------------------------------------------------------

function RunEvaluationButton({ tenantId, onStarted }: { tenantId: string; onStarted: () => void }) {
  const [open, setOpen] = useState(false);
  const [model, setModel] = useState("");
  const [categoriesText, setCategoriesText] = useState("");
  const [, startEvalRun] = useMutation(StartEvalRunMutation);
  const [submitting, setSubmitting] = useState(false);

  async function handleStart() {
    setSubmitting(true);
    try {
      const categories = categoriesText.split(",").map((c) => c.trim()).filter(Boolean);
      await startEvalRun({
        tenantId,
        input: {
          model: model || null,
          categories: categories.length > 0 ? categories : null,
        },
      });
      onStarted();
      setOpen(false);
      setModel("");
      setCategoriesText("");
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
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Run Evaluation</DialogTitle>
          <DialogDescription>
            Kicks off a new run against the agent under test. Leave fields empty to run all enabled test cases.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <Label htmlFor="model">Model (optional)</Label>
            <Input id="model" placeholder="us.anthropic.claude-sonnet-4-6" value={model} onChange={(e) => setModel(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="categories">Categories (comma-separated, optional)</Label>
            <Input id="categories" placeholder="tool-safety, red-team" value={categoriesText} onChange={(e) => setCategoriesText(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={submitting}>Cancel</Button>
          <Button onClick={handleStart} disabled={submitting}>{submitting ? "Starting…" : "Start Run"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
