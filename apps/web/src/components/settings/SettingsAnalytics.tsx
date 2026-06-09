import { useMemo } from "react";
import { useQuery } from "urql";
import { BrainCircuit, UserRound } from "lucide-react";
import { Bar, BarChart, XAxis, YAxis } from "recharts";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
  type ChartConfig,
} from "@thinkwork/ui";
import { LoadingShimmer } from "@/components/LoadingShimmer";
import { usePageHeaderActions } from "@/context/PageHeaderContext";
import { useTenant } from "@/context/TenantContext";
import {
  SettingsBudgetStatusQuery,
  SettingsCostByModelQuery,
  SettingsCostSummaryQuery,
  SettingsCostTimeSeriesQuery,
  SettingsCostByUserQuery,
  SettingsModelCatalogQuery,
} from "@/lib/settings-queries";
import {
  SettingsPageTitle,
  SettingsPane,
} from "@/components/settings/SettingsContent";

// Null-rendering header publisher (see SettingsContent's TablePaneHeader). Kept
// as a child so the embedded variant (hosted under the tabbed Activity page,
// which owns the header) can suppress it without a conditional hook call.
function AnalyticsHeader() {
  usePageHeaderActions({
    title: "Analytics",
    breadcrumbs: [{ label: "Analytics" }],
  });
  return null;
}

function formatUsd(value: number, fractionDigits = 2): string {
  return `$${value.toFixed(fractionDigits)}`;
}

function formatTokens(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}k`;
  return String(value);
}

function shortenModelId(modelId: string): string {
  const afterSlash = modelId.includes("/")
    ? (modelId.split("/").pop() ?? modelId)
    : modelId;
  return afterSlash
    .replace(/^us\.anthropic\./, "")
    .replace(/-\d{8,}/, "")
    .replace(/-v\d+:\d+$/, "");
}

const trendChartConfig = {
  llmUsd: { label: "LLM", color: "hsl(142, 71%, 45%)" },
  computeUsd: { label: "Infra", color: "hsl(217, 71%, 53%)" },
  toolsUsd: { label: "Tools", color: "hsl(38, 92%, 50%)" },
} satisfies ChartConfig;

export function SettingsAnalytics({ embedded }: { embedded?: boolean } = {}) {
  const { tenantId } = useTenant();
  const vars = { variables: { tenantId: tenantId ?? "" }, pause: !tenantId };

  const [summaryR] = useQuery({ query: SettingsCostSummaryQuery, ...vars });
  const [userR] = useQuery({ query: SettingsCostByUserQuery, ...vars });
  const [modelR] = useQuery({ query: SettingsCostByModelQuery, ...vars });
  const [budgetR] = useQuery({ query: SettingsBudgetStatusQuery, ...vars });
  const [seriesR] = useQuery({
    query: SettingsCostTimeSeriesQuery,
    variables: { tenantId: tenantId ?? "", days: 30 },
    pause: !tenantId,
  });
  const [catalogR] = useQuery({ query: SettingsModelCatalogQuery });

  const loading =
    (summaryR.fetching && !summaryR.data) ||
    (seriesR.fetching && !seriesR.data);

  const displayNames = useMemo(
    () =>
      new Map(
        (catalogR.data?.modelCatalog ?? []).map((m) => [
          m.modelId,
          m.displayName,
        ]),
      ),
    [catalogR.data],
  );

  if (loading) {
    return (
      <SettingsPane className="max-w-none">
        {embedded ? null : <AnalyticsHeader />}
        <SettingsPageTitle title="Analytics" />
        <div className="flex items-center justify-center py-24">
          <LoadingShimmer />
        </div>
      </SettingsPane>
    );
  }

  const summary = summaryR.data?.costSummary;
  const costPerEvent =
    (summary?.eventCount ?? 0) > 0
      ? (summary?.totalUsd ?? 0) / (summary?.eventCount ?? 1)
      : 0;

  return (
    <SettingsPane className="max-w-none">
      {embedded ? null : <AnalyticsHeader />}
      <SettingsPageTitle
        title="Analytics"
        description="Usage cost over the last 30 days."
      />

      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Metric label="Total Spend" value={formatUsd(summary?.totalUsd ?? 0)} />
        <Metric label="LLM" value={formatUsd(summary?.llmUsd ?? 0)} />
        <Metric label="Infra" value={formatUsd(summary?.computeUsd ?? 0)} />
        <Metric label="Tools" value={formatUsd(summary?.toolsUsd ?? 0)} />
        <Metric label="Invocations" value={String(summary?.eventCount ?? 0)} />
        <Metric
          label="Cost / Event"
          value={costPerEvent > 0 ? formatUsd(costPerEvent, 4) : "—"}
        />
      </div>

      <TrendCard series={seriesR.data?.costTimeSeries ?? []} />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <CostByUserCard
          rows={userR.data?.costByUser ?? []}
          budgets={budgetR.data?.budgetStatus ?? []}
        />
        <CostByModelCard
          rows={modelR.data?.costByModel ?? []}
          displayNames={displayNames}
        />
      </div>
    </SettingsPane>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-border bg-card px-4 py-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-xl font-semibold tabular-nums">{value}</p>
    </div>
  );
}

type SeriesPoint = {
  day: string;
  totalUsd: number;
  llmUsd: number;
  computeUsd: number;
  toolsUsd: number;
  eventCount: number;
};

function TrendCard({ series }: { series: SeriesPoint[] }) {
  return (
    <div className="mb-6 rounded-xl border border-border bg-card p-5">
      <h2 className="text-base font-medium">Cost Trend</h2>
      <p className="mb-3 text-sm text-muted-foreground">Last 30 days</p>
      <ChartContainer
        config={trendChartConfig}
        className="aspect-auto h-52 w-full"
      >
        <BarChart data={series}>
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
          <ChartTooltip cursor={false} content={<ChartTooltipContent />} />
          <Bar dataKey="llmUsd" stackId="cost" fill="var(--color-llmUsd)" />
          <Bar
            dataKey="computeUsd"
            stackId="cost"
            fill="var(--color-computeUsd)"
          />
          <Bar
            dataKey="toolsUsd"
            stackId="cost"
            radius={[3, 3, 0, 0]}
            fill="var(--color-toolsUsd)"
          />
        </BarChart>
      </ChartContainer>
    </div>
  );
}

type UserCostRow = {
  userId?: string | null;
  userName: string;
  userEmail?: string | null;
  totalUsd: number;
  eventCount: number;
  isSystem: boolean;
};

type BudgetStatusRow = {
  policy: {
    userId?: string | null;
    scope: string;
    limitUsd: number;
  };
  percentUsed: number;
  status: string;
};

function CostByUserCard({
  rows,
  budgets,
}: {
  rows: UserCostRow[];
  budgets: BudgetStatusRow[];
}) {
  const sorted = [...rows].sort((a, b) => b.totalUsd - a.totalUsd);
  const total = sorted.reduce((s, r) => s + r.totalUsd, 0);
  const userBudgetMap = new Map(
    budgets
      .filter((b) => b.policy.scope === "user" && b.policy.userId)
      .map((b) => [b.policy.userId!, b]),
  );
  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <h2 className="mb-3 flex items-center gap-2 text-base font-medium">
        <UserRound className="size-4 text-muted-foreground" />
        Cost by User
      </h2>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>User</TableHead>
            <TableHead className="w-20 text-center">Events</TableHead>
            <TableHead className="w-24">Budget</TableHead>
            <TableHead className="w-20 text-right">Cost</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {sorted.length === 0 ? (
            <TableRow>
              <TableCell colSpan={4} className="text-muted-foreground">
                No cost data yet.
              </TableCell>
            </TableRow>
          ) : (
            sorted.map((r) => {
              const budget = r.userId ? userBudgetMap.get(r.userId) : null;
              return (
                <TableRow key={r.userId ?? "system"}>
                  <TableCell className="min-w-0">
                    <div className="truncate font-medium">
                      {r.isSystem ? "System" : r.userName}
                    </div>
                    {!r.isSystem && r.userEmail ? (
                      <div className="truncate text-xs text-muted-foreground">
                        {r.userEmail}
                      </div>
                    ) : null}
                  </TableCell>
                  <TableCell className="w-20 text-center tabular-nums text-muted-foreground">
                    {r.eventCount}
                  </TableCell>
                  <TableCell className="w-24">
                    {budget ? (
                      <BudgetProgress budget={budget} />
                    ) : (
                      <span className="text-xs text-muted-foreground">
                        Unlimited
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="w-20 text-right tabular-nums">
                    {formatUsd(r.totalUsd)}
                  </TableCell>
                </TableRow>
              );
            })
          )}
        </TableBody>
        {sorted.length > 0 ? (
          <TableFooter>
            <TableRow>
              <TableCell className="font-semibold">Total</TableCell>
              <TableCell />
              <TableCell />
              <TableCell className="text-right font-semibold tabular-nums">
                {formatUsd(total)}
              </TableCell>
            </TableRow>
          </TableFooter>
        ) : null}
      </Table>
    </div>
  );
}

function BudgetProgress({ budget }: { budget: BudgetStatusRow }) {
  const percent = Math.min(100, Math.max(0, budget.percentUsed));
  const barClass =
    budget.status === "exceeded"
      ? "bg-red-500"
      : budget.status === "warning"
        ? "bg-yellow-500"
        : "bg-primary";
  return (
    <div className="w-24">
      <div className="h-1.5 overflow-hidden rounded-full bg-muted">
        <div
          className={`h-full ${barClass}`}
          style={{ width: `${percent}%` }}
        />
      </div>
      <div className="mt-1 truncate text-xs text-muted-foreground tabular-nums">
        {percent.toFixed(0)}% of {formatUsd(budget.policy.limitUsd, 0)}
      </div>
    </div>
  );
}

function CostByModelCard({
  rows,
  displayNames,
}: {
  rows: {
    model: string;
    totalUsd: number;
    inputTokens: number;
    outputTokens: number;
  }[];
  displayNames: Map<string, string>;
}) {
  const sorted = [...rows].sort((a, b) => b.totalUsd - a.totalUsd);
  const total = sorted.reduce((s, m) => s + m.totalUsd, 0);
  const totalIn = sorted.reduce((s, m) => s + m.inputTokens, 0);
  const totalOut = sorted.reduce((s, m) => s + m.outputTokens, 0);
  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <h2 className="mb-3 flex items-center gap-2 text-base font-medium">
        <BrainCircuit className="size-4 text-muted-foreground" />
        Cost by Model
      </h2>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Model</TableHead>
            <TableHead>Tokens</TableHead>
            <TableHead className="text-right">Cost</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {sorted.length === 0 ? (
            <TableRow>
              <TableCell colSpan={3} className="text-muted-foreground">
                No cost data yet.
              </TableCell>
            </TableRow>
          ) : (
            sorted.map((m) => (
              <TableRow key={m.model}>
                <TableCell className="font-medium">
                  {displayNames.get(m.model) ?? shortenModelId(m.model)}
                </TableCell>
                <TableCell className="whitespace-nowrap text-xs text-muted-foreground tabular-nums">
                  {formatTokens(m.inputTokens)} in /{" "}
                  {formatTokens(m.outputTokens)} out
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatUsd(m.totalUsd, 4)}
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
        {sorted.length > 0 ? (
          <TableFooter>
            <TableRow>
              <TableCell className="font-semibold">Total</TableCell>
              <TableCell className="whitespace-nowrap text-xs text-muted-foreground tabular-nums">
                {formatTokens(totalIn)} in / {formatTokens(totalOut)} out
              </TableCell>
              <TableCell className="text-right font-semibold tabular-nums">
                {formatUsd(total, 4)}
              </TableCell>
            </TableRow>
          </TableFooter>
        ) : null}
      </Table>
    </div>
  );
}
