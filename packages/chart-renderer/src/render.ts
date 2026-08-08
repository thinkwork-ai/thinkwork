/**
 * Document Compositor v2 (THINK-154 U3): the house chart renderer — pure,
 * deterministic functions from directive data to static SVG, codifying the
 * hand-authored plate chart anatomy (plate-report.html + authoring-rules.md):
 *
 * - recessive hairline gridlines in the `line` token at clean-number ticks;
 * - a solid zero baseline in the `muted` token; marks grow FROM the baseline;
 * - one series = one hue (the `accent` token); text wears text tokens
 *   (`ink`/`muted`), never the series color;
 * - direct labels at extremes only — the axis and the paired data table
 *   carry the rest;
 * - house palette throughout, so charts follow the surrounding surface's
 *   dark/light tokens; no script, no external references, fixed viewBox
 *   layout arithmetic, no randomness, no dates.
 *
 * THINK-673/674: extracted from `packages/api` into this shared package and
 * parameterized by frame width, font scale, and a resolved palette so native
 * clients can render the same charts. With options omitted the output is
 * byte-identical to the pre-extraction server renderer (golden-asserted).
 *
 * SECURITY: chart data is the one channel where model-controlled text enters
 * markup the markdown sanitizer never sees (KTD4 inject-after-sanitize), so
 * EVERY model-authored string is XML-escaped through `esc` at this boundary —
 * never left to callers. Palette values are developer-supplied constants, but
 * they are escaped at interpolation too (defense in depth).
 */

import { CSS_VAR_PALETTE, type ChartPalette } from "./palette.js";
import type {
  ChartDirectiveData,
  ChartSeriesPoint,
  ChartType,
} from "./types.js";

/** XML-escape for text nodes AND attribute values (single shared helper). */
function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Fixed-precision coordinate — kills float noise, keeps output stable. */
function r2(n: number): number {
  return Math.round(n * 100) / 100;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

/** Human number for direct labels: grouped integers, ≤2 decimals. */
function fmt(n: number): string {
  const rounded = Math.abs(n) >= 100 ? Math.round(n) : r2(n);
  const [int, frac] = String(rounded).split(".");
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return frac ? `${grouped}.${frac}` : grouped;
}

/** Clean-number axis ticks (0/10/20/30, never 0/13/26). */
function niceTicks(maxValue: number): number[] {
  const max = maxValue <= 0 ? 1 : maxValue;
  const rawStep = max / 4;
  const pow = Math.pow(10, Math.floor(Math.log10(rawStep)));
  const step =
    [1, 2, 2.5, 5, 10].map((m) => m * pow).find((s) => max / s <= 5) ??
    10 * pow;
  const ticks: number[] = [];
  for (let t = 0; t <= max + step * 0.0001; t += step) ticks.push(r2(t));
  if (ticks[ticks.length - 1] < max) ticks.push(r2(ticks.length * step));
  return ticks;
}

// ---------------------------------------------------------------------------
// Options → resolved layout context
// ---------------------------------------------------------------------------

export interface ChartRenderOptions {
  /** Frame width in SVG units. Default 720 (the document/plate frame). */
  width?: number;
  /** Multiplies every font-size (Dynamic Type). Default 1. */
  fontScale?: number;
  /** Resolved colors. Default CSS_VAR_PALETTE. */
  palette?: ChartPalette;
  /**
   * Draw the in-SVG title/qualifier header. Default true (the document/plate
   * anatomy). Card surfaces that render their own header pass false — the
   * frame compacts upward so the mark doesn't float under empty space.
   */
  header?: boolean;
}

/** Default frame width — the document/plate content column. */
const DEFAULT_WIDTH = 720;

interface Ctx {
  width: number;
  /** Font size after Dynamic Type scaling. */
  fs: (base: number) => number;
  /** Vertical offset that must track the font (x-label baselines, headers). */
  off: (base: number) => number;
  p: ChartPalette;
  /** Escaped palette accessor — palette values are attribute-interpolated. */
  c: ChartPalette;
  /** In-SVG header on/off; headerless frames compact upward. */
  hdr: boolean;
}

function resolveCtx(options?: ChartRenderOptions): Ctx {
  const width = Math.max(160, options?.width ?? DEFAULT_WIDTH);
  const fontScale = options?.fontScale ?? 1;
  const p = options?.palette ?? CSS_VAR_PALETTE;
  const c: ChartPalette = {
    ink: esc(p.ink),
    muted: esc(p.muted),
    accent: esc(p.accent),
    line: esc(p.line),
    card: esc(p.card),
    info: esc(p.info),
    warn: esc(p.warn),
    bad: esc(p.bad),
  };
  return {
    width,
    fs: (base) => r2(base * fontScale),
    off: (base) => r2(base * fontScale),
    p,
    c,
    hdr: options?.header !== false,
  };
}

function hues(ctx: Ctx): readonly string[] {
  return [ctx.c.accent, ctx.c.info, ctx.c.warn, ctx.c.bad];
}

interface Frame {
  width: number;
  height: number;
  plotLeft: number;
  plotRight: number;
  plotTop: number;
  plotBottom: number;
}

/** bar/line share one frame: gutter scales with width, plot height is fixed. */
function axisFrame(ctx: Ctx): Frame {
  const dy = ctx.hdr ? 0 : 40;
  return {
    width: ctx.width,
    height: 250 - dy,
    plotLeft: Math.max(40, r2((48 * ctx.width) / DEFAULT_WIDTH)),
    plotRight: r2(ctx.width - 12),
    plotTop: 56 - dy,
    plotBottom: 220 - dy,
  };
}

/** Chart title + one-line qualifier, inside the SVG (authoring rules). */
function header(ctx: Ctx, title: string, qualifier?: string): string {
  if (!ctx.hdr) return "";
  const y1 = r2(Math.min(ctx.off(18), 26));
  const y2 = r2(Math.min(ctx.off(33), 44));
  const q = qualifier
    ? `<text x="12" y="${y2}" font-size="${ctx.fs(10.5)}" fill="${ctx.c.muted}">${esc(qualifier)}</text>`
    : "";
  return `<text x="12" y="${y1}" font-size="${ctx.fs(12)}" font-weight="600" fill="${ctx.c.ink}">${esc(title)}</text>${q}`;
}

/** Hairline gridlines + right-aligned y tick labels + zero baseline. */
function yAxis(
  ctx: Ctx,
  frame: Frame,
  ticks: number[],
  yOf: (v: number) => number,
): string {
  const grid = ticks
    .filter((t) => t !== 0)
    .map(
      (t) =>
        `<line x1="${frame.plotLeft}" y1="${r2(yOf(t))}" x2="${frame.plotRight}" y2="${r2(yOf(t))}"/>`,
    )
    .join("");
  const labels = ticks
    .map(
      (t) =>
        `<text x="${r2(frame.plotLeft - 6)}" y="${r2(yOf(t) + 3)}">${fmt(t)}</text>`,
    )
    .join("");
  const baseline = `<line x1="${frame.plotLeft}" y1="${r2(yOf(0))}" x2="${frame.plotRight}" y2="${r2(yOf(0))}" stroke="${ctx.c.muted}" stroke-width="1"/>`;
  return `<g stroke="${ctx.c.line}" stroke-width="1">${grid}</g><g font-size="${ctx.fs(10)}" fill="${ctx.c.muted}" text-anchor="end">${labels}</g>${baseline}`;
}

function svgOpen(width: number, height: number, label: string): string {
  return `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="${esc(label)}">`;
}

function maxOf(series: ChartSeriesPoint[]): number {
  return series.reduce((m, p) => Math.max(m, p.value), 0);
}

// ---------------------------------------------------------------------------
// bar — vertical columns (the plate exemplar)
// ---------------------------------------------------------------------------

function renderBar(data: ChartDirectiveData, ctx: Ctx): string {
  const frame = axisFrame(ctx);
  const series = data.series;
  const ticks = niceTicks(maxOf(series));
  const top = ticks[ticks.length - 1];
  const yOf = (v: number) =>
    frame.plotBottom -
    (Math.max(0, v) / top) * (frame.plotBottom - frame.plotTop);
  const band = (frame.plotRight - frame.plotLeft) / series.length;
  const colWidth = Math.min(24, r2(band * 0.6));
  const labelBaseline = r2(frame.plotBottom + ctx.off(18));

  const maxValue = maxOf(series);
  let columns = "";
  let xLabels = "";
  let extremeLabel = "";
  for (const [i, p] of series.entries()) {
    const cx = r2(frame.plotLeft + band * (i + 0.5));
    const x0 = r2(cx - colWidth / 2);
    const h = r2(frame.plotBottom - yOf(p.value));
    if (h <= 4) {
      columns += `<rect x="${x0}" y="${r2(frame.plotBottom - Math.max(h, 1))}" width="${colWidth}" height="${Math.max(h, 1)}"/>`;
    } else {
      // Square baseline, 4px rounded data-end (plate anatomy).
      columns += `<path d="M${x0},${frame.plotBottom} v-${r2(h - 4)} q0,-4 4,-4 h${r2(colWidth - 8)} q4,0 4,4 v${r2(h - 4)} z"/>`;
    }
    xLabels += `<text x="${cx}" y="${labelBaseline}">${esc(p.label)}</text>`;
    if (p.value === maxValue && extremeLabel === "") {
      extremeLabel = `<text x="${cx}" y="${r2(yOf(p.value) - 8)}" font-size="${ctx.fs(11)}" font-weight="600" fill="${ctx.c.ink}" text-anchor="middle">${fmt(p.value)}</text>`;
    }
  }

  return [
    svgOpen(frame.width, frame.height, `Column chart: ${data.title}`),
    header(ctx, data.title, data.qualifier),
    yAxis(ctx, frame, ticks, yOf),
    `<g fill="${ctx.c.accent}">${columns}</g>`,
    extremeLabel,
    `<g font-size="${ctx.fs(10.5)}" fill="${ctx.c.muted}" text-anchor="middle">${xLabels}</g>`,
    "</svg>",
  ].join("");
}

// ---------------------------------------------------------------------------
// line — 2px single-hue line with endpoint emphasis
// ---------------------------------------------------------------------------

function renderLine(data: ChartDirectiveData, ctx: Ctx): string {
  const frame = axisFrame(ctx);
  const series = data.series;
  const ticks = niceTicks(maxOf(series));
  const top = ticks[ticks.length - 1];
  const yOf = (v: number) =>
    frame.plotBottom -
    (Math.max(0, v) / top) * (frame.plotBottom - frame.plotTop);
  const n = series.length;
  const xOf = (i: number) =>
    n === 1
      ? (frame.plotLeft + frame.plotRight) / 2
      : frame.plotLeft + ((frame.plotRight - frame.plotLeft) * i) / (n - 1);
  const labelBaseline = r2(frame.plotBottom + ctx.off(18));

  const points = series
    .map((p, i) => `${r2(xOf(i))},${r2(yOf(p.value))}`)
    .join(" ");
  const line =
    n === 1
      ? ""
      : `<polyline points="${points}" fill="none" stroke="${ctx.c.accent}" stroke-width="2"/>`;
  const last = series[n - 1];
  const endX = r2(xOf(n - 1));
  const endY = r2(yOf(last.value));
  const endpoint = `<circle cx="${endX}" cy="${endY}" r="3.5" fill="${ctx.c.accent}"/><text x="${r2(Math.min(endX, frame.plotRight - 4))}" y="${r2(endY - 10)}" font-size="${ctx.fs(11)}" font-weight="600" fill="${ctx.c.ink}" text-anchor="end">${fmt(last.value)}</text>`;

  // Label the ends (and thin the middle when crowded) — axis carries the rest.
  const labelEvery = n <= 8 ? 1 : Math.ceil(n / 8);
  const xLabels = series
    .map((p, i) =>
      i % labelEvery === 0 || i === n - 1
        ? `<text x="${r2(xOf(i))}" y="${labelBaseline}">${esc(p.label)}</text>`
        : "",
    )
    .join("");

  return [
    svgOpen(frame.width, frame.height, `Line chart: ${data.title}`),
    header(ctx, data.title, data.qualifier),
    yAxis(ctx, frame, ticks, yOf),
    line,
    endpoint,
    `<g font-size="${ctx.fs(10.5)}" fill="${ctx.c.muted}" text-anchor="middle">${xLabels}</g>`,
    "</svg>",
  ].join("");
}

// ---------------------------------------------------------------------------
// donut — parts of a whole, fixed hue order, legend beside (or below when the
// frame is too narrow for a side legend)
// ---------------------------------------------------------------------------

/** Below this frame width the donut legend stacks under the ring. */
const DONUT_SIDE_LEGEND_MIN_WIDTH = 520;

function renderDonut(data: ChartDirectiveData, ctx: Ctx): string {
  const width = ctx.width;
  const dy = ctx.hdr ? 0 : 40;
  const wide = width >= DONUT_SIDE_LEGEND_MIN_WIDTH;
  const cx = wide ? 130 : r2(width / 2);
  const cy = 132 - dy;
  const radius = 64;
  const circumference = r2(2 * Math.PI * radius);
  const series = data.series;
  const height = wide ? 230 - dy : r2(210 - dy + series.length * 26 + 12);
  const total = series.reduce((s, p) => s + Math.max(0, p.value), 0);
  const safeTotal = total > 0 ? total : 1;
  const legendX = wide ? 290 : 16;
  const legendTextX = r2(legendX + 20);
  const legendValueX = r2(width - (wide ? 20 : 16));
  const legendTop = (wide ? 70 : 210) - dy;
  const palette = hues(ctx);

  let offset = 0;
  let segments = "";
  let legend = "";
  for (const [i, p] of series.entries()) {
    const frac = Math.max(0, p.value) / safeTotal;
    const seg = r2(frac * circumference);
    const hue = palette[i % palette.length];
    segments += `<circle cx="${cx}" cy="${cy}" r="${radius}" fill="none" stroke="${hue}" stroke-width="26" stroke-dasharray="${seg} ${r2(circumference - seg)}" stroke-dashoffset="${r2(-offset)}" transform="rotate(-90 ${cx} ${cy})"/>`;
    offset += seg;
    const ly = legendTop + i * 26;
    legend += `<rect x="${legendX}" y="${ly - 10}" width="12" height="12" rx="3" fill="${hue}"/><text x="${legendTextX}" y="${ly}" font-size="${ctx.fs(11.5)}" fill="${ctx.c.ink}">${esc(p.label)}</text><text x="${legendValueX}" y="${ly}" font-size="${ctx.fs(11.5)}" font-weight="600" fill="${ctx.c.ink}" text-anchor="end">${fmt(p.value)}</text>`;
  }
  const center = `<text x="${cx}" y="${cy - 2}" font-size="${ctx.fs(22)}" font-weight="700" fill="${ctx.c.ink}" text-anchor="middle">${fmt(total)}</text><text x="${cx}" y="${cy + 16}" font-size="${ctx.fs(10)}" fill="${ctx.c.muted}" text-anchor="middle">total</text>`;

  return [
    svgOpen(width, height, `Donut chart: ${data.title}`),
    header(ctx, data.title, data.qualifier),
    segments,
    center,
    legend,
    "</svg>",
  ].join("");
}

// ---------------------------------------------------------------------------
// stat-strip — a row of stat tiles as SVG (value + label)
// ---------------------------------------------------------------------------

/** Below this frame width more than four tiles wrap to a second row. */
const STAT_WRAP_MAX_WIDTH = 520;

/**
 * Greedy two-line word wrap on a deterministic character budget (SVG has no
 * text measurement; ~5.6 units/char at font-size 10 is the house estimate).
 * Overflow past two lines ellipsizes; a single over-budget word hard-slices.
 */
function wrapLabel(label: string, budget: number): string[] {
  if (label.length <= budget) return [label];
  const words = label.split(/\s+/);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const candidate = current === "" ? word : `${current} ${word}`;
    if (candidate.length <= budget || current === "") {
      current = candidate;
    } else {
      lines.push(current);
      current = word;
    }
    if (lines.length === 2) break;
  }
  if (lines.length < 2 && current !== "") lines.push(current);
  const clipped = lines.slice(0, 2);
  const last = clipped[clipped.length - 1];
  const overflowed = clipped.join(" ").length < label.length;
  if (last.length > budget || overflowed) {
    clipped[clipped.length - 1] =
      `${last.slice(0, Math.max(1, budget - 1)).trimEnd()}…`;
  }
  return clipped;
}

function renderStatStrip(data: ChartDirectiveData, ctx: Ctx): string {
  const width = ctx.width;
  const series = data.series;
  const gap = 10;
  const base = ctx.hdr ? 40 : 8;
  const wrapped = series.length > 4 && width < STAT_WRAP_MAX_WIDTH;
  const perRow = wrapped ? Math.ceil(series.length / 2) : series.length;
  const tileWidth = r2((width - 24 - gap * (perRow - 1)) / perRow);

  // Wrap long metric labels to a second line instead of overflowing the tile
  // (per design review); every tile in the strip shares one height.
  const budget = Math.max(
    4,
    Math.floor((tileWidth - 28) / (5.6 * (ctx.fs(10) / 10))),
  );
  const labelLines = series.map((p) => wrapLabel(p.label, budget));
  const anyWrapped = labelLines.some((lines) => lines.length > 1);
  const tileHeight = anyWrapped ? 62 : 48;
  const rowCount = wrapped ? 2 : 1;
  const rowHeight = tileHeight + 10;
  const height = base + rowCount * rowHeight - 10 + 8;

  let tiles = "";
  for (const [i, p] of series.entries()) {
    const col = i % perRow;
    const row = Math.floor(i / perRow);
    const x = r2(12 + col * (tileWidth + gap));
    const y = base + row * rowHeight;
    const label = labelLines[i]
      .map(
        (line, li) =>
          `<text x="${r2(x + 14)}" y="${y + 40 + li * 12}" font-size="${ctx.fs(10)}" fill="${ctx.c.muted}">${esc(line)}</text>`,
      )
      .join("");
    tiles += `<rect x="${x}" y="${y}" width="${tileWidth}" height="${tileHeight}" rx="10" fill="${ctx.c.card}" stroke="${ctx.c.line}"/><text x="${r2(x + 14)}" y="${y + 24}" font-size="${ctx.fs(17)}" font-weight="700" fill="${ctx.c.ink}">${fmt(p.value)}</text>${label}`;
  }

  return [
    svgOpen(width, height, `Stat strip: ${data.title}`),
    header(ctx, data.title, data.qualifier),
    tiles,
    "</svg>",
  ].join("");
}

// ---------------------------------------------------------------------------
// sparkline — compact trend, no axes, endpoint emphasis
// ---------------------------------------------------------------------------

/** The sparkline never grows past its compact frame. */
const SPARKLINE_MAX_WIDTH = 300;

function renderSparkline(data: ChartDirectiveData, ctx: Ctx): string {
  const dy = ctx.hdr ? 0 : 32;
  const width = Math.min(ctx.width, SPARKLINE_MAX_WIDTH);
  const height = 88 - dy;
  const plotLeft = 12;
  const plotRight = r2(width - 64);
  const plotTop = 44 - dy;
  const plotBottom = 76 - dy;
  const series = data.series;
  const max = maxOf(series);
  const top = max <= 0 ? 1 : max;
  const n = series.length;
  const xOf = (i: number) =>
    n === 1
      ? (plotLeft + plotRight) / 2
      : plotLeft + ((plotRight - plotLeft) * i) / (n - 1);
  const yOf = (v: number) =>
    plotBottom - (Math.max(0, v) / top) * (plotBottom - plotTop);

  const points = series
    .map((p, i) => `${r2(xOf(i))},${r2(yOf(p.value))}`)
    .join(" ");
  const line =
    n === 1
      ? ""
      : `<polyline points="${points}" fill="none" stroke="${ctx.c.accent}" stroke-width="2"/>`;
  const last = series[n - 1];
  const endpoint = `<circle cx="${r2(xOf(n - 1))}" cy="${r2(yOf(last.value))}" r="3" fill="${ctx.c.accent}"/><text x="${r2(plotRight + 10)}" y="${r2(yOf(last.value) + 4)}" font-size="${ctx.fs(12)}" font-weight="600" fill="${ctx.c.ink}">${fmt(last.value)}</text>`;

  return [
    svgOpen(width, height, `Sparkline: ${data.title}`),
    header(ctx, data.title, data.qualifier),
    line,
    endpoint,
    "</svg>",
  ].join("");
}

// ---------------------------------------------------------------------------
// meter — a single value against a maximum
// ---------------------------------------------------------------------------

function renderMeter(data: ChartDirectiveData, ctx: Ctx): string {
  const width = ctx.width;
  const height = 104;
  const trackLeft = 12;
  const trackRight = r2(width - 100);
  const trackY = 62;
  const point = data.series[0];
  const max = data.max !== undefined && data.max > 0 ? data.max : 100;
  const frac = Math.min(1, Math.max(0, point.value / max));
  const fillWidth = r2((trackRight - trackLeft) * frac);

  const track = `<rect x="${trackLeft}" y="${trackY}" width="${r2(trackRight - trackLeft)}" height="14" rx="7" fill="${ctx.c.line}"/>`;
  const fill =
    fillWidth > 0
      ? `<rect x="${trackLeft}" y="${trackY}" width="${Math.max(fillWidth, 4)}" height="14" rx="7" fill="${ctx.c.accent}"/>`
      : "";
  const valueLabel = `<text x="${r2(trackRight + 14)}" y="${trackY + 12}" font-size="${ctx.fs(13)}" font-weight="700" fill="${ctx.c.ink}">${fmt(point.value)}<tspan font-size="${ctx.fs(10)}" font-weight="400" fill="${ctx.c.muted}"> / ${fmt(max)}</tspan></text>`;
  const nameLabel = `<text x="${trackLeft}" y="${trackY + 32}" font-size="${ctx.fs(10.5)}" fill="${ctx.c.muted}">${esc(point.label)}</text>`;

  return [
    svgOpen(width, height, `Meter: ${data.title}`),
    header(ctx, data.title, data.qualifier),
    track,
    fill,
    valueLabel,
    nameLabel,
    "</svg>",
  ].join("");
}

// ---------------------------------------------------------------------------
// funnel — stages with conversion against the first stage (CRM reports)
// ---------------------------------------------------------------------------

function renderFunnel(data: ChartDirectiveData, ctx: Ctx): string {
  const width = ctx.width;
  const segmentHeight = 56;
  const gap = 4;
  const series = data.series;
  const height = 52 + series.length * (segmentHeight + gap) + 8;
  // Label gutter left, value gutter right, funnel gets the rest. The right
  // gutter's 11/60 ratio reproduces the historical 132px gutter (and hence a
  // 420px funnel) exactly at the 720px document frame.
  const labelRight = clamp(r2(width * 0.21), 80, 150);
  const funnelLeft = r2(labelRight + 18);
  const valueGutter = clamp(r2((width * 11) / 60), 72, 132);
  const funnelMaxWidth = Math.max(80, r2(width - funnelLeft - valueGutter));
  const center = r2(funnelLeft + funnelMaxWidth / 2);
  const first = Math.max(0, series[0]?.value ?? 0);
  const max = maxOf(series);
  const top = max <= 0 ? 1 : max;
  const palette = hues(ctx);

  // True funnel: each stage is a centered TRAPEZOID — its top edge scales
  // with this stage's value, its bottom edge with the NEXT stage's value, so
  // the taper is continuous. The final stage narrows to 60% of its own top.
  // Segments cycle the fixed hue order; stage names sit left of each
  // segment's middle, value + conversion right of its top edge — direct
  // labels, no legend (authoring rules).
  const halfOf = (v: number) =>
    Math.max(r2(((Math.max(0, v) / top) * funnelMaxWidth) / 2), 12);
  let segments = "";
  for (const [i, p] of series.entries()) {
    const yTop = 52 + i * (segmentHeight + gap);
    const yBottom = yTop + segmentHeight;
    const topHalf = halfOf(p.value);
    const next = series[i + 1];
    const bottomHalf =
      next !== undefined ? halfOf(next.value) : Math.max(r2(topHalf * 0.6), 12);
    const hue = palette[i % palette.length];
    const points = [
      `${r2(center - topHalf)},${yTop}`,
      `${r2(center + topHalf)},${yTop}`,
      `${r2(center + bottomHalf)},${yBottom}`,
      `${r2(center - bottomHalf)},${yBottom}`,
    ].join(" ");
    const pct =
      first > 0 && i > 0
        ? `<tspan font-size="${ctx.fs(10)}" font-weight="400" fill="${ctx.c.muted}"> · ${Math.round((Math.max(0, p.value) / first) * 100)}%</tspan>`
        : "";
    segments +=
      `<polygon points="${points}" fill="${hue}"/>` +
      `<text x="${labelRight}" y="${r2(yTop + segmentHeight / 2 + 4)}" font-size="${ctx.fs(11)}" fill="${ctx.c.muted}" text-anchor="end">${esc(p.label)}</text>` +
      `<text x="${r2(center + topHalf + 12)}" y="${yTop + 14}" font-size="${ctx.fs(12)}" font-weight="600" fill="${ctx.c.ink}">${fmt(p.value)}${pct}</text>`;
  }

  return [
    svgOpen(width, height, `Funnel chart: ${data.title}`),
    header(ctx, data.title, data.qualifier),
    segments,
    "</svg>",
  ].join("");
}

// ---------------------------------------------------------------------------
// Dispatch
// ---------------------------------------------------------------------------

const RENDERERS: Record<
  ChartType,
  (data: ChartDirectiveData, ctx: Ctx) => string
> = {
  bar: renderBar,
  line: renderLine,
  donut: renderDonut,
  "stat-strip": renderStatStrip,
  sparkline: renderSparkline,
  meter: renderMeter,
  funnel: renderFunnel,
};

/**
 * Render one chart directive to a static, self-contained, scriptless SVG in
 * house palette colors. Data shape is validated upstream by the directive
 * engine; this function only assumes a non-empty series of finite numbers.
 *
 * With `options` omitted the output is byte-identical to the historical
 * server renderer (720px frame, unscaled type, CSS custom properties).
 */
export function renderChart(
  data: ChartDirectiveData,
  options?: ChartRenderOptions,
): string {
  return RENDERERS[data.type](data, resolveCtx(options));
}
