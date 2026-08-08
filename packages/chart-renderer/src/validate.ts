/**
 * Shared validation for ChartDirectiveData — the single source of truth for
 * what a well-formed chart is, used by the tw:chart document directive, the
 * runtime's chart-emission tool, and the finalize part normalizer.
 *
 * The rules (and their error strings) mirror the tw:chart directive contract:
 * known type, non-blank title, 1–24 series points of { label, finite value },
 * optional finite max.
 */

import { CHART_TYPES } from "./types.js";
import type {
  ChartDirectiveData,
  ChartSeriesPoint,
  ChartType,
} from "./types.js";

export type ChartValidationResult =
  | { ok: true; data: ChartDirectiveData }
  | { ok: false; error: string };

function textOf(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  return null;
}

/** Validate and normalize an unknown value into ChartDirectiveData. */
export function validateChartDirectiveData(
  value: unknown,
): ChartValidationResult {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return { ok: false, error: "chart data must be an object." };
  }
  const root = value as Record<string, unknown>;

  const type = root.type;
  if (!(CHART_TYPES as readonly string[]).includes(type as string)) {
    return {
      ok: false,
      error: `Unknown chart type ${JSON.stringify(type)}. Supported types: ${CHART_TYPES.join(", ")}.`,
    };
  }

  const title = textOf(root.title);
  if (title === null || title.trim() === "") {
    return { ok: false, error: "chart needs a `title`." };
  }

  const rawSeries = root.series;
  if (
    !Array.isArray(rawSeries) ||
    rawSeries.length === 0 ||
    rawSeries.length > 24
  ) {
    return {
      ok: false,
      error: "chart needs a `series` list with 1–24 points.",
    };
  }
  const series: ChartSeriesPoint[] = [];
  for (const [i, point] of rawSeries.entries()) {
    const rec =
      typeof point === "object" && point !== null && !Array.isArray(point)
        ? (point as Record<string, unknown>)
        : null;
    const label = textOf(rec?.label);
    const pointValue = rec?.value;
    if (
      label === null ||
      typeof pointValue !== "number" ||
      !Number.isFinite(pointValue)
    ) {
      return {
        ok: false,
        error: `series[${i}] must be { label: string, value: finite number }.`,
      };
    }
    series.push({ label, value: pointValue });
  }

  const max = root.max;
  if (max !== undefined && (typeof max !== "number" || !Number.isFinite(max))) {
    return { ok: false, error: "`max` must be a finite number." };
  }

  return {
    ok: true,
    data: {
      type: type as ChartType,
      title: title.trim(),
      qualifier: textOf(root.qualifier) ?? undefined,
      series,
      caption: textOf(root.caption) ?? undefined,
      max: max as number | undefined,
    },
  };
}
