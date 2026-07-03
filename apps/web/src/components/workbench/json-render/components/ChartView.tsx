import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  XAxis,
  YAxis,
} from "recharts";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@thinkwork/ui";

import {
  buildChartConfig,
  buildPaletteConfig,
  CHART_COLOR_KEYS,
  chartColorVar,
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartColorKey,
  type ChartSeries,
} from "./chart-container";

type ChartKind = "area" | "bar" | "line" | "pie";

type ChartDataValue = string | number | boolean | null;

type ChartDataRow = Record<string, ChartDataValue>;

export interface ChartViewProps {
  kind?: ChartKind;
  title?: string | null;
  description?: string | null;
  footer?: string | null;
  xKey?: string;
  series?: ChartSeries[];
  data?: ChartDataRow[];
}

export function ChartView({
  kind = "bar",
  title,
  description,
  footer,
  xKey,
  series,
  data,
}: ChartViewProps) {
  // Partial-frame tolerance (KTD7): during streaming, series/data may not have
  // arrived. Fall back to safe defaults and never throw on axis/dataKey access.
  const safeSeries = Array.isArray(series)
    ? series.filter(
        (item): item is ChartSeries =>
          !!item && typeof item.dataKey === "string" && item.dataKey.length > 0,
      )
    : [];
  const safeData = Array.isArray(data) ? data : [];
  const config =
    kind === "pie"
      ? {
          ...buildChartConfig(safeSeries),
          ...buildPaletteConfig(safeData.length),
        }
      : buildChartConfig(safeSeries);
  const hasChart = safeSeries.length > 0 && safeData.length > 0;

  return (
    <Card data-testid="json-render-chart">
      {title || description ? (
        <CardHeader>
          {title ? <CardTitle>{title}</CardTitle> : null}
          {description ? (
            <CardDescription>{description}</CardDescription>
          ) : null}
        </CardHeader>
      ) : null}
      <CardContent>
        {hasChart ? (
          <ChartContainer config={config} className="aspect-auto h-64 w-full">
            {renderChart(kind, safeSeries, safeData, xKey)}
          </ChartContainer>
        ) : (
          <div
            className="flex h-40 items-center justify-center rounded-md border border-dashed border-border bg-muted/25"
            data-testid="json-render-chart-empty"
          >
            <p className="text-sm text-muted-foreground">Preparing chart…</p>
          </div>
        )}
      </CardContent>
      {footer ? (
        <CardFooter>
          <p className="text-sm text-muted-foreground">{footer}</p>
        </CardFooter>
      ) : null}
    </Card>
  );
}

function renderChart(
  kind: ChartKind,
  series: ChartSeries[],
  data: ChartDataRow[],
  xKey: string | undefined,
) {
  const categoryKey = typeof xKey === "string" && xKey ? xKey : undefined;

  if (kind === "pie") {
    const valueKey = series[0]?.dataKey;
    if (!valueKey) return <PieChart />;
    return (
      <PieChart>
        <ChartTooltip content={<ChartTooltipContent nameKey={categoryKey} />} />
        <Pie
          data={data}
          dataKey={valueKey}
          nameKey={categoryKey}
          outerRadius="80%"
        >
          {data.map((_, index) => (
            <Cell key={`slice-${index}`} fill={paletteColorVar(index)} />
          ))}
        </Pie>
        <ChartLegend content={<ChartLegendContent nameKey={categoryKey} />} />
      </PieChart>
    );
  }

  if (kind === "area") {
    return (
      <AreaChart data={data}>
        <CartesianGrid vertical={false} />
        {categoryKey ? (
          <XAxis
            dataKey={categoryKey}
            tickLine={false}
            axisLine={false}
            tick={{ fontSize: 11 }}
          />
        ) : null}
        <YAxis
          tickLine={false}
          axisLine={false}
          tick={{ fontSize: 11 }}
          width={40}
        />
        <ChartTooltip content={<ChartTooltipContent />} />
        <ChartLegend content={<ChartLegendContent />} />
        {series.map((item) => (
          <Area
            key={item.dataKey}
            dataKey={item.dataKey}
            type="monotone"
            stroke={chartColorVar(item.dataKey)}
            fill={chartColorVar(item.dataKey)}
            fillOpacity={0.2}
            stackId="a"
          />
        ))}
      </AreaChart>
    );
  }

  if (kind === "line") {
    return (
      <LineChart data={data}>
        <CartesianGrid vertical={false} />
        {categoryKey ? (
          <XAxis
            dataKey={categoryKey}
            tickLine={false}
            axisLine={false}
            tick={{ fontSize: 11 }}
          />
        ) : null}
        <YAxis
          tickLine={false}
          axisLine={false}
          tick={{ fontSize: 11 }}
          width={40}
        />
        <ChartTooltip content={<ChartTooltipContent />} />
        <ChartLegend content={<ChartLegendContent />} />
        {series.map((item) => (
          <Line
            key={item.dataKey}
            dataKey={item.dataKey}
            type="monotone"
            stroke={chartColorVar(item.dataKey)}
            dot={false}
            strokeWidth={2}
          />
        ))}
      </LineChart>
    );
  }

  // bar (default)
  return (
    <BarChart data={data}>
      <CartesianGrid vertical={false} />
      {categoryKey ? (
        <XAxis
          dataKey={categoryKey}
          tickLine={false}
          axisLine={false}
          tick={{ fontSize: 11 }}
        />
      ) : null}
      <YAxis
        tickLine={false}
        axisLine={false}
        tick={{ fontSize: 11 }}
        width={40}
      />
      <ChartTooltip content={<ChartTooltipContent />} />
      <ChartLegend content={<ChartLegendContent />} />
      {series.map((item) => (
        <Bar
          key={item.dataKey}
          dataKey={item.dataKey}
          fill={chartColorVar(item.dataKey)}
          radius={[3, 3, 0, 0]}
        />
      ))}
    </BarChart>
  );
}

function paletteColorVar(index: number): string {
  const key: ChartColorKey =
    CHART_COLOR_KEYS[index % CHART_COLOR_KEYS.length] ?? "chart-1";
  return `var(--color-${key})`;
}
