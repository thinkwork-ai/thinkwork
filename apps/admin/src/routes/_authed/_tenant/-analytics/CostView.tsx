import { useState } from "react";
import { useQuery } from "urql";
import { BrainCircuit, Bot } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis } from "recharts";
import { useTenant } from "@/context/TenantContext";
import { MetricCard } from "@/components/MetricCard";
import { PageSkeleton } from "@/components/PageSkeleton";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow, TableFooter } from "@/components/ui/table";
import { Progress } from "@/components/ui/progress";
import { formatUsd, formatTokens } from "@/lib/utils";
import { useCostData } from "@/hooks/useCostData";
import { useCostStore } from "@/stores/cost-store";
import { ModelCatalogQuery, AgentsListQuery } from "@/lib/graphql-queries";

const trendChartConfig = {
  llmUsd: { label: "LLM", color: "hsl(142, 71%, 45%)" },
  computeUsd: { label: "Infra", color: "hsl(217, 71%, 53%)" },
  toolsUsd: { label: "Tools", color: "hsl(38, 92%, 50%)" },
} satisfies ChartConfig;

function shortenModelId(modelId: string): string {
  const afterSlash = modelId.includes("/") ? modelId.split("/").pop()! : modelId;
  return afterSlash.replace(/^us\.anthropic\./, "").replace(/-\d{8,}/, "").replace(/-v\d+:\d+$/, "");
}

function useModelDisplayNames(): Map<string, string> {
  const [result] = useQuery({ query: ModelCatalogQuery });
  const models = result.data?.modelCatalog ?? [];
  return new Map(models.map((m) => [m.modelId, m.displayName]));
}

export function CostView() {
  const { tenantId } = useTenant();
  const { loading } = useCostData(tenantId);

  if (!tenantId || loading) return <PageSkeleton />;

  return (
    <div className="space-y-6">
      <SummaryMetrics />
      <TrendChart />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <AgentBudgetTable />
        <CostByModelCard />
      </div>
    </div>
  );
}

function SummaryMetrics() {
  const summary = useCostStore((s) => s.summary);
  const costPerEvent = (summary?.eventCount ?? 0) > 0
    ? (summary?.totalUsd ?? 0) / (summary?.eventCount ?? 1)
    : 0;
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-6 *:data-[slot=card]:shadow-xs dark:*:data-[slot=card]:bg-card">
      <MetricCard label="Total Spend" value={formatUsd(summary?.totalUsd ?? 0)} />
      <MetricCard label="LLM Costs" value={formatUsd(summary?.llmUsd ?? 0)} />
      <MetricCard label="Infra Costs" value={formatUsd(summary?.computeUsd ?? 0)} />
      <MetricCard label="Tool Costs" value={formatUsd(summary?.toolsUsd ?? 0)} />
      <MetricCard label="Invocations" value={summary?.eventCount ?? 0} />
      <MetricCard label="Cost / Event" value={costPerEvent > 0 ? formatUsd(costPerEvent) : "—"} />
    </div>
  );
}

function buildLast30Days(timeSeries: { day: string; totalUsd: number; llmUsd: number; computeUsd: number; toolsUsd: number; eventCount: number }[]) {
  const lookup = new Map(timeSeries.map((d) => [d.day, d]));
  const days: typeof timeSeries = [];
  const now = new Date();
  for (let i = 29; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    days.push(lookup.get(key) ?? { day: key, totalUsd: 0, llmUsd: 0, computeUsd: 0, toolsUsd: 0, eventCount: 0 });
  }
  return days;
}

function TrendChart() {
  const timeSeries = useCostStore((s) => s.timeSeries);
  const data = buildLast30Days(timeSeries);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Cost Trend</CardTitle>
        <CardDescription>Last 30 days</CardDescription>
      </CardHeader>
      <CardContent>
        <ChartContainer config={trendChartConfig} className="aspect-auto h-52 w-full">
          <BarChart data={data}>
            <XAxis
              dataKey="day"
              interval="equidistantPreserveStart"
              tickFormatter={(d: string) => {
                const date = new Date(d + "T00:00:00");
                return `${date.getMonth() + 1}/${date.getDate()}`;
              }}
              tick={{ fontSize: 11 }}
              axisLine={false}
              tickLine={false}
            />
            <YAxis
              tickFormatter={(v: number) => `$${v.toFixed(2)}`}
              tick={{ fontSize: 11 }}
              axisLine={false}
              tickLine={false}
              width={55}
            />
            <ChartTooltip
              cursor={false}
              content={
                <ChartTooltipContent
                  labelFormatter={(_, payload) => {
                    const day = payload[0]?.payload?.day;
                    if (!day) return "";
                    const date = new Date(day + "T00:00:00");
                    return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
                  }}
                  formatter={(value, name) => (
                    <>
                      <div className="h-2.5 w-2.5 shrink-0 rounded-[2px]" style={{ backgroundColor: `var(--color-${name})` }} />
                      <div className="flex flex-1 justify-between items-center leading-none gap-2">
                        <span className="text-muted-foreground">
                          {trendChartConfig[name as keyof typeof trendChartConfig]?.label ?? name}
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
            <Bar dataKey="llmUsd" stackId="cost" fill="var(--color-llmUsd)" fillOpacity={0.85} />
            <Bar dataKey="computeUsd" stackId="cost" fill="var(--color-computeUsd)" fillOpacity={0.85} />
            <Bar dataKey="toolsUsd" stackId="cost" radius={[3, 3, 0, 0]} fill="var(--color-toolsUsd)" fillOpacity={0.85} />
          </BarChart>
        </ChartContainer>
      </CardContent>
    </Card>
  );
}

function AgentBudgetTable() {
  const { tenantId } = useTenant();
  const agentCosts = useCostStore((s) => s.byAgent);
  const budgets = useCostStore((s) => s.budgets);
  const summary = useCostStore((s) => s.summary);
  const [showArchived, setShowArchived] = useState(false);

  const [agentsResult] = useQuery({
    query: AgentsListQuery,
    variables: { tenantId: tenantId! },
    pause: !tenantId,
  });
  const activeAgentIds = new Set(
    (agentsResult.data?.agents ?? []).map((a: { id: string }) => a.id),
  );

  const agentBudgetMap = new Map(
    budgets
      .filter((b) => b.policy.scope === "agent" && b.policy.agentId)
      .map((b) => [b.policy.agentId!, b]),
  );
  const tenantBudget = budgets.find((b) => b.policy.scope === "tenant");

  const allRows = [...agentCosts]
    .sort((a, b) => b.totalUsd - a.totalUsd)
    .map((agent) => {
      const budget = agentBudgetMap.get(agent.agentId);
      return {
        agentId: agent.agentId,
        agentName: agent.agentName,
        spent: agent.totalUsd,
        eventCount: agent.eventCount,
        avgCost: agent.eventCount > 0 ? agent.totalUsd / agent.eventCount : 0,
        limit: budget?.policy.limitUsd ?? null,
        percent: budget ? (agent.totalUsd / budget.policy.limitUsd) * 100 : null,
        isActive: activeAgentIds.has(agent.agentId),
      };
    });

  const hasArchived = allRows.some((r) => !r.isActive);
  const rows = showArchived ? allRows : allRows.filter((r) => r.isActive);

  const totalSpent = summary?.totalUsd ?? 0;
  const agentLimitsSum = rows.reduce((sum, r) => sum + (r.limit ?? 0), 0);
  const totalLimit = agentLimitsSum > 0 ? agentLimitsSum : null;

  if (allRows.length === 0 && !tenantBudget) return null;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <Bot className="h-4 w-4 text-muted-foreground" />
            Cost by Agent
          </CardTitle>
          {hasArchived && (
            <button
              type="button"
              onClick={() => setShowArchived((v) => !v)}
              className="text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              {showArchived ? "Hide" : "Show"} archived
            </button>
          )}
        </div>
      </CardHeader>
      <CardContent>
        <Table className="table-fixed">
          <colgroup>
            <col className="w-28" />
            <col />
            <col className="w-28" />
          </colgroup>
          <TableHeader className="[&_tr]:border-0">
            <TableRow>
              <TableHead>Agent</TableHead>
              <TableHead>Budget Used</TableHead>
              <TableHead>Cost</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody className="[&_tr]:border-0">
            {rows.map((row) => (
              <TableRow key={row.agentId} className="border-0">
                <TableCell>
                  <p className="text-sm font-medium truncate">{row.agentName}</p>
                </TableCell>
                <TableCell>
                  {row.limit != null ? (
                    <Progress
                      value={Math.min(100, row.percent ?? 0)}
                      className={
                        (row.percent ?? 0) >= 100
                          ? "[&>[data-slot=progress-indicator]]:bg-red-500"
                          : (row.percent ?? 0) >= 80
                            ? "[&>[data-slot=progress-indicator]]:bg-yellow-500"
                            : ""
                      }
                    />
                  ) : (
                    <span className="text-xs text-muted-foreground">No budget</span>
                  )}
                </TableCell>
                <TableCell className="whitespace-nowrap">
                  <span className="text-sm font-medium tabular-nums">{formatUsd(row.spent)}</span>
                  {row.limit != null && (
                    <span className="text-sm text-muted-foreground tabular-nums"> / {formatUsd(row.limit, 0)}</span>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
          <TableFooter className="border-t-0">
            <TableRow>
              <TableCell className="font-semibold">Total</TableCell>
              <TableCell />
              <TableCell className="whitespace-nowrap">
                <span className="font-semibold tabular-nums">{formatUsd(totalSpent)}</span>
                {totalLimit != null && (
                  <span className="text-muted-foreground tabular-nums"> / {formatUsd(totalLimit, 0)}</span>
                )}
              </TableCell>
            </TableRow>
          </TableFooter>
        </Table>
      </CardContent>
    </Card>
  );
}

function CostByModelCard() {
  const modelCosts = useCostStore((s) => s.byModel);
  const displayNames = useModelDisplayNames();

  const sorted = [...modelCosts].sort((a, b) => b.totalUsd - a.totalUsd);
  const totalModelCost = sorted.reduce((sum, m) => sum + m.totalUsd, 0);
  const totalInput = sorted.reduce((sum, m) => sum + m.inputTokens, 0);
  const totalOutput = sorted.reduce((sum, m) => sum + m.outputTokens, 0);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <BrainCircuit className="h-4 w-4 text-muted-foreground" />
          Cost by Model
        </CardTitle>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader className="[&_tr]:border-0">
            <TableRow>
              <TableHead>Model</TableHead>
              <TableHead>Tokens</TableHead>
              <TableHead>Cost</TableHead>
            </TableRow>
          </TableHeader>
          {sorted.length === 0 ? (
            <TableBody className="[&_tr]:border-0">
              <TableRow>
                <TableCell colSpan={3} className="text-muted-foreground">No cost data yet.</TableCell>
              </TableRow>
            </TableBody>
          ) : (
            <>
              <TableBody className="[&_tr]:border-0">
                {sorted.map((model) => (
                  <TableRow key={model.model} className="border-0">
                    <TableCell>
                      <p className="text-sm font-medium truncate">{displayNames.get(model.model) ?? shortenModelId(model.model)}</p>
                    </TableCell>
                    <TableCell className="whitespace-nowrap">
                      <span className="text-xs text-muted-foreground tabular-nums">
                        {formatTokens(model.inputTokens)} in / {formatTokens(model.outputTokens)} out
                      </span>
                    </TableCell>
                    <TableCell className="whitespace-nowrap">
                      <span className="text-sm font-medium tabular-nums">{formatUsd(model.totalUsd, 4)}</span>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
              <TableFooter className="border-t-0">
                <TableRow>
                  <TableCell className="font-semibold">Total</TableCell>
                  <TableCell className="whitespace-nowrap">
                    <span className="text-xs text-muted-foreground tabular-nums">
                      {formatTokens(totalInput)} in / {formatTokens(totalOutput)} out
                    </span>
                  </TableCell>
                  <TableCell className="whitespace-nowrap">
                    <span className="font-semibold tabular-nums">{formatUsd(totalModelCost, 4)}</span>
                  </TableCell>
                </TableRow>
              </TableFooter>
            </>
          )}
        </Table>
      </CardContent>
    </Card>
  );
}
