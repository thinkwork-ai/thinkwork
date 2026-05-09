import {
  Bar,
  BarChart as RechartsBarChart,
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

export interface BarChartDatum {
  label: string;
  value: number;
  [key: string]: string | number;
}

export interface AppletBarChartProps {
  title: string;
  description?: string;
  data: BarChartDatum[];
  valueLabel?: string;
  emptyState?: string;
  formatValue?: (value: number) => string;
}

const defaultFormat = (value: number) => String(value);

export function BarChart({
  title,
  description,
  data,
  valueLabel = "Value",
  emptyState = "No chart data yet.",
  formatValue = defaultFormat,
}: AppletBarChartProps) {
  const config = {
    value: { label: valueLabel, color: "hsl(173 58% 42%)" },
  } satisfies ChartConfig;

  return (
    <section className="rounded-lg border border-border/70 bg-background p-4">
      <div className="mb-4">
        <h3 className="text-sm font-semibold">{title}</h3>
        {description ? (
          <p className="mt-1 text-xs text-muted-foreground">{description}</p>
        ) : null}
      </div>
      {data.length === 0 ? (
        <div className="flex h-64 items-center justify-center rounded-md border border-dashed border-border/70 text-sm text-muted-foreground">
          {emptyState}
        </div>
      ) : (
        <ChartContainer config={config} className="aspect-auto h-64 w-full">
          <RechartsBarChart data={data} margin={{ left: 8, right: 8 }}>
            <CartesianGrid vertical={false} />
            <XAxis
              dataKey="label"
              tickLine={false}
              axisLine={false}
              tickMargin={8}
              tick={{ fontSize: 11 }}
            />
            <YAxis
              tickLine={false}
              axisLine={false}
              tickFormatter={(value: number) => formatValue(value)}
              tick={{ fontSize: 11 }}
              width={64}
            />
            <ChartTooltip
              cursor={false}
              content={
                <ChartTooltipContent
                  formatter={(value) => (
                    <span className="font-mono tabular-nums">
                      {formatValue(Number(value))}
                    </span>
                  )}
                />
              }
            />
            <Bar
              dataKey="value"
              fill="var(--color-value)"
              radius={[4, 4, 0, 0]}
            />
          </RechartsBarChart>
        </ChartContainer>
      )}
    </section>
  );
}
