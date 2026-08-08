/**
 * Derived accessibility narration (THINK-679): one deterministic function from
 * ChartDirectiveData to screen-reader text, shared by every surface so
 * VoiceOver on mobile and aria-labels on web describe the same chart the same
 * way. Narration is derived from the data — never separately authored — so it
 * can't drift from what the chart shows.
 */

import type { ChartDirectiveData, ChartSeriesPoint } from "./types.js";

const KIND_NAMES: Record<ChartDirectiveData["type"], string> = {
  bar: "Column chart",
  line: "Line chart",
  donut: "Donut chart",
  "stat-strip": "Stat strip",
  sparkline: "Sparkline",
  meter: "Meter",
  funnel: "Funnel chart",
};

/** Grouped integers, ≤2 decimals — mirrors the renderer's label formatting. */
function fmt(n: number): string {
  const rounded =
    Math.abs(n) >= 100 ? Math.round(n) : Math.round(n * 100) / 100;
  const [int, frac] = String(rounded).split(".");
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return frac ? `${grouped}.${frac}` : grouped;
}

function point(p: ChartSeriesPoint): string {
  return `${p.label} ${fmt(p.value)}`;
}

/** List all points when short; ends-and-extremes summary when long. */
function seriesSummary(series: ChartSeriesPoint[]): string {
  if (series.length <= 8) {
    return series.map(point).join(", ");
  }
  const first = series[0];
  const last = series[series.length - 1];
  let min = series[0];
  let max = series[0];
  for (const p of series) {
    if (p.value < min.value) min = p;
    if (p.value > max.value) max = p;
  }
  return `${series.length} points from ${point(first)} to ${point(last)}, low ${point(min)}, high ${point(max)}`;
}

/** Screen-reader narration for one chart. Deterministic; no markup. */
export function chartNarration(data: ChartDirectiveData): string {
  const parts: string[] = [`${KIND_NAMES[data.type]}: ${data.title}.`];
  if (data.qualifier) parts.push(`${data.qualifier}.`);

  switch (data.type) {
    case "funnel": {
      const first = data.series[0];
      const last = data.series[data.series.length - 1];
      parts.push(
        `${data.series.length} stages: ${seriesSummary(data.series)}.`,
      );
      if (data.series.length > 1 && first.value > 0) {
        const pct = Math.round((Math.max(0, last.value) / first.value) * 100);
        parts.push(`${last.label} is ${pct}% of ${first.label}.`);
      }
      break;
    }
    case "donut": {
      const total = data.series.reduce((s, p) => s + Math.max(0, p.value), 0);
      parts.push(`${seriesSummary(data.series)}.`);
      if (total > 0) {
        let largest = data.series[0];
        for (const p of data.series) {
          if (p.value > largest.value) largest = p;
        }
        const share = Math.round((Math.max(0, largest.value) / total) * 100);
        parts.push(
          `Total ${fmt(total)}; largest share ${largest.label} at ${share}%.`,
        );
      }
      break;
    }
    case "meter": {
      const p = data.series[0];
      const max = data.max !== undefined && data.max > 0 ? data.max : 100;
      parts.push(`${p.label}: ${fmt(p.value)} of ${fmt(max)}.`);
      break;
    }
    default:
      parts.push(`${seriesSummary(data.series)}.`);
  }

  if (data.caption) parts.push(`Takeaway: ${data.caption}`);
  return parts.join(" ");
}
