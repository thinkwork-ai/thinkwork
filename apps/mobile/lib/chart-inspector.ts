/**
 * Pure helpers for the interactive chart inspector sheet (THINK-683).
 *
 * The inspector is fed by the *same* `ChartDirectiveData` the inline
 * `ChartCard` already rendered — there is no second payload. These helpers
 * translate that shape into what Victory Native XL wants (Cartesian rows /
 * pie slices) and decide which treatment a chart kind gets. Keeping them in a
 * plain `.ts` module makes them unit-testable under the mobile vitest config,
 * which only globs `.ts` (no JSX / no native runtime).
 */

import {
  HOUSE_DARK,
  type ChartDirectiveData,
  type ChartSeriesPoint,
  type ChartType,
} from "@thinkwork/chart-renderer";

/**
 * How the inspector draws a given chart kind.
 *
 * `svg-detail` is the honest fallback: funnel / meter / stat-strip have no
 * Victory Native XL equivalent, so those render the house SVG enlarged with
 * the data table always expanded rather than being forced into a bar chart.
 */
export type InspectorKind =
  | "cartesian-bar"
  | "cartesian-line"
  | "polar-pie"
  | "svg-detail";

export function inspectorKindFor(type: ChartType): InspectorKind {
  switch (type) {
    case "bar":
      return "cartesian-bar";
    case "line":
    case "sparkline":
      return "cartesian-line";
    case "donut":
      return "polar-pie";
    default:
      return "svg-detail";
  }
}

/**
 * One row of the Victory Native XL Cartesian dataset.
 *
 * Declared as a type alias, not an interface: VNXL's generics require
 * `Record<string, unknown>`, and only object *type aliases* get the implicit
 * index signature that assignment needs.
 */
export type CartesianRow = {
  /** Zero-based index — VNXL wants a numeric x domain; `label` is the tick. */
  x: number;
  y: number;
  label: string;
};

/**
 * Series → Cartesian rows. Non-finite values collapse to 0 so a single bad
 * point can't blow up the domain (the renderer applies the same guard).
 */
export function toCartesianData(data: ChartDirectiveData): CartesianRow[] {
  return data.series.map((point, index) => ({
    x: index,
    y: Number.isFinite(point.value) ? point.value : 0,
    label: point.label,
  }));
}

/** One slice of the Victory Native XL pie dataset (type alias — see above). */
export type PieSlice = {
  label: string;
  value: number;
  color: string;
  /** Percent of total, rounded like the house renderer's funnel share. */
  share: number;
};

/**
 * The house renderer's `hues()` ramp, in order. Donut slices cycle through it
 * exactly the way `renderChart` does so the inspector and the inline card
 * agree on which slice is which color.
 */
export const HUE_KEYS = ["accent", "info", "warn", "bad"] as const;

/** Hue hexes for a palette, in `hues()` order. */
export function hueRamp(palette: {
  accent: string;
  info: string;
  warn: string;
  bad: string;
}): string[] {
  return HUE_KEYS.map((key) => palette[key]);
}

/**
 * Percent of the positive total held by `series[index]`, rounded to a whole
 * number the way the house renderer rounds its funnel share. Returns 0 when
 * the total is zero (or negative-only) rather than dividing by zero, and 0
 * for an out-of-range index.
 */
export function sliceShare(
  series: readonly ChartSeriesPoint[],
  index: number,
): number {
  const point = series[index];
  if (!point) return 0;
  const total = series.reduce(
    (sum, p) => sum + (Number.isFinite(p.value) ? Math.max(0, p.value) : 0),
    0,
  );
  if (total <= 0) return 0;
  const value = Number.isFinite(point.value) ? Math.max(0, point.value) : 0;
  return Math.round((value / total) * 100);
}

/**
 * Series → pie slices, colored by the house hue ramp and carrying their
 * share of the total so the sheet can label a tapped slice without
 * recomputing anything.
 */
export function toPieData(
  data: ChartDirectiveData,
  palette: {
    accent: string;
    info: string;
    warn: string;
    bad: string;
  } = HOUSE_DARK,
): PieSlice[] {
  const ramp = hueRamp(palette);
  return data.series.map((point, index) => ({
    label: point.label,
    value: Number.isFinite(point.value) ? Math.max(0, point.value) : 0,
    color: ramp[index % ramp.length],
    share: sliceShare(data.series, index),
  }));
}
