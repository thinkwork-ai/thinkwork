/**
 * `data-chart` message parts on mobile (THINK-676).
 *
 * Parsing mirrors `parseThreadJsonRenderFallbacks` in `lib/genui-registry.ts`:
 * `parts` arrives either as a jsonb array or as a JSON string depending on the
 * query path, so both shapes normalize to an array before validation. The
 * server is the single validator; we still drop anything that fails
 * `validateChartMessagePart` rather than rendering a broken chart.
 */

import {
  validateChartMessagePart,
  type ChartDirectiveData,
  type ChartMessagePart,
} from "@thinkwork/chart-renderer";

/** Hard cap on charts rendered per message — protects the list from a runaway. */
export const MAX_CHART_PARTS_PER_MESSAGE = 8;

function parseParts(parts: unknown): unknown[] {
  if (Array.isArray(parts)) return parts;
  if (typeof parts !== "string") return [];
  try {
    const parsed = JSON.parse(parts);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/**
 * Extract the valid `data-chart` parts from a message's `parts` payload,
 * deduped by part id and capped at {@link MAX_CHART_PARTS_PER_MESSAGE}.
 */
export function parseChartParts(parts: unknown): ChartMessagePart[] {
  const seen = new Set<string>();
  const out: ChartMessagePart[] = [];
  for (const entry of parseParts(parts)) {
    if (out.length >= MAX_CHART_PARTS_PER_MESSAGE) break;
    const part = validateChartMessagePart(entry);
    if (!part) continue;
    if (seen.has(part.id)) continue;
    seen.add(part.id);
    out.push(part);
  }
  return out;
}

/** Mirrors the renderer's `fmt`: grouped integers, ≤2 decimals. */
export function formatChartValue(n: number): string {
  if (!Number.isFinite(n)) return "—";
  const rounded =
    Math.abs(n) >= 100 ? Math.round(n) : Math.round(n * 100) / 100;
  const [int, frac] = String(rounded).split(".");
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return frac ? `${grouped}.${frac}` : grouped;
}

export interface ChartTableRow {
  label: string;
  value: string;
}

/** Rows for the card's collapsible "Chart data" table. */
export function chartTableRows(data: ChartDirectiveData): ChartTableRow[] {
  return data.series.map((point) => ({
    label: point.label,
    value: formatChartValue(point.value),
  }));
}

export interface SvgSize {
  width: number;
  height: number;
}

/**
 * Read the intrinsic size out of a rendered SVG's `viewBox`. The renderer
 * emits `viewBox="0 0 W H"` with W derived from the requested frame width, so
 * these map 1:1 to layout points on the native side.
 */
export function svgViewBoxSize(svg: string): SvgSize | null {
  const match = svg.match(/viewBox="([^"]*)"/);
  if (!match) return null;
  const nums = match[1]
    .trim()
    .split(/[\s,]+/)
    .map(Number);
  if (nums.length < 4) return null;
  const [, , width, height] = nums;
  if (!Number.isFinite(width) || !Number.isFinite(height)) return null;
  if (width <= 0 || height <= 0) return null;
  return { width, height };
}
