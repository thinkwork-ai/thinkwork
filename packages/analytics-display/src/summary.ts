import { analyticsDisplayLimits } from "./limits.js";
import type {
  AnalyticsDisplayRenderPayload,
  AnalyticsDisplaySummary,
} from "./spec.js";
import {
  formatFreshness,
  formatProvenance,
  safeDisplayValue,
} from "./formatters.js";

export function createAnalyticsDisplaySummary(
  payload: AnalyticsDisplayRenderPayload,
): AnalyticsDisplaySummary {
  const lines = payload.spec.elements
    .slice(0, analyticsDisplayLimits.maxSummaryLines)
    .map((element) => summarizeElement(payload, element.id))
    .filter((line): line is string => Boolean(line));

  return {
    title: safeDisplayValue(payload.spec.title),
    lines: lines.length
      ? lines
      : [payload.spec.emptyState?.title ?? "No analytical data to display."],
    provenance: formatProvenance(payload.provenance.sourceLabels),
    freshness: formatFreshness(
      payload.freshness.takenAt,
      payload.freshness.oldestAt,
    ),
    appliedFilters: payload.spec.filters?.map((filter) =>
      safeDisplayValue(filter.label),
    ),
  };
}

function summarizeElement(
  payload: AnalyticsDisplayRenderPayload,
  elementId: string,
): string | null {
  const element = payload.spec.elements.find(
    (candidate) => candidate.id === elementId,
  );
  if (!element) return null;

  if (element.type === "metric") {
    const firstRow = payload.data.rows[0];
    const value = firstRow ? safeDisplayValue(firstRow[element.valueKey]) : "";
    return `${safeDisplayValue(element.title)}: ${value || "No value"}`;
  }

  if (element.type === "chart") {
    return `${safeDisplayValue(element.title)}: ${payload.data.rows.length} point${payload.data.rows.length === 1 ? "" : "s"}`;
  }

  return `${safeDisplayValue(element.title)}: ${payload.data.rows.length} row${payload.data.rows.length === 1 ? "" : "s"}`;
}
