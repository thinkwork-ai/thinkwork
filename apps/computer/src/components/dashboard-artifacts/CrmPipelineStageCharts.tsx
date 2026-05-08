import {
  Bar,
  BarChart,
  CartesianGrid,
  XAxis,
  YAxis,
} from "recharts";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@thinkwork/ui";
import type { DashboardArtifactManifest } from "@/lib/app-artifacts";
import {
  formatCurrency,
  getStageExposure,
} from "@/components/dashboard-artifacts/dashboard-data";

const stageChartConfig = {
  amount: { label: "Amount", color: "hsl(173 58% 42%)" },
} satisfies ChartConfig;

interface CrmPipelineStageChartsProps {
  manifest: DashboardArtifactManifest;
}

export function CrmPipelineStageCharts({ manifest }: CrmPipelineStageChartsProps) {
  const data = getStageExposure(manifest);

  return (
    <section className="rounded-lg border border-border/70 bg-background p-4">
      <div className="mb-4">
        <h3 className="text-sm font-semibold">Stage exposure</h3>
        <p className="mt-1 text-xs text-muted-foreground">
          Pipeline amount and opportunity count by CRM stage.
        </p>
      </div>
      <ChartContainer
        config={stageChartConfig}
        data-testid="stage-exposure-chart"
        className="aspect-auto h-64 w-full"
      >
        <BarChart data={data} margin={{ left: 8, right: 8 }}>
          <CartesianGrid vertical={false} />
          <XAxis
            dataKey="stage"
            tickLine={false}
            axisLine={false}
            tickMargin={8}
            tick={{ fontSize: 11 }}
          />
          <YAxis
            tickLine={false}
            axisLine={false}
            tickFormatter={(value: number) => formatCurrency(value)}
            tick={{ fontSize: 11 }}
            width={64}
          />
          <ChartTooltip
            cursor={false}
            content={
              <ChartTooltipContent
                formatter={(value) => (
                  <span className="font-mono tabular-nums">
                    {formatCurrency(Number(value))}
                  </span>
                )}
              />
            }
          />
          <Bar
            dataKey="amount"
            fill="var(--color-amount)"
            radius={[4, 4, 0, 0]}
          />
        </BarChart>
      </ChartContainer>
    </section>
  );
}
