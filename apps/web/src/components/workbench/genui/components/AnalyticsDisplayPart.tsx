import {
  createAnalyticsDisplayRenderModel,
  type AnalyticsDisplayRenderModel,
} from "@thinkwork/analytics-display/react";
import type {
  AnalyticsChartElement,
  AnalyticsDisplayElement,
  AnalyticsDisplayRenderPayload,
  AnalyticsMetricElement,
  AnalyticsPrimitive,
  AnalyticsTableElement,
} from "@thinkwork/analytics-display";
import { safeDisplayValue } from "@thinkwork/analytics-display";
import {
  validateAnalyticsDisplayGenUIData,
  type ThreadGenUIData,
} from "@thinkwork/genui";
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  type ChartConfig,
} from "@thinkwork/ui";
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

export interface AnalyticsDisplayPartProps {
  data: ThreadGenUIData;
}

export function AnalyticsDisplayPart({ data }: AnalyticsDisplayPartProps) {
  const result = validateAnalyticsDisplayGenUIData(data);

  if (!result.ok) {
    return (
      <section
        aria-label="Unsupported analytical display"
        className="rounded-md border border-dashed border-border bg-muted/30 p-3 text-sm text-muted-foreground"
        data-testid="analytics-display-fallback"
      >
        <div className="font-medium text-foreground">Unsupported analytics</div>
        <p className="mt-1">
          {data.mobileFallback?.summary ??
            result.diagnostics[0]?.message ??
            "This analytical display cannot be rendered inline."}
        </p>
      </section>
    );
  }

  const model = createAnalyticsDisplayRenderModel(result.payload, {
    host: "thread",
    density: "thread",
  });

  return (
    <section
      aria-label={model.title}
      className="space-y-3 rounded-md border border-border bg-card p-3 text-sm shadow-sm"
      data-testid="analytics-display-part"
    >
      <Header model={model} />
      <div className="grid gap-2">
        {model.elements.map((element) => (
          <ElementCard
            element={
              result.payload.spec.elements.find(
                (candidate) => candidate.id === element.id,
              ) ?? null
            }
            key={element.id}
            maxHeight={element.maxHeight}
            payload={result.payload}
            rowPreviewLimit={element.rowPreviewLimit}
            title={element.title}
            type={element.type}
          />
        ))}
      </div>
    </section>
  );
}

function Header({ model }: { model: AnalyticsDisplayRenderModel }) {
  return (
    <header className="space-y-2">
      <div>
        <h3 className="text-sm font-semibold text-foreground">{model.title}</h3>
        <p className="text-xs text-muted-foreground">
          {model.summary.provenance} · {model.summary.freshness}
        </p>
      </div>
      {model.summary.appliedFilters?.length ? (
        <div className="flex flex-wrap gap-1" aria-label="Applied filters">
          {model.summary.appliedFilters.map((filter) => (
            <span
              className="rounded border border-border bg-muted px-1.5 py-0.5 text-xs text-muted-foreground"
              key={filter}
            >
              {filter}
            </span>
          ))}
        </div>
      ) : null}
      <ul className="space-y-1 text-xs text-muted-foreground">
        {model.summary.lines.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
    </header>
  );
}

function ElementCard({
  element,
  maxHeight,
  payload,
  rowPreviewLimit,
  title,
  type,
}: {
  element: AnalyticsDisplayElement | null;
  maxHeight: number;
  payload: AnalyticsDisplayRenderPayload;
  rowPreviewLimit?: number;
  title: string;
  type: AnalyticsDisplayElement["type"];
}) {
  return (
    <article
      className="overflow-hidden rounded-md border border-border/70 bg-background"
      data-testid={`analytics-display-element-${type}`}
      style={{ maxHeight }}
    >
      <div className="flex items-center justify-between gap-2 border-b border-border/60 px-3 py-2">
        <h4 className="text-sm font-medium text-foreground">{title}</h4>
        <span className="text-xs text-muted-foreground">{type}</span>
      </div>
      <div className="p-3">
        {element ? (
          <ElementBody
            element={element}
            payload={payload}
            rowPreviewLimit={rowPreviewLimit}
          />
        ) : (
          <p className="text-xs text-muted-foreground">
            Analytical element unavailable.
          </p>
        )}
      </div>
    </article>
  );
}

function ElementBody({
  element,
  payload,
  rowPreviewLimit,
}: {
  element: AnalyticsDisplayElement;
  payload: AnalyticsDisplayRenderPayload;
  rowPreviewLimit?: number;
}) {
  if (element.type === "metric") {
    return <MetricElement element={element} payload={payload} />;
  }

  if (element.type === "chart") {
    return <ChartElement element={element} payload={payload} />;
  }

  return (
    <TableElement
      element={element}
      payload={payload}
      rowPreviewLimit={rowPreviewLimit ?? 8}
    />
  );
}

function MetricElement({
  element,
  payload,
}: {
  element: AnalyticsMetricElement;
  payload: AnalyticsDisplayRenderPayload;
}) {
  const value = payload.data.rows[0]?.[element.valueKey];
  return (
    <div className="grid gap-1">
      <div className="text-2xl font-semibold tabular-nums text-foreground">
        {formatValue(value, element.unit)}
      </div>
      {element.label ? (
        <p className="text-xs text-muted-foreground">{element.label}</p>
      ) : null}
    </div>
  );
}

function ChartElement({
  element,
  payload,
}: {
  element: AnalyticsChartElement;
  payload: AnalyticsDisplayRenderPayload;
}) {
  if (!payload.data.rows.length) {
    return (
      <p className="text-xs text-muted-foreground">
        {payload.spec.emptyState?.title ?? "No chart data."}
      </p>
    );
  }

  const config = chartConfigFor(element);
  const chartClassName = "aspect-auto h-44 w-full";

  if (element.chartKind === "line") {
    return (
      <ChartContainer config={config} className={chartClassName}>
        <LineChart data={payload.data.rows} margin={CHART_MARGIN}>
          <CartesianGrid vertical={false} />
          <XAxis
            dataKey={element.categoryKey}
            axisLine={false}
            tickLine={false}
            tickFormatter={shortTick}
          />
          <YAxis axisLine={false} tickLine={false} tickFormatter={shortNumber} />
          <ChartTooltip cursor={false} content={<ChartTooltipContent />} />
          <ChartLegend content={<ChartLegendContent />} />
          {element.series.map((series) => (
            <Line
              dataKey={series.valueKey}
              dot={false}
              key={series.key}
              name={series.label}
              stroke={`var(--color-${series.valueKey})`}
              strokeWidth={2}
              type="monotone"
            />
          ))}
        </LineChart>
      </ChartContainer>
    );
  }

  if (element.chartKind === "area") {
    return (
      <ChartContainer config={config} className={chartClassName}>
        <AreaChart data={payload.data.rows} margin={CHART_MARGIN}>
          <CartesianGrid vertical={false} />
          <XAxis
            dataKey={element.categoryKey}
            axisLine={false}
            tickLine={false}
            tickFormatter={shortTick}
          />
          <YAxis axisLine={false} tickLine={false} tickFormatter={shortNumber} />
          <ChartTooltip cursor={false} content={<ChartTooltipContent />} />
          <ChartLegend content={<ChartLegendContent />} />
          {element.series.map((series) => (
            <Area
              dataKey={series.valueKey}
              fill={`var(--color-${series.valueKey})`}
              fillOpacity={0.22}
              key={series.key}
              name={series.label}
              stroke={`var(--color-${series.valueKey})`}
              strokeWidth={2}
              type="monotone"
            />
          ))}
        </AreaChart>
      </ChartContainer>
    );
  }

  if (element.chartKind === "pie") {
    const series = element.series[0];
    return (
      <ChartContainer config={config} className={chartClassName}>
        <PieChart margin={CHART_MARGIN}>
          <ChartTooltip cursor={false} content={<ChartTooltipContent />} />
          <Pie
            data={payload.data.rows}
            dataKey={series?.valueKey}
            nameKey={element.categoryKey}
            innerRadius={42}
            outerRadius={74}
            paddingAngle={2}
          >
            {payload.data.rows.map((row, index) => (
              <Cell
                fill={`var(--chart-${(index % 5) + 1})`}
                key={String(row[element.categoryKey] ?? index)}
              />
            ))}
          </Pie>
        </PieChart>
      </ChartContainer>
    );
  }

  return (
    <ChartContainer config={config} className={chartClassName}>
      <BarChart data={payload.data.rows} margin={CHART_MARGIN}>
        <CartesianGrid vertical={false} />
        <XAxis
          dataKey={element.categoryKey}
          axisLine={false}
          tickLine={false}
          tickFormatter={shortTick}
        />
        <YAxis axisLine={false} tickLine={false} tickFormatter={shortNumber} />
        <ChartTooltip cursor={false} content={<ChartTooltipContent />} />
        <ChartLegend content={<ChartLegendContent />} />
        {element.series.map((series, index) => (
          <Bar
            dataKey={series.valueKey}
            fill={`var(--color-${series.valueKey})`}
            key={series.key}
            name={series.label}
            radius={index === element.series.length - 1 ? [3, 3, 0, 0] : 0}
          />
        ))}
      </BarChart>
    </ChartContainer>
  );
}

function TableElement({
  element,
  payload,
  rowPreviewLimit,
}: {
  element: AnalyticsTableElement;
  payload: AnalyticsDisplayRenderPayload;
  rowPreviewLimit: number;
}) {
  const rows = payload.data.rows.slice(0, rowPreviewLimit);
  if (!rows.length) {
    return (
      <p className="text-xs text-muted-foreground">
        {payload.spec.emptyState?.title ?? "No table rows."}
      </p>
    );
  }

  return (
    <div className="max-h-56 overflow-auto">
      <Table>
        <TableHeader>
          <TableRow>
            {element.columns.map((column) => (
              <TableHead className="h-8 text-xs" key={column.key}>
                {column.label}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row, index) => (
            <TableRow key={index}>
              {element.columns.map((column) => (
                <TableCell
                  className="py-1.5 text-xs tabular-nums"
                  key={column.key}
                >
                  {safeDisplayValue(row[column.key])}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

const CHART_MARGIN = { left: 4, right: 8, top: 8, bottom: 0 };

function chartConfigFor(element: AnalyticsChartElement): ChartConfig {
  return Object.fromEntries(
    element.series.map((series) => [
      series.valueKey,
      {
        label: series.label,
        color: paletteColor(series.palette),
      },
    ]),
  ) satisfies ChartConfig;
}

function paletteColor(palette: string): string {
  return `var(--${palette})`;
}

function formatValue(value: AnalyticsPrimitive | undefined, unit?: string) {
  const formatted = safeDisplayValue(value);
  if (!formatted) return "No value";
  if (unit === "USD") return `$${formatted}`;
  return unit ? `${formatted} ${unit}` : formatted;
}

function shortNumber(value: unknown): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "";
  if (Math.abs(value) >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (Math.abs(value) >= 1_000) return `${Math.round(value / 1_000)}K`;
  return String(value);
}

function shortTick(value: unknown): string {
  const label = safeDisplayValue(value);
  return label.length > 12 ? `${label.slice(0, 11)}…` : label;
}
