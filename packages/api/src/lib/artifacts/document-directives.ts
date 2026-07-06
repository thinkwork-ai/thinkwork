/**
 * Document Compositor v2 (THINK-154 U2): the `tw:` directive engine — a typed,
 * closed component vocabulary for fenced blocks in document markdown (R2).
 *
 * Each registry entry declares its YAML schema (parsed with the strict
 * posture), per-genre availability, a corrected minimal example (KTD7: every
 * rejection must let the model self-repair in one turn), and a render
 * function returning plate-class HTML. SVG-bearing components (charts) are
 * flagged `containsSvg` so the compositor routes them through the KTD4
 * placeholder path — they never pass through the sanitizer; everything else
 * must be sanitizer-allowlist-compatible.
 *
 * Unknown directives are a HARD compile rejection (they represent content the
 * document would silently lose), always naming the supported vocabulary and
 * an example.
 */

import { parse as parseYaml } from "yaml";
import { renderChart } from "./document-charts.js";
import type {
  CompositorDiagnostic,
  DirectiveEngine,
  DirectiveRender,
} from "./document-compositor.js";

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

interface DirectiveSpec {
  kind: string;
  /** Genres the component is available in; "all" for no restriction. */
  genres: readonly string[] | "all";
  /** One-line schema summary used in rejection diagnostics. */
  schema: string;
  /** Corrected minimal example (KTD7 self-repair posture). */
  example: string;
  render: (input: { data: unknown; genre: string }) => DirectiveRender;
}

const PILL_TONES = ["acc", "info", "warn", "bad"] as const;
type PillTone = (typeof PILL_TONES)[number];

function toneClass(raw: unknown): PillTone {
  return (PILL_TONES as readonly string[]).includes(raw as string)
    ? (raw as PillTone)
    : "acc";
}

function reject(
  kind: string,
  message: string,
  spec?: DirectiveSpec,
): DirectiveRender {
  const suffix = spec
    ? ` Expected schema: ${spec.schema}. Corrected minimal example:\n\`\`\`tw:${spec.kind}\n${spec.example}\n\`\`\``
    : "";
  return {
    ok: false,
    diagnostics: [
      {
        code: "DIRECTIVE_INVALID",
        message: `${message}${suffix}`,
        location: `tw:${kind}`,
      },
    ],
  };
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return v !== null && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null;
}

function textOf(v: unknown): string | null {
  if (typeof v === "string") return v;
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return null;
}

// ---------------------------------------------------------------------------
// tw:stats — the plate stat strip (big number + small label tiles)
// ---------------------------------------------------------------------------

const statsSpec: DirectiveSpec = {
  kind: "stats",
  genres: "all",
  schema: "items: list of { value: string|number, label: string } (1–8 items)",
  example: `items:
  - { value: 42, label: opportunities }
  - { value: "+18%", label: change vs prior }`,
  render: ({ data }) => {
    const root = asRecord(data);
    const items = root?.items;
    if (!Array.isArray(items) || items.length === 0 || items.length > 8) {
      return reject(
        "stats",
        "tw:stats needs an `items` list with 1–8 entries.",
        statsSpec,
      );
    }
    const tiles: string[] = [];
    for (const [i, item] of items.entries()) {
      const rec = asRecord(item);
      const value = textOf(rec?.value);
      const label = textOf(rec?.label);
      if (value === null || label === null) {
        return reject(
          "stats",
          `items[${i}] must have a \`value\` and a \`label\` (both strings or numbers).`,
          statsSpec,
        );
      }
      tiles.push(
        `<div class="stat"><div class="n">${escapeHtml(value)}</div><div class="l">${escapeHtml(label)}</div></div>`,
      );
    }
    return {
      ok: true,
      html: `<div class="stats">${tiles.join("")}</div>`,
      containsSvg: false,
    };
  },
};

// ---------------------------------------------------------------------------
// tw:verdict-grid — the plate card grid (eyebrow question, bold answer, note)
// ---------------------------------------------------------------------------

const verdictGridSpec: DirectiveSpec = {
  kind: "verdict-grid",
  genres: "all",
  schema:
    "cards: list of { question: string, answer: string, note?: string, tone?: acc|info|warn|bad } (1–8 cards)",
  example: `cards:
  - { question: Ship it?, answer: Yes, note: All gates green, tone: acc }
  - { question: Risk, answer: Low, tone: info }`,
  render: ({ data }) => {
    const root = asRecord(data);
    const cards = root?.cards;
    if (!Array.isArray(cards) || cards.length === 0 || cards.length > 8) {
      return reject(
        "verdict-grid",
        "tw:verdict-grid needs a `cards` list with 1–8 entries.",
        verdictGridSpec,
      );
    }
    const rendered: string[] = [];
    for (const [i, card] of cards.entries()) {
      const rec = asRecord(card);
      const question = textOf(rec?.question);
      const answer = textOf(rec?.answer);
      if (question === null || answer === null) {
        return reject(
          "verdict-grid",
          `cards[${i}] must have a \`question\` and an \`answer\`.`,
          verdictGridSpec,
        );
      }
      const note = textOf(rec?.note);
      const tone = toneClass(rec?.tone);
      rendered.push(
        `<div class="card"><div class="q">${escapeHtml(question)}</div><div class="a"><span class="pill ${tone}">${escapeHtml(answer)}</span></div>${note ? `<p>${escapeHtml(note)}</p>` : ""}</div>`,
      );
    }
    return {
      ok: true,
      html: `<div class="cards">${rendered.join("")}</div>`,
      containsSvg: false,
    };
  },
};

// ---------------------------------------------------------------------------
// tw:chart — declarative data drawn by the house SVG chart renderer (U3).
// The shell validates shape here; rendering is injected to keep the registry
// testable and let U3 land as its own unit.
// ---------------------------------------------------------------------------

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

/** Seam kept injectable for tests; production wires the house renderer. */
export type ChartRenderer = (data: ChartDirectiveData) => string;

const CHART_SCHEMA = {
  kind: "chart",
  genres: "all" as const,
  schema: `type: ${CHART_TYPES.join("|")}; title: string; qualifier?: string; caption?: string; max?: number (meter); series: list of { label: string, value: number } (1–24 points)`,
  example: `type: funnel
title: Pipeline by stage
series:
  - { label: Leads, value: 120 }
  - { label: Qualified, value: 64 }
caption: Qualification is the biggest drop-off.`,
};

export const makeChartSpec = (
  chartRenderer: ChartRenderer | null,
): DirectiveSpec => ({
  ...CHART_SCHEMA,
  render: ({ data }) => {
    const root = asRecord(data);
    if (!root) {
      return reject(
        "chart",
        "tw:chart body must be a YAML mapping.",
        CHART_SCHEMA as DirectiveSpec,
      );
    }
    const type = root.type;
    if (!(CHART_TYPES as readonly string[]).includes(type as string)) {
      return reject(
        "chart",
        `Unknown chart type ${JSON.stringify(type)}. Supported types: ${CHART_TYPES.join(", ")}.`,
        CHART_SCHEMA as DirectiveSpec,
      );
    }
    const title = textOf(root.title);
    if (title === null || title.trim() === "") {
      return reject(
        "chart",
        "tw:chart needs a `title`.",
        CHART_SCHEMA as DirectiveSpec,
      );
    }
    const rawSeries = root.series;
    if (
      !Array.isArray(rawSeries) ||
      rawSeries.length === 0 ||
      rawSeries.length > 24
    ) {
      return reject(
        "chart",
        "tw:chart needs a `series` list with 1–24 points.",
        CHART_SCHEMA as DirectiveSpec,
      );
    }
    const series: ChartSeriesPoint[] = [];
    for (const [i, point] of rawSeries.entries()) {
      const rec = asRecord(point);
      const label = textOf(rec?.label);
      const value = rec?.value;
      if (
        label === null ||
        typeof value !== "number" ||
        !Number.isFinite(value)
      ) {
        return reject(
          "chart",
          `series[${i}] must be { label: string, value: finite number }.`,
          CHART_SCHEMA as DirectiveSpec,
        );
      }
      series.push({ label, value });
    }
    const max = root.max;
    if (
      max !== undefined &&
      (typeof max !== "number" || !Number.isFinite(max))
    ) {
      return reject(
        "chart",
        "`max` must be a finite number.",
        CHART_SCHEMA as DirectiveSpec,
      );
    }
    if (!chartRenderer) {
      return reject(
        "chart",
        "Chart rendering is not available on this release yet — express the data as a markdown table instead.",
      );
    }
    const chartData: ChartDirectiveData = {
      type: type as ChartType,
      title: title.trim(),
      qualifier: textOf(root.qualifier) ?? undefined,
      series,
      caption: textOf(root.caption) ?? undefined,
      max: max as number | undefined,
    };
    const svg = chartRenderer(chartData);
    // Per authoring-rules.md: every chart pairs with a <details> data table —
    // the static medium's drill-down and accessibility fallback.
    const rows = series
      .map(
        (p) =>
          `<tr><td>${escapeHtml(p.label)}</td><td>${escapeHtml(String(p.value))}</td></tr>`,
      )
      .join("");
    const caption = chartData.caption
      ? `<figcaption>${escapeHtml(chartData.caption)}</figcaption>`
      : "";
    const html = `<figure>${svg}${caption}</figure><details><summary>Chart data</summary><table><tr><th>${escapeHtml("Label")}</th><th>${escapeHtml(chartData.title)}</th></tr>${rows}</table></details>`;
    return { ok: true, html, containsSvg: true };
  },
});

// ---------------------------------------------------------------------------
// Registry + engine
// ---------------------------------------------------------------------------

const DEFAULT_REGISTRY: readonly DirectiveSpec[] = [
  statsSpec,
  verdictGridSpec,
  makeChartSpec(renderChart),
];

/** Canonical directive kinds — the plate registry's availability vocabulary. */
export const DIRECTIVE_KINDS: readonly string[] = DEFAULT_REGISTRY.map(
  (s) => s.kind,
);

export function buildDirectiveEngine(
  registry: readonly DirectiveSpec[] = DEFAULT_REGISTRY,
): DirectiveEngine {
  return ({ kind, body, genre }) => {
    const vocabulary = registry
      .filter((s) => s.genres === "all" || s.genres.includes(genre))
      .map((s) => `tw:${s.kind}`)
      .join(", ");
    const spec = registry.find((s) => s.kind === kind);
    if (!spec) {
      const diagnostics: CompositorDiagnostic[] = [
        {
          code: "UNKNOWN_DIRECTIVE",
          message: `Directive "tw:${kind}" is not in the component vocabulary. Supported directives: ${vocabulary}. Corrected minimal example:\n\`\`\`tw:stats\n${statsSpec.example}\n\`\`\``,
          location: `tw:${kind}`,
        },
      ];
      return { ok: false, diagnostics };
    }
    if (spec.genres !== "all" && !spec.genres.includes(genre)) {
      return {
        ok: false,
        diagnostics: [
          {
            code: "DIRECTIVE_GENRE_RESTRICTED",
            message: `Directive "tw:${kind}" is not available for the "${genre}" genre (available in: ${(spec.genres as readonly string[]).join(", ")}). Directives available for "${genre}": ${vocabulary}.`,
            location: `tw:${kind}`,
          },
        ],
      };
    }
    let data: unknown;
    try {
      data = parseYaml(body, { strict: true });
    } catch (err) {
      return reject(
        kind,
        `tw:${kind} body failed to parse as YAML: ${err instanceof Error ? err.message.split("\n")[0] : "parse error"}.`,
        spec,
      );
    }
    return spec.render({ data, genre });
  };
}

/** The production engine over the launch vocabulary. */
export const renderDocumentDirective: DirectiveEngine = buildDirectiveEngine();

export type { DirectiveSpec };
