import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import {
  createAnalyticsDisplaySummary,
  validateAnalyticsDisplayPayload,
  type AnalyticsDisplayRenderPayload,
} from "@thinkwork/analytics-display";
import { createAnalyticsDisplayGenUIPart } from "@thinkwork/genui";
import { Type } from "typebox";

import { defineExtension, type ThinkworkExtension } from "./define-extension.js";

const SHOW_ANALYTICS_DISPLAY_TOOL = "show_analytics_display";

export function createAnalyticsDisplayExtension(): ThinkworkExtension {
  return defineExtension({
    name: "thinkwork-analytics-display",
    toolNames: [SHOW_ANALYTICS_DISPLAY_TOOL],
    register(pi) {
      const tool: ToolDefinition = {
        name: SHOW_ANALYTICS_DISPLAY_TOOL,
        label: "Show Analytics Display",
        description:
          "Render a compact inline Thread chart/table/metric from source data. " +
          "Use this after you have rows from a connected source, MCP tool, workspace file, or prior thread context. " +
          "Do not invent CRM, sales, finance, or operational values. If the source is unavailable, explain what source access is needed instead of calling this tool. " +
          "The payload must be an analytics.display/v1 object with bounded rows, columns, elements, freshness, provenance, and sensitivity metadata. " +
          "For requests like 'display a chart of Twenty CRM opportunity value by owner', query or use the available Twenty CRM data first, then call this tool with a chart element grouped by owner.",
        parameters: Type.Object({
          id: Type.Optional(
            Type.String({
              description:
                "Stable data-genui part id. Defaults to a deterministic analytics id from the payload title.",
            }),
          ),
          payload: Type.Any({
            description:
              "analytics.display/v1 payload: { kind:'analytics.display', analyticsDisplayVersion:'analytics-display/v1', spec:{ title, columns, elements, filters? }, data:{ rows }, freshness, provenance, sensitivity? }.",
          }),
          artifactTitle: Type.Optional(
            Type.String({
              description:
                "Optional title used when the inline chart is promoted to an artifact.",
            }),
          ),
          artifactSummary: Type.Optional(
            Type.String({
              description:
                "Optional summary used when the inline chart is promoted to an artifact.",
            }),
          ),
        }),
        executionMode: "sequential",
        async execute(_toolCallId, params) {
          const input = params as {
            id?: string;
            payload?: unknown;
            artifactTitle?: string;
            artifactSummary?: string;
          };
          const result = validateAnalyticsDisplayPayload(
            normalizeAnalyticsToolPayload(input.payload),
          );
          if (!result.ok) {
            throw new Error(
              `show_analytics_display received an invalid analytics payload: ${result.diagnostics
                .map((diagnostic) => diagnostic.message)
                .join("; ")}`,
            );
          }

          const summary = createAnalyticsDisplaySummary(result.payload);
          const part = createAnalyticsDisplayGenUIPart({
            id: input.id || analyticsPartId(result.payload),
            payload: result.payload,
            promotion:
              input.artifactTitle || input.artifactSummary
                ? {
                    artifactTitle: input.artifactTitle || summary.title,
                    artifactSummary:
                      input.artifactSummary || summary.lines[0] || summary.title,
                  }
                : undefined,
          });

          return {
            content: [
              {
                type: "text",
                text: `Rendered ${summary.title} as an inline analytical display.`,
              },
            ],
            details: {
              threadGenUI: part,
              analyticsDisplaySummary: summary,
            },
          };
        },
      };

      pi.registerTool(tool);
    },
  });
}

function analyticsPartId(payload: AnalyticsDisplayRenderPayload): string {
  return `genui:analytics:${payload.spec.title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48)}`;
}

function normalizeAnalyticsToolPayload(input: unknown): unknown {
  if (!isRecord(input) || !isRecord(input.spec)) return input;

  const rows = isRecord(input.data) && Array.isArray(input.data.rows)
    ? input.data.rows.filter(isRecord)
    : [];
  const columns = normalizeColumns(input.spec.columns, rows);

  return {
    ...input,
    spec: {
      ...input.spec,
      columns,
      elements: normalizeElements(input.spec.elements, columns),
    },
  };
}

function normalizeColumns(
  rawColumns: unknown,
  rows: Array<Record<string, unknown>>,
) {
  if (!Array.isArray(rawColumns)) return rawColumns;

  return rawColumns.map((rawColumn) => {
    if (!isRecord(rawColumn)) return rawColumn;
    const key = stringValue(rawColumn.key) || stringValue(rawColumn.name);
    if (!key) return rawColumn;
    const label =
      stringValue(rawColumn.label) ||
      stringValue(rawColumn.name) ||
      humanizeKey(key);
    const type = normalizeValueType(rawColumn.type) || inferValueType(key, rows);

    return {
      ...rawColumn,
      key,
      label,
      type,
    };
  });
}

function normalizeElements(
  rawElements: unknown,
  columns: unknown,
) {
  if (!Array.isArray(rawElements) || !Array.isArray(columns)) {
    return rawElements;
  }

  const columnSpecs = columns.filter(isRecord);

  return rawElements.map((rawElement, index) => {
    if (!isRecord(rawElement)) return rawElement;
    const rawType = stringValue(rawElement.type);
    const chartKind =
      normalizeChartKind(rawElement.chartKind) ||
      normalizeChartKind(rawElement.chartType) ||
      normalizeChartKind(rawType);

    if (chartKind) {
      const categoryKey =
        stringValue(rawElement.categoryKey) ||
        axisKey(rawElement.xAxis) ||
        axisKey(rawElement.x);
      const valueKey =
        stringValue(rawElement.valueKey) ||
        axisKey(rawElement.yAxis) ||
        axisKey(rawElement.y);
      const title = stringValue(rawElement.title) || "Chart";
      const series = Array.isArray(rawElement.series) && rawElement.series.length
        ? rawElement.series.map((rawSeries, seriesIndex) =>
            normalizeSeries(rawSeries, valueKey, seriesIndex),
          )
        : valueKey
          ? [
              {
                key: valueKey,
                label: columnLabel(columnSpecs, valueKey),
                valueKey,
                palette: "chart-1",
              },
            ]
          : rawElement.series;

      return {
        ...rawElement,
        type: "chart",
        id: stringValue(rawElement.id) || slugId(title, index),
        title,
        chartKind,
        categoryKey,
        series,
      };
    }

    if (rawType === "table") {
      const title = stringValue(rawElement.title) || "Detail";
      return {
        ...rawElement,
        type: "table",
        id: stringValue(rawElement.id) || slugId(title, index),
        title,
        columns: normalizeTableColumns(rawElement.columns, columnSpecs),
      };
    }

    return rawElement;
  });
}

function normalizeSeries(
  rawSeries: unknown,
  fallbackValueKey: string | undefined,
  index: number,
) {
  if (!isRecord(rawSeries)) return rawSeries;
  const valueKey =
    stringValue(rawSeries.valueKey) ||
    stringValue(rawSeries.key) ||
    fallbackValueKey;
  if (!valueKey) return rawSeries;

  return {
    ...rawSeries,
    key: stringValue(rawSeries.key) || valueKey,
    label: stringValue(rawSeries.label) || humanizeKey(valueKey),
    valueKey,
    palette: normalizePalette(rawSeries.palette) || `chart-${(index % 5) + 1}`,
  };
}

function normalizeTableColumns(
  rawColumns: unknown,
  columnSpecs: Array<Record<string, unknown>>,
) {
  const tableColumns = Array.isArray(rawColumns) && rawColumns.length
    ? rawColumns
    : columnSpecs;

  return tableColumns.map((column) => {
    if (typeof column === "string") {
      return { key: column, label: columnLabel(columnSpecs, column) };
    }
    if (!isRecord(column)) return column;
    const key = stringValue(column.key) || stringValue(column.name);
    if (!key) return column;
    return {
      ...column,
      key,
      label:
        stringValue(column.label) || stringValue(column.name) || columnLabel(columnSpecs, key),
    };
  });
}

function axisKey(axis: unknown): string | undefined {
  if (!isRecord(axis)) return undefined;
  return stringValue(axis.key) || stringValue(axis.column);
}

function normalizeChartKind(value: unknown) {
  const chartKind = stringValue(value);
  return chartKind === "bar" ||
    chartKind === "line" ||
    chartKind === "area" ||
    chartKind === "pie"
    ? chartKind
    : undefined;
}

function normalizePalette(value: unknown) {
  const palette = stringValue(value);
  return palette === "chart-1" ||
    palette === "chart-2" ||
    palette === "chart-3" ||
    palette === "chart-4" ||
    palette === "chart-5"
    ? palette
    : undefined;
}

function normalizeValueType(value: unknown) {
  const type = stringValue(value);
  return type === "string" ||
    type === "number" ||
    type === "boolean" ||
    type === "date"
    ? type
    : undefined;
}

function inferValueType(key: string, rows: Array<Record<string, unknown>>) {
  const value = rows.map((row) => row[key]).find((item) => item != null);
  if (typeof value === "number") return "number";
  if (typeof value === "boolean") return "boolean";
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}/.test(value)) {
    return "date";
  }
  return "string";
}

function columnLabel(
  columnSpecs: Array<Record<string, unknown>>,
  key: string,
) {
  const column = columnSpecs.find((spec) => spec.key === key);
  return stringValue(column?.label) || stringValue(column?.name) || humanizeKey(key);
}

function slugId(title: string, index: number) {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
  return slug || `element-${index + 1}`;
}

function humanizeKey(key: string) {
  return key
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
