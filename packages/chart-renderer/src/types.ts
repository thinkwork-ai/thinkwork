/**
 * Chart directive data shapes — the contract between the document directive
 * engine (which validates model-authored YAML) and the house SVG renderer.
 *
 * Moved out of `packages/api/src/lib/artifacts/document-directives.ts` so the
 * renderer can be shared by the server document/plate path and native clients.
 */

export const CHART_TYPES = [
  "bar",
  "line",
  "donut",
  "stat-strip",
  "sparkline",
  "meter",
  "funnel",
] as const;
export type ChartType = (typeof CHART_TYPES)[number];

export interface ChartSeriesPoint {
  label: string;
  value: number;
}

export interface ChartDirectiveData {
  type: ChartType;
  title: string;
  /** One-line qualifier under the title (unit / what one mark measures). */
  qualifier?: string;
  series: ChartSeriesPoint[];
  /** Figure caption: the takeaway, not a chart description. */
  caption?: string;
  /** meter only: the maximum the value is measured against. */
  max?: number;
}
