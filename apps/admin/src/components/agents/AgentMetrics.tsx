import { useMemo } from "react";
import { BarChart, Bar, XAxis, YAxis, PieChart, Pie, Cell, Label } from "recharts";
import { Zap, Clock, AlertTriangle, DollarSign } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardAction } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import { MetricCard } from "@/components/MetricCard";
import { formatUsd } from "@/lib/utils";
import type { ActivityItem } from "@/lib/activity-utils";
import type { AgentCost } from "@/stores/cost-store";

const runChartConfig = {
  runs: { label: "Runs", color: "hsl(217, 91%, 60%)" },
  chats: { label: "Chats", color: "hsl(142, 71%, 45%)" },
} satisfies ChartConfig;

const costPieConfig = {
  llm: { label: "LLM", color: "hsl(142, 71%, 45%)" },
  infra: { label: "Infra", color: "hsl(217, 71%, 53%)" },
  tools: { label: "Tools", color: "hsl(38, 92%, 50%)" },
} satisfies ChartConfig;

interface AgentMetricsProps {
  agentId: string;
  tenantId: string;
  agentCost: AgentCost | undefined;
  runs: ActivityItem[];
  chats: ActivityItem[];
}

function formatDuration(ms: number): string {
  if (!ms || ms === 0) return "--";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60000).toFixed(1)}m`;
}

/** Build 7-day buckets from activity items, splitting runs vs chats. */
function buildActivityChart(runs: ActivityItem[], chats: ActivityItem[]): { day: string; runs: number; chats: number }[] {
  const runBuckets = new Map<string, number>();
  const chatBuckets = new Map<string, number>();
  const now = new Date();
  for (let i = 6; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    const key = d.toISOString().slice(0, 10);
    runBuckets.set(key, 0);
    chatBuckets.set(key, 0);
  }
  for (const run of runs) {
    const key = new Date(run.timestamp).toISOString().slice(0, 10);
    if (runBuckets.has(key)) runBuckets.set(key, (runBuckets.get(key) ?? 0) + 1);
  }
  for (const chat of chats) {
    const key = new Date(chat.timestamp).toISOString().slice(0, 10);
    if (chatBuckets.has(key)) chatBuckets.set(key, (chatBuckets.get(key) ?? 0) + 1);
  }
  return [...runBuckets.keys()].map((day) => ({
    day,
    runs: runBuckets.get(day) ?? 0,
    chats: chatBuckets.get(day) ?? 0,
  }));
}

export function AgentMetrics({ agentId, tenantId, agentCost, runs, chats }: AgentMetricsProps) {
  const totalActivity = runs.length + chats.length;
  const activityChart = useMemo(() => buildActivityChart(runs, chats), [runs, chats]);

  // Agent-specific performance metrics (query removed)
  const perf = null as any;

  // Agent-specific cost breakdown — TODO: wire to costEvents query
  const costBreakdown: any = null;

  const costPieData = useMemo(() => {
    if (!costBreakdown) return [];
    return [
      { name: "llm", label: "LLM", value: costBreakdown.llmUsd },
      { name: "infra", label: "Infra", value: costBreakdown.computeUsd },
      { name: "tools", label: "Tools", value: costBreakdown.toolsUsd },
    ].filter((d: any) => d.value > 0);
  }, [costBreakdown]);

  const totalSpend = costBreakdown?.totalUsd ?? agentCost?.totalUsd ?? 0;
  const costPerInvocation = perf?.invocationCount ? totalSpend / perf.invocationCount : 0;

  return (
    <div className="space-y-4">
      {/* Performance metric cards */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <MetricCard
          label="Invocations"
          value={perf?.invocationCount?.toLocaleString() ?? "--"}
          icon={<Zap className="h-4 w-4" />}
          subtitle="This month"
        />
        <MetricCard
          label="Avg Latency"
          value={formatDuration(perf?.avgDurationMs ?? 0)}
          icon={<Clock className="h-4 w-4" />}
          subtitle={perf?.p95DurationMs ? `P95: ${formatDuration(perf.p95DurationMs)}` : undefined}
        />
        <MetricCard
          label="Cost / Invocation"
          value={costPerInvocation > 0 ? formatUsd(costPerInvocation) : "--"}
          icon={<DollarSign className="h-4 w-4" />}
          subtitle={totalSpend > 0 ? `Total: ${formatUsd(totalSpend)}` : undefined}
        />
        <MetricCard
          label="Error Rate"
          value={perf?.invocationCount
            ? `${(((perf.errorCount ?? 0) / perf.invocationCount) * 100).toFixed(1)}%`
            : "--"
          }
          icon={<AlertTriangle className="h-4 w-4" />}
          subtitle={perf?.errorCount ? `${perf.errorCount} failed` : undefined}
        />
      </div>

      {/* Charts row */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* Run activity chart — last 7 days */}
        <Card>
          <CardHeader>
            <CardTitle>Activity</CardTitle>
            <CardDescription>Last 7 days</CardDescription>
            <CardAction>
              <Badge variant="outline" className="tabular-nums">{totalActivity} this month</Badge>
            </CardAction>
          </CardHeader>
          <CardContent>
            <ChartContainer config={runChartConfig} className="aspect-auto h-36 w-full">
              <BarChart data={activityChart}>
                <XAxis
                  dataKey="day"
                  tickFormatter={(d: string) => {
                    const date = new Date(d + "T00:00:00");
                    return date.toLocaleDateString("en-US", { weekday: "short" });
                  }}
                  tick={{ fontSize: 10 }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  allowDecimals={false}
                  tick={{ fontSize: 10 }}
                  axisLine={false}
                  tickLine={false}
                  width={24}
                />
                <ChartTooltip
                  cursor={false}
                  content={
                    <ChartTooltipContent
                      labelFormatter={(_, payload) => {
                        const day = payload[0]?.payload?.day;
                        if (!day) return "";
                        const date = new Date(day + "T00:00:00");
                        return date.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
                      }}
                    />
                  }
                />
                <Bar dataKey="runs" stackId="a" radius={[0, 0, 0, 0]} fill="var(--color-runs)" fillOpacity={0.85} />
                <Bar dataKey="chats" stackId="a" radius={[3, 3, 0, 0]} fill="var(--color-chats)" fillOpacity={0.85} />
              </BarChart>
            </ChartContainer>
          </CardContent>
        </Card>

        {/* Cost by category — agent-specific pie chart */}
        <Card>
          <CardHeader>
            <CardTitle>Cost by Category</CardTitle>
            <CardDescription>This month</CardDescription>
          </CardHeader>
          <CardContent>
            {costPieData.length === 0 ? (
              <p className="text-sm text-muted-foreground py-8 text-center">No cost data yet</p>
            ) : (
              <ChartContainer config={costPieConfig} className="aspect-auto h-36 w-full">
                <PieChart>
                  <ChartTooltip
                    content={
                      <ChartTooltipContent
                        formatter={(value, name) => (
                          <>
                            <div className="h-2.5 w-2.5 shrink-0 rounded-[2px]" style={{ backgroundColor: `var(--color-${name})` }} />
                            <div className="flex flex-1 justify-between items-center leading-none gap-2">
                              <span className="text-muted-foreground">
                                {costPieConfig[name as keyof typeof costPieConfig]?.label ?? name}
                              </span>
                              <span className="font-mono font-medium tabular-nums text-foreground">
                                {formatUsd(Number(value))}
                              </span>
                            </div>
                          </>
                        )}
                      />
                    }
                  />
                  <Pie
                    data={costPieData}
                    dataKey="value"
                    nameKey="name"
                    cx="50%"
                    cy="50%"
                    innerRadius={40}
                    outerRadius={60}
                    strokeWidth={2}
                    stroke="var(--background)"
                  >
                    {costPieData.map((entry: any) => (
                      <Cell
                        key={entry.name}
                        fill={`var(--color-${entry.name})`}
                      />
                    ))}
                    <Label
                      content={({ viewBox }) => {
                        if (viewBox && "cx" in viewBox && "cy" in viewBox) {
                          return (
                            <text x={viewBox.cx} y={viewBox.cy} textAnchor="middle" dominantBaseline="middle">
                              <tspan x={viewBox.cx} y={viewBox.cy} className="fill-foreground text-lg font-bold">
                                {formatUsd(totalSpend)}
                              </tspan>
                            </text>
                          );
                        }
                        return null;
                      }}
                    />
                  </Pie>
                </PieChart>
              </ChartContainer>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
