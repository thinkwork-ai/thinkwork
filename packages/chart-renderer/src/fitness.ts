/**
 * Per-kind mobile fitness rules (THINK-678): whether a chart kind survives a
 * given frame width, or should degrade takeaway-first (caption + data table
 * instead of a squeezed, illegible mark). Small-screen degradation is a design
 * principle, not a failure mode — a 24-point donut at 360pt should choose not
 * to be a chart.
 *
 * Deterministic and conservative: rules only veto shapes that are provably
 * cramped at the given width; everything else renders.
 */

import type { ChartDirectiveData } from "./types.js";

/**
 * True when the chart should render as an SVG at this width; false when the
 * surface should fall back to caption + data table (takeaway-first).
 */
export function chartFitsWidth(
  data: ChartDirectiveData,
  width: number,
): boolean {
  if (width < 200) return false;
  const n = data.series.length;
  switch (data.type) {
    case "donut":
      // Legend rows stay readable; ring segments under ~1/12 of the circle
      // become slivers. Narrow screens tolerate fewer segments.
      return n <= (width < 520 ? 8 : 12);
    case "stat-strip":
      // Tiles narrower than ~80 units can't fit a value + label. The renderer
      // wraps to two rows below 520 wide, doubling capacity.
      return n <= Math.max(2, Math.floor(width / 80)) * (width < 520 ? 2 : 1);
    case "bar":
      // Column bands narrower than ~24 units lose their x labels entirely.
      return n <= Math.max(6, Math.floor(width / 24));
    case "funnel":
      // Row-per-stage layout scales with height, not width; cap only the
      // pathological case where the stage list stops being a funnel.
      return n <= 12;
    case "line":
    case "sparkline":
    case "meter":
      // Lines thin their own labels; sparkline and meter are single-mark.
      return true;
  }
}
