import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "urql";
import { Activity, Clock, Zap, AlertTriangle } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, LineChart, Line } from "recharts";
import { useTenant } from "@/context/TenantContext";
import { useBreadcrumbs } from "@/context/BreadcrumbContext";
import { PageHeader } from "@/components/PageHeader";
import { PageLayout } from "@/components/PageLayout";
import { MetricCard } from "@/components/MetricCard";
import { PageSkeleton } from "@/components/PageSkeleton";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { formatUsd } from "@/lib/utils";
import { AgentsListQuery } from "@/lib/graphql-queries";

export const Route = createFileRoute("/_authed/_tenant/performance")({
  component: PerformancePage,
});

const timeSeriesConfig = {
  invocationCount: { label: "Invocations", color: "hsl(217, 71%, 53%)" },
  avgDurationMs: { label: "Avg Latency (ms)", color: "hsl(142, 71%, 45%)" },
  totalCostUsd: { label: "Cost ($)", color: "hsl(38, 92%, 50%)" },
} satisfies ChartConfig;

function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60000).toFixed(1)}m`;
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function PerformancePage() {
  const { tenantId } = useTenant();
  useBreadcrumbs([{ label: "Performance" }]);
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);

  const [agentsResult] = useQuery({
    query: AgentsListQuery,
    variables: { tenantId: tenantId! },
    pause: !tenantId,
  });

  if (!tenantId) return <PageSkeleton />;

  const allAgents = (agentsResult.data as any)?.agents ?? [];
  const agents: any[] = [];
  const timeSeries: any[] = [];

  const totals = agents.reduce(
    (acc: { invocations: number; errors: number; cost: number; avgLatency: number }, a: any) => ({
      invocations: acc.invocations + a.invocationCount,
      errors: acc.errors + a.errorCount,
      cost: acc.cost + a.totalCostUsd,
      avgLatency: acc.avgLatency + a.avgDurationMs * a.invocationCount,
    }),
    { invocations: 0, errors: 0, cost: 0, avgLatency: 0 },
  );
  const avgLatency = totals.invocations > 0 ? totals.avgLatency / totals.invocations : 0;

  return (
    <PageLayout
      header={
        <PageHeader
          title="Agent Performance"
          description="Latency, throughput, and token usage across your agents"
          actions={
            <Select
              value={selectedAgentId ?? "all"}
              onValueChange={(v) => setSelectedAgentId(v === "all" ? null : v)}
            >
              <SelectTrigger className="w-48 h-8 text-sm">
                <SelectValue placeholder="All agents" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All agents</SelectItem>
                {allAgents.map((a: any) => (
                  <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          }
        />
      }
    >
      <div className="space-y-6">
        {/* Summary Cards */}
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <MetricCard
            label="Invocations"
            value={totals.invocations.toLocaleString()}
            icon={<Zap className="h-4 w-4" />}
          />
          <MetricCard
            label="Avg Latency"
            value={formatDuration(avgLatency)}
            icon={<Clock className="h-4 w-4" />}
          />
          <MetricCard
            label="Error Rate"
            value={totals.invocations > 0
              ? `${((totals.errors / totals.invocations) * 100).toFixed(1)}%`
              : "0%"
            }
            icon={<AlertTriangle className="h-4 w-4" />}
          />
          <MetricCard
            label="Total Cost"
            value={formatUsd(totals.cost)}
            icon={<Activity className="h-4 w-4" />}
          />
        </div>

        {/* Invocation Trend Chart */}
        {timeSeries.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle>Invocations (30 days)</CardTitle>
            </CardHeader>
            <CardContent>
              <ChartContainer config={timeSeriesConfig} className="h-[250px] w-full">
                <BarChart data={timeSeries}>
                  <XAxis dataKey="day" tickFormatter={(d) => d.slice(5)} />
                  <YAxis />
                  <ChartTooltip content={<ChartTooltipContent />} />
                  <Bar dataKey="invocationCount" fill="var(--color-invocationCount)" radius={[2, 2, 0, 0]} />
                </BarChart>
              </ChartContainer>
            </CardContent>
          </Card>
        )}

        {/* Latency Trend Chart */}
        {timeSeries.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle>Average Latency (30 days)</CardTitle>
            </CardHeader>
            <CardContent>
              <ChartContainer config={timeSeriesConfig} className="h-[200px] w-full">
                <LineChart data={timeSeries}>
                  <XAxis dataKey="day" tickFormatter={(d) => d.slice(5)} />
                  <YAxis tickFormatter={(v) => formatDuration(v)} />
                  <ChartTooltip content={<ChartTooltipContent formatter={(v) => formatDuration(Number(v))} />} />
                  <Line type="monotone" dataKey="avgDurationMs" stroke="var(--color-avgDurationMs)" strokeWidth={2} dot={false} />
                </LineChart>
              </ChartContainer>
            </CardContent>
          </Card>
        )}

        {/* Agent Performance Table */}
        <Card>
          <CardHeader>
            <CardTitle>Agent Breakdown</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Agent</TableHead>
                  <TableHead className="text-right">Invocations</TableHead>
                  <TableHead className="text-right">Avg Latency</TableHead>
                  <TableHead className="text-right">P95 Latency</TableHead>
                  <TableHead className="text-right">Input Tokens</TableHead>
                  <TableHead className="text-right">Output Tokens</TableHead>
                  <TableHead className="text-right">Cost</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {agents.map((agent: any) => (
                  <TableRow key={agent.agentId}>
                    <TableCell className="font-medium">
                      {agent.agentName}
                      {agent.errorCount > 0 && (
                        <Badge variant="destructive" className="ml-2 text-xs">
                          {agent.errorCount} errors
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-right">{agent.invocationCount}</TableCell>
                    <TableCell className="text-right">{formatDuration(agent.avgDurationMs)}</TableCell>
                    <TableCell className="text-right">{formatDuration(agent.p95DurationMs)}</TableCell>
                    <TableCell className="text-right">{formatTokens(agent.totalInputTokens)}</TableCell>
                    <TableCell className="text-right">{formatTokens(agent.totalOutputTokens)}</TableCell>
                    <TableCell className="text-right">{formatUsd(agent.totalCostUsd)}</TableCell>
                  </TableRow>
                ))}
                {agents.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center text-muted-foreground py-8">
                      No performance data yet. Agent invocations will appear here.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </PageLayout>
  );
}
