/**
 * Document Compositor v2 (THINK-154 U3): the house chart renderer — pure,
 * deterministic functions from directive data to static SVG, codifying the
 * hand-authored plate chart anatomy (plate-report.html + authoring-rules.md):
 *
 * - recessive hairline gridlines in var(--line) at clean-number ticks;
 * - a solid zero baseline in var(--muted); marks grow FROM the baseline;
 * - one series = one hue (var(--accent)); text wears text tokens
 *   (var(--ink)/var(--muted)), never the series color;
 * - direct labels at extremes only — the axis and the paired data table
 *   carry the rest;
 * - house palette custom properties throughout, so charts follow the plate's
 *   dark/light tokens; no script, no external references, fixed viewBox
 *   layout arithmetic, no randomness, no dates.
 *
 * SECURITY: chart data is the one channel where model-controlled text enters
 * markup the markdown sanitizer never sees (KTD4 inject-after-sanitize), so
 * EVERY model-authored string is XML-escaped through `esc` at this boundary —
 * never left to callers.
 */

import type {
  ChartDirectiveData,
  ChartSeriesPoint,
  ChartType,
} from "./document-directives.js";

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

interface Frame {
  width: number;
  height: number;
  plotLeft: number;
  plotRight: number;
  plotTop: number;
  plotBottom: number;
}

/** Chart title + one-line qualifier, inside the SVG (authoring rules). */
function header(title: string, qualifier?: string): string {
  const q = qualifier
    ? `<text x="12" y="33" font-size="10.5" fill="var(--muted)">${esc(qualifier)}</text>`
    : "";
  return `<text x="12" y="18" font-size="12" font-weight="600" fill="var(--ink)">${esc(title)}</text>${q}`;
}

/** Hairline gridlines + right-aligned y tick labels + zero baseline. */
function yAxis(
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
        `<text x="${frame.plotLeft - 6}" y="${r2(yOf(t) + 3)}">${fmt(t)}</text>`,
    )
    .join("");
  const baseline = `<line x1="${frame.plotLeft}" y1="${r2(yOf(0))}" x2="${frame.plotRight}" y2="${r2(yOf(0))}" stroke="var(--muted)" stroke-width="1"/>`;
  return `<g stroke="var(--line)" stroke-width="1">${grid}</g><g font-size="10" fill="var(--muted)" text-anchor="end">${labels}</g>${baseline}`;
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

function renderBar(data: ChartDirectiveData): string {
  const frame: Frame = {
    width: 720,
    height: 250,
    plotLeft: 48,
    plotRight: 708,
    plotTop: 56,
    plotBottom: 220,
  };
  const series = data.series;
  const ticks = niceTicks(maxOf(series));
  const top = ticks[ticks.length - 1];
  const yOf = (v: number) =>
    frame.plotBottom -
    (Math.max(0, v) / top) * (frame.plotBottom - frame.plotTop);
  const band = (frame.plotRight - frame.plotLeft) / series.length;
  const colWidth = Math.min(24, r2(band * 0.6));

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
    xLabels += `<text x="${cx}" y="${frame.plotBottom + 18}">${esc(p.label)}</text>`;
    if (p.value === maxValue && extremeLabel === "") {
      extremeLabel = `<text x="${cx}" y="${r2(yOf(p.value) - 8)}" font-size="11" font-weight="600" fill="var(--ink)" text-anchor="middle">${fmt(p.value)}</text>`;
    }
  }

  return [
    svgOpen(frame.width, frame.height, `Column chart: ${data.title}`),
    header(data.title, data.qualifier),
    yAxis(frame, ticks, yOf),
    `<g fill="var(--accent)">${columns}</g>`,
    extremeLabel,
    `<g font-size="10.5" fill="var(--muted)" text-anchor="middle">${xLabels}</g>`,
    "</svg>",
  ].join("");
}

// ---------------------------------------------------------------------------
// line — 2px single-hue line with endpoint emphasis
// ---------------------------------------------------------------------------

function renderLine(data: ChartDirectiveData): string {
  const frame: Frame = {
    width: 720,
    height: 250,
    plotLeft: 48,
    plotRight: 708,
    plotTop: 56,
    plotBottom: 220,
  };
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

  const points = series
    .map((p, i) => `${r2(xOf(i))},${r2(yOf(p.value))}`)
    .join(" ");
  const line =
    n === 1
      ? ""
      : `<polyline points="${points}" fill="none" stroke="var(--accent)" stroke-width="2"/>`;
  const last = series[n - 1];
  const endX = r2(xOf(n - 1));
  const endY = r2(yOf(last.value));
  const endpoint = `<circle cx="${endX}" cy="${endY}" r="3.5" fill="var(--accent)"/><text x="${r2(Math.min(endX, frame.plotRight - 4))}" y="${r2(endY - 10)}" font-size="11" font-weight="600" fill="var(--ink)" text-anchor="end">${fmt(last.value)}</text>`;

  // Label the ends (and thin the middle when crowded) — axis carries the rest.
  const labelEvery = n <= 8 ? 1 : Math.ceil(n / 8);
  const xLabels = series
    .map((p, i) =>
      i % labelEvery === 0 || i === n - 1
        ? `<text x="${r2(xOf(i))}" y="${frame.plotBottom + 18}">${esc(p.label)}</text>`
        : "",
    )
    .join("");

  return [
    svgOpen(frame.width, frame.height, `Line chart: ${data.title}`),
    header(data.title, data.qualifier),
    yAxis(frame, ticks, yOf),
    line,
    endpoint,
    `<g font-size="10.5" fill="var(--muted)" text-anchor="middle">${xLabels}</g>`,
    "</svg>",
  ].join("");
}

// ---------------------------------------------------------------------------
// donut — parts of a whole, fixed hue order, legend beside
// ---------------------------------------------------------------------------

const SERIES_HUES = [
  "var(--accent)",
  "var(--info)",
  "var(--warn)",
  "var(--bad)",
] as const;

function renderDonut(data: ChartDirectiveData): string {
  const width = 720;
  const height = 230;
  const cx = 130;
  const cy = 132;
  const radius = 64;
  const circumference = r2(2 * Math.PI * radius);
  const series = data.series;
  const total = series.reduce((s, p) => s + Math.max(0, p.value), 0);
  const safeTotal = total > 0 ? total : 1;

  let offset = 0;
  let segments = "";
  let legend = "";
  for (const [i, p] of series.entries()) {
    const frac = Math.max(0, p.value) / safeTotal;
    const seg = r2(frac * circumference);
    const hue = SERIES_HUES[i % SERIES_HUES.length];
    segments += `<circle cx="${cx}" cy="${cy}" r="${radius}" fill="none" stroke="${hue}" stroke-width="26" stroke-dasharray="${seg} ${r2(circumference - seg)}" stroke-dashoffset="${r2(-offset)}" transform="rotate(-90 ${cx} ${cy})"/>`;
    offset += seg;
    const ly = 70 + i * 26;
    legend += `<rect x="290" y="${ly - 10}" width="12" height="12" rx="3" fill="${hue}"/><text x="310" y="${ly}" font-size="11.5" fill="var(--ink)">${esc(p.label)}</text><text x="700" y="${ly}" font-size="11.5" font-weight="600" fill="var(--ink)" text-anchor="end">${fmt(p.value)}</text>`;
  }
  const center = `<text x="${cx}" y="${cy - 2}" font-size="22" font-weight="700" fill="var(--ink)" text-anchor="middle">${fmt(total)}</text><text x="${cx}" y="${cy + 16}" font-size="10" fill="var(--muted)" text-anchor="middle">total</text>`;

  return [
    svgOpen(width, height, `Donut chart: ${data.title}`),
    header(data.title, data.qualifier),
    segments,
    center,
    legend,
    "</svg>",
  ].join("");
}

// ---------------------------------------------------------------------------
// stat-strip — a row of stat tiles as SVG (value + label)
// ---------------------------------------------------------------------------

function renderStatStrip(data: ChartDirectiveData): string {
  const width = 720;
  const height = 96;
  const series = data.series;
  const gap = 10;
  const tileWidth = r2(
    (width - 24 - gap * (series.length - 1)) / series.length,
  );

  let tiles = "";
  for (const [i, p] of series.entries()) {
    const x = r2(12 + i * (tileWidth + gap));
    tiles += `<rect x="${x}" y="40" width="${tileWidth}" height="48" rx="10" fill="var(--card)" stroke="var(--line)"/><text x="${r2(x + 14)}" y="${64}" font-size="17" font-weight="700" fill="var(--ink)">${fmt(p.value)}</text><text x="${r2(x + 14)}" y="${80}" font-size="10" fill="var(--muted)">${esc(p.label)}</text>`;
  }

  return [
    svgOpen(width, height, `Stat strip: ${data.title}`),
    header(data.title, data.qualifier),
    tiles,
    "</svg>",
  ].join("");
}

// ---------------------------------------------------------------------------
// sparkline — compact trend, no axes, endpoint emphasis
// ---------------------------------------------------------------------------

function renderSparkline(data: ChartDirectiveData): string {
  const width = 300;
  const height = 88;
  const plotLeft = 12;
  const plotRight = 236;
  const plotTop = 44;
  const plotBottom = 76;
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
      : `<polyline points="${points}" fill="none" stroke="var(--accent)" stroke-width="2"/>`;
  const last = series[n - 1];
  const endpoint = `<circle cx="${r2(xOf(n - 1))}" cy="${r2(yOf(last.value))}" r="3" fill="var(--accent)"/><text x="${plotRight + 10}" y="${r2(yOf(last.value) + 4)}" font-size="12" font-weight="600" fill="var(--ink)">${fmt(last.value)}</text>`;

  return [
    svgOpen(width, height, `Sparkline: ${data.title}`),
    header(data.title, data.qualifier),
    line,
    endpoint,
    "</svg>",
  ].join("");
}

// ---------------------------------------------------------------------------
// meter — a single value against a maximum
// ---------------------------------------------------------------------------

function renderMeter(data: ChartDirectiveData): string {
  const width = 720;
  const height = 104;
  const trackLeft = 12;
  const trackRight = 620;
  const trackY = 62;
  const point = data.series[0];
  const max = data.max !== undefined && data.max > 0 ? data.max : 100;
  const frac = Math.min(1, Math.max(0, point.value / max));
  const fillWidth = r2((trackRight - trackLeft) * frac);

  const track = `<rect x="${trackLeft}" y="${trackY}" width="${trackRight - trackLeft}" height="14" rx="7" fill="var(--line)"/>`;
  const fill =
    fillWidth > 0
      ? `<rect x="${trackLeft}" y="${trackY}" width="${Math.max(fillWidth, 4)}" height="14" rx="7" fill="var(--accent)"/>`
      : "";
  const valueLabel = `<text x="${trackRight + 14}" y="${trackY + 12}" font-size="13" font-weight="700" fill="var(--ink)">${fmt(point.value)}<tspan font-size="10" font-weight="400" fill="var(--muted)"> / ${fmt(max)}</tspan></text>`;
  const nameLabel = `<text x="${trackLeft}" y="${trackY + 32}" font-size="10.5" fill="var(--muted)">${esc(point.label)}</text>`;

  return [
    svgOpen(width, height, `Meter: ${data.title}`),
    header(data.title, data.qualifier),
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

function renderFunnel(data: ChartDirectiveData): string {
  const width = 720;
  const rowHeight = 40;
  const series = data.series;
  const height = 52 + series.length * rowHeight + 8;
  const labelRight = 150;
  const barLeft = 162;
  const barMaxWidth = 440;
  const first = Math.max(0, series[0]?.value ?? 0);
  const max = maxOf(series);
  const top = max <= 0 ? 1 : max;

  let rows = "";
  for (const [i, p] of series.entries()) {
    const y = 52 + i * rowHeight;
    const barWidth = Math.max(
      r2((Math.max(0, p.value) / top) * barMaxWidth),
      3,
    );
    const pct =
      first > 0 && i > 0
        ? `<tspan font-size="10" font-weight="400" fill="var(--muted)"> · ${Math.round((Math.max(0, p.value) / first) * 100)}%</tspan>`
        : "";
    rows += `<text x="${labelRight}" y="${y + 20}" font-size="11" fill="var(--muted)" text-anchor="end">${esc(p.label)}</text><rect x="${barLeft}" y="${y + 6}" width="${barWidth}" height="24" rx="5" fill="var(--accent)"/><text x="${r2(barLeft + barWidth + 10)}" y="${y + 23}" font-size="12" font-weight="600" fill="var(--ink)">${fmt(p.value)}${pct}</text>`;
  }

  return [
    svgOpen(width, height, `Funnel chart: ${data.title}`),
    header(data.title, data.qualifier),
    rows,
    "</svg>",
  ].join("");
}

// ---------------------------------------------------------------------------
// Dispatch
// ---------------------------------------------------------------------------

const RENDERERS: Record<ChartType, (data: ChartDirectiveData) => string> = {
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
 * house palette tokens. Data shape is validated upstream by the directive
 * engine; this function only assumes a non-empty series of finite numbers.
 */
export function renderChart(data: ChartDirectiveData): string {
  return RENDERERS[data.type](data);
}
