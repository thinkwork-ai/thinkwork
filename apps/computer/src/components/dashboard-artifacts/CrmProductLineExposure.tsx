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
  getProductExposure,
} from "@/components/dashboard-artifacts/dashboard-data";

const productChartConfig = {
  stableAmount: { label: "Other exposure", color: "hsl(217 70% 58%)" },
  highRiskAmount: { label: "High-risk exposure", color: "hsl(38 92% 50%)" },
} satisfies ChartConfig;

interface CrmProductLineExposureProps {
  manifest: DashboardArtifactManifest;
}

export function CrmProductLineExposure({
  manifest,
}: CrmProductLineExposureProps) {
  const data = getProductExposure(manifest).map((item) => ({
    ...item,
    stableAmount: Math.max(item.amount - item.highRiskAmount, 0),
  }));

  return (
    <section className="rounded-lg border border-border/70 bg-background p-4">
      <div className="mb-4">
        <h3 className="text-sm font-semibold">Product-line exposure</h3>
        <p className="mt-1 text-xs text-muted-foreground">
          Concentration by product with high-risk amount separated.
        </p>
      </div>
      <ChartContainer config={productChartConfig} className="aspect-auto h-64 w-full">
        <BarChart data={data} margin={{ left: 8, right: 8 }}>
          <CartesianGrid vertical={false} />
          <XAxis
            dataKey="product"
            tickLine={false}
            axisLine={false}
            tickMargin={8}
            tick={{ fontSize: 10 }}
            interval={0}
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
          <Bar dataKey="stableAmount" stackId="product" fill="var(--color-stableAmount)" />
          <Bar
            dataKey="highRiskAmount"
            stackId="product"
            fill="var(--color-highRiskAmount)"
            radius={[4, 4, 0, 0]}
          />
        </BarChart>
      </ChartContainer>
    </section>
  );
}
