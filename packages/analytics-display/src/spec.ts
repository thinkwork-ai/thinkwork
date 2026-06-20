export const ANALYTICS_DISPLAY_VERSION = "analytics-display/v1" as const;

export const ANALYTICS_DISPLAY_KIND = "analytics.display" as const;

export const CHART_KINDS = ["bar", "line", "area", "pie"] as const;

export const PALETTE_TOKENS = [
  "chart-1",
  "chart-2",
  "chart-3",
  "chart-4",
  "chart-5",
] as const;

export const FILTER_OPERATORS = [
  "text_contains",
  "value_select",
  "range",
] as const;

export const VALUE_TYPES = ["string", "number", "boolean", "date"] as const;

export const SENSITIVITY_LEVELS = [
  "public",
  "internal",
  "sensitive",
  "pii",
] as const;

export const REDACTION_MODES = ["none", "aggregate", "redacted"] as const;

export type AnalyticsDisplayVersion = typeof ANALYTICS_DISPLAY_VERSION;
export type AnalyticsDisplayKind = typeof ANALYTICS_DISPLAY_KIND;
export type ChartKind = (typeof CHART_KINDS)[number];
export type PaletteToken = (typeof PALETTE_TOKENS)[number];
export type FilterOperator = (typeof FILTER_OPERATORS)[number];

export type AnalyticsPrimitive = string | number | boolean | null;
export type AnalyticsRow = Record<string, AnalyticsPrimitive>;

export type AnalyticsValueType = (typeof VALUE_TYPES)[number];
export type AnalyticsSensitivity = (typeof SENSITIVITY_LEVELS)[number];
export type AnalyticsRedaction = (typeof REDACTION_MODES)[number];

export interface AnalyticsColumnSpec {
  key: string;
  label: string;
  type: AnalyticsValueType;
  sensitivity?: AnalyticsSensitivity;
  redaction?: AnalyticsRedaction;
}

export interface AnalyticsMetricElement {
  type: "metric";
  id: string;
  title: string;
  valueKey: string;
  label?: string;
  unit?: string;
  palette?: PaletteToken;
}

export interface AnalyticsChartSeriesSpec {
  key: string;
  label: string;
  valueKey: string;
  palette: PaletteToken;
}

export interface AnalyticsChartElement {
  type: "chart";
  id: string;
  title: string;
  chartKind: ChartKind;
  categoryKey: string;
  series: AnalyticsChartSeriesSpec[];
}

export interface AnalyticsTableElement {
  type: "table";
  id: string;
  title: string;
  columns: Array<{ key: string; label: string }>;
}

export type AnalyticsDisplayElement =
  | AnalyticsMetricElement
  | AnalyticsChartElement
  | AnalyticsTableElement;

export interface AnalyticsFilterSpec {
  id: string;
  label: string;
  columnKey: string;
  operator: FilterOperator;
  values?: AnalyticsPrimitive[];
  range?: {
    min?: number | string;
    max?: number | string;
  };
}

export interface AnalyticsFreshness {
  takenAt: string;
  oldestAt?: string;
  status?: "fresh" | "stale" | "unknown";
}

export interface AnalyticsProvenance {
  sourceLabels: string[];
  dataSourceSlugs?: string[];
  materializedByUserId?: string;
}

export interface AnalyticsSensitivityMetadata {
  containsSensitiveFields: boolean;
  sensitiveColumns?: string[];
  policy?: "display_limited" | "redacted" | "aggregate_only";
}

export interface AnalyticsDisplaySpec {
  title: string;
  description?: string;
  columns: AnalyticsColumnSpec[];
  elements: AnalyticsDisplayElement[];
  filters?: AnalyticsFilterSpec[];
  emptyState?: {
    title: string;
    description?: string;
  };
}

export interface AnalyticsDisplayDiagnostic {
  code: string;
  message: string;
  path?: string;
  severity: "error" | "warning";
}

export interface AnalyticsDisplayRenderData {
  rows: AnalyticsRow[];
}

export interface AnalyticsDisplayRenderPayload {
  kind: AnalyticsDisplayKind;
  analyticsDisplayVersion: AnalyticsDisplayVersion;
  spec: AnalyticsDisplaySpec;
  data: AnalyticsDisplayRenderData;
  freshness: AnalyticsFreshness;
  provenance: AnalyticsProvenance;
  diagnostics?: AnalyticsDisplayDiagnostic[];
  sensitivity?: AnalyticsSensitivityMetadata;
}

export interface AnalyticsDisplaySummary {
  title: string;
  lines: string[];
  provenance: string;
  freshness: string;
  appliedFilters?: string[];
}

export type AnalyticsDisplayPayloadInput = unknown;
