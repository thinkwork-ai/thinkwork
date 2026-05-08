import { useMemo } from "react";
import { AlertTriangle, Clock, DollarSign, Zap } from "lucide-react";
import {
  Bar as RechartsBar,
  BarChart as RechartsBarChart,
  Cell as RechartsCell,
  Label as RechartsLabel,
  Pie as RechartsPie,
  PieChart as RechartsPieChart,
  XAxis as RechartsXAxis,
  YAxis as RechartsYAxis,
} from "recharts";
import { MetricCard } from "@/components/MetricCard";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { ComputerTaskStatus, type Computer } from "@/gql/graphql";
import { formatDuration } from "@/lib/activity-utils";
import { formatUsd } from "@/lib/utils";

type ComputerDashboardTask = {
  status: ComputerTaskStatus;
  claimedAt?: string | null;
  completedAt?: string | null;
  createdAt: string;
};

type ComputerDashboardThread = {
  createdAt: string;
  updatedAt: string;
  costSummary?: number | null;
};

type ComputerDashboardMetricsProps = {
  computer: Pick<Computer, "spentMonthlyCents">;
  tasks: ComputerDashboardTask[];
  threads: ComputerDashboardThread[];
};

const activityChartConfig = {
  tasks: { label: "Tasks", color: "hsl(217, 91%, 60%)" },
  threads: { label: "Threads", color: "hsl(142, 71%, 45%)" },
} satisfies ChartConfig;

const costPieConfig = {
  runtime: { label: "Runtime", color: "hsl(217, 71%, 53%)" },
  threads: { label: "Threads", color: "hsl(142, 71%, 45%)" },
  unattributed: { label: "Unattributed", color: "hsl(38, 92%, 50%)" },
} satisfies ChartConfig;

function buildActivityChart(
  tasks: ComputerDashboardTask[],
  threads: ComputerDashboardThread[],
) {
  const buckets = new Map<
    string,
    { day: string; tasks: number; threads: number }
  >();
  const now = new Date();
  for (let i = 6; i >= 0; i -= 1) {
    const date = new Date(now);
    date.setDate(date.getDate() - i);
    const day = date.toISOString().slice(0, 10);
    buckets.set(day, { day, tasks: 0, threads: 0 });
  }

  for (const task of tasks) {
    const day = new Date(task.createdAt).toISOString().slice(0, 10);
    const bucket = buckets.get(day);
    if (bucket) bucket.tasks += 1;
  }

  for (const thread of threads) {
    const day = new Date(thread.updatedAt ?? thread.createdAt)
      .toISOString()
      .slice(0, 10);
    const bucket = buckets.get(day);
    if (bucket) bucket.threads += 1;
  }

  return [...buckets.values()];
}

function completedDuration(task: ComputerDashboardTask): number | null {
  if (!task.claimedAt || !task.completedAt) return null;
  const duration =
    new Date(task.completedAt).getTime() - new Date(task.claimedAt).getTime();
  return duration > 0 ? duration : null;
}

export function ComputerDashboardMetrics({
  computer,
  tasks,
  threads,
}: ComputerDashboardMetricsProps) {
  const totalInvocations = tasks.length + threads.length;
  const totalSpend =
    (computer.spentMonthlyCents ?? 0) / 100 +
    threads.reduce((sum, thread) => sum + (thread.costSummary ?? 0), 0);
  const failedTasks = tasks.filter(
    (task) =>
      task.status === ComputerTaskStatus.Failed ||
      task.status === ComputerTaskStatus.Cancelled,
  ).length;
  const completedDurations = tasks
    .map(completedDuration)
    .filter((duration): duration is number => duration != null);
  const avgLatency =
    completedDurations.length > 0
      ? completedDurations.reduce((sum, duration) => sum + duration, 0) /
        completedDurations.length
      : 0;
  const errorRate =
    tasks.length > 0
      ? `${((failedTasks / tasks.length) * 100).toFixed(1)}%`
      : "--";
  const activityChart = useMemo(
    () => buildActivityChart(tasks, threads),
    [tasks, threads],
  );
  const costPieData = useMemo(() => {
    if (totalSpend <= 0) return [];
    const threadSpend = threads.reduce(
      (sum, thread) => sum + (thread.costSummary ?? 0),
      0,
    );
    const runtimeSpend = Math.max((computer.spentMonthlyCents ?? 0) / 100, 0);
    const unattributedSpend = Math.max(
      totalSpend - threadSpend - runtimeSpend,
      0,
    );
    return [
      { name: "runtime", value: runtimeSpend },
      { name: "threads", value: threadSpend },
      { name: "unattributed", value: unattributedSpend },
    ].filter((entry) => entry.value > 0);
  }, [computer.spentMonthlyCents, threads, totalSpend]);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <MetricCard
          label="Invocations"
          value={totalInvocations.toLocaleString()}
          icon={<Zap className="h-4 w-4" />}
          subtitle={`${tasks.length} tasks, ${threads.length} threads`}
        />
        <MetricCard
          label="Avg Latency"
          value={formatDuration(avgLatency)}
          icon={<Clock className="h-4 w-4" />}
          subtitle={
            completedDurations.length > 0 ? "Completed tasks" : undefined
          }
        />
        <MetricCard
          label="Cost / Invocation"
          value={
            totalSpend > 0 && totalInvocations > 0
              ? formatUsd(totalSpend / totalInvocations)
              : "--"
          }
          icon={<DollarSign className="h-4 w-4" />}
          subtitle={
            totalSpend > 0 ? `Total: ${formatUsd(totalSpend)}` : undefined
          }
        />
        <MetricCard
          label="Error Rate"
          value={errorRate}
          icon={<AlertTriangle className="h-4 w-4" />}
          subtitle={failedTasks > 0 ? `${failedTasks} failed` : undefined}
        />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Activity</CardTitle>
            <CardDescription>Last 7 days</CardDescription>
            <CardAction>
              <Badge variant="outline" className="tabular-nums">
                {totalInvocations} loaded
              </Badge>
            </CardAction>
          </CardHeader>
          <CardContent>
            <ChartContainer
              config={activityChartConfig}
              className="aspect-auto h-36 w-full"
            >
              <RechartsBarChart data={activityChart}>
                <RechartsXAxis
                  dataKey="day"
                  tickFormatter={(day: string) =>
                    new Date(`${day}T00:00:00`).toLocaleDateString("en-US", {
                      weekday: "short",
                    })
                  }
                  tick={{ fontSize: 10 }}
                  axisLine={false}
                  tickLine={false}
                />
                <RechartsYAxis
                  allowDecimals={false}
                  tick={{ fontSize: 10 }}
                  axisLine={false}
                  tickLine={false}
                  width={24}
                />
                <ChartTooltip
                  cursor={false}
                  content={<ChartTooltipContent />}
                />
                <RechartsBar
                  dataKey="tasks"
                  stackId="a"
                  fill="var(--color-tasks)"
                  fillOpacity={0.85}
                />
                <RechartsBar
                  dataKey="threads"
                  stackId="a"
                  radius={[3, 3, 0, 0]}
                  fill="var(--color-threads)"
                  fillOpacity={0.85}
                />
              </RechartsBarChart>
            </ChartContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Cost by Category</CardTitle>
            <CardDescription>This month</CardDescription>
          </CardHeader>
          <CardContent>
            {costPieData.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">
                No cost data yet
              </p>
            ) : (
              <ChartContainer
                config={costPieConfig}
                className="aspect-auto h-36 w-full"
              >
                <RechartsPieChart>
                  <ChartTooltip
                    content={
                      <ChartTooltipContent
                        formatter={(value, name) => (
                          <>
                            <div
                              className="h-2.5 w-2.5 shrink-0 rounded-[2px]"
                              style={{
                                backgroundColor: `var(--color-${name})`,
                              }}
                            />
                            <div className="flex flex-1 items-center justify-between gap-2 leading-none">
                              <span className="text-muted-foreground">
                                {costPieConfig[
                                  name as keyof typeof costPieConfig
                                ]?.label ?? name}
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
                  <RechartsPie
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
                    {costPieData.map((entry) => (
                      <RechartsCell
                        key={entry.name}
                        fill={`var(--color-${entry.name})`}
                      />
                    ))}
                    <RechartsLabel
                      content={({ viewBox }) => {
                        if (viewBox && "cx" in viewBox && "cy" in viewBox) {
                          return (
                            <text
                              x={viewBox.cx}
                              y={viewBox.cy}
                              textAnchor="middle"
                              dominantBaseline="middle"
                            >
                              <tspan
                                x={viewBox.cx}
                                y={viewBox.cy}
                                className="fill-foreground text-lg font-bold"
                              >
                                {formatUsd(totalSpend)}
                              </tspan>
                            </text>
                          );
                        }
                        return null;
                      }}
                    />
                  </RechartsPie>
                </RechartsPieChart>
              </ChartContainer>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
