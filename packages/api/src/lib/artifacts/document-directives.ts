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
import {
  ANALYSIS_OPS,
  computeAnalysis,
  getAnalysisOp,
} from "./document-analyses.js";
import { CHART_TYPES, renderChart } from "@thinkwork/chart-renderer";
import type {
  ChartDirectiveData,
  ChartSeriesPoint,
  ChartType,
} from "@thinkwork/chart-renderer";
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
// tw:timeline — the plate milestone track (ordered labels on a horizontal rail)
// ---------------------------------------------------------------------------

const timelineSpec: DirectiveSpec = {
  kind: "timeline",
  genres: "all",
  schema:
    "items: list of { label: string, caption?: string, date?: string, current?: boolean } (1-8 items, at most one current: true)",
  example: `items:
  - { label: Kickoff, caption: Contract signed, date: Jan 2026 }
  - { label: Build, caption: Core implementation, current: true }
  - { label: Launch, date: Q4 }`,
  render: ({ data }) => {
    const root = asRecord(data);
    const items = root?.items;
    if (!Array.isArray(items) || items.length === 0 || items.length > 8) {
      return reject(
        "timeline",
        "tw:timeline needs an `items` list with 1-8 entries — split the sequence or aggregate phases if you have more.",
        timelineSpec,
      );
    }
    const rendered: string[] = [];
    const currentIndices: number[] = [];
    for (const [i, item] of items.entries()) {
      const rec = asRecord(item);
      if (!rec) {
        return reject(
          "timeline",
          `items[${i}] must be a mapping with a \`label\`.`,
          timelineSpec,
        );
      }
      const label = textOf(rec.label);
      if (label === null) {
        return reject(
          "timeline",
          `items[${i}] must have a \`label\`.`,
          timelineSpec,
        );
      }
      const caption = "caption" in rec ? textOf(rec.caption) : undefined;
      if (caption === null) {
        return reject(
          "timeline",
          `items[${i}] has an invalid \`caption\`.`,
          timelineSpec,
        );
      }
      const date = "date" in rec ? textOf(rec.date) : undefined;
      if (date === null) {
        return reject(
          "timeline",
          `items[${i}] has an invalid \`date\`.`,
          timelineSpec,
        );
      }
      const current = rec.current;
      if ("current" in rec && typeof current !== "boolean") {
        return reject(
          "timeline",
          `items[${i}] has an invalid \`current\`; it must be a boolean.`,
          timelineSpec,
        );
      }
      if (current === true) currentIndices.push(i);
      rendered.push(
        `<div class="t-item${current === true ? " current" : ""}"><div class="t-label">${escapeHtml(label)}</div><div class="t-track"><span class="t-dot"></span></div>${caption !== undefined ? `<div class="t-caption">${escapeHtml(caption)}</div>` : ""}${date !== undefined ? `<div class="t-date">${escapeHtml(date)}</div>` : ""}</div>`,
      );
    }
    if (currentIndices.length > 1) {
      return reject(
        "timeline",
        `at most one item may be marked \`current: true\` (items[${currentIndices[0]}] and items[${currentIndices[1]}] both are).`,
        timelineSpec,
      );
    }
    return {
      ok: true,
      html: `<div class="timeline">${rendered.join("")}</div>`,
      containsSvg: false,
    };
  },
};

// ---------------------------------------------------------------------------
// tw:chart — declarative data drawn by the house SVG chart renderer (U3).
// The shell validates shape here; rendering is injected to keep the registry
// testable and let U3 land as its own unit.
// ---------------------------------------------------------------------------

// The chart data contract now lives in @thinkwork/chart-renderer (shared with
// native clients); re-exported here so api-internal importers are unchanged.
export { CHART_TYPES };
export type {
  ChartDirectiveData,
  ChartSeriesPoint,
  ChartType,
} from "@thinkwork/chart-renderer";

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
    const html = chartFigureHtml(chartRenderer(chartData), chartData);
    return { ok: true, html, containsSvg: true };
  },
});

/**
 * Figure + fallback data table assembly, shared by tw:chart and tw:analysis
 * chart presentations. Per authoring-rules.md: every chart pairs with a
 * <details> data table — the static medium's drill-down and accessibility
 * fallback.
 */
function chartFigureHtml(svg: string, chartData: ChartDirectiveData): string {
  const rows = chartData.series
    .map(
      (p) =>
        `<tr><td>${escapeHtml(p.label)}</td><td>${escapeHtml(String(p.value))}</td></tr>`,
    )
    .join("");
  const caption = chartData.caption
    ? `<figcaption>${escapeHtml(chartData.caption)}</figcaption>`
    : "";
  return `<figure>${svg}${caption}</figure><details><summary>Chart data</summary><table><tr><th>${escapeHtml("Label")}</th><th>${escapeHtml(chartData.title)}</th></tr>${rows}</table></details>`;
}

// ---------------------------------------------------------------------------
// tw:analysis — plate-declared, server-computed analysis (THINK-183 U3).
//
// A STRUCTURAL contract directive (KTD11): it is not in DIRECTIVE_KINDS, is
// exempt from per-plate allowedDirectives gating (the compositor routes it
// here before the plate gate), and its real gate is the declared-analysis
// lookup — a tw:analysis block only compiles when the plate declares the
// referenced key. The model supplies RAW INPUTS; the server computes via the
// op registry and renders through the analysis's declared presentation, so
// every rendered number is server-arithmetic (R5).
// ---------------------------------------------------------------------------

/** The presentation surfaces an analysis result can render through. */
export const ANALYSIS_PRESENTATION_DIRECTIVES = ["chart", "stats"] as const;

export interface PlateAnalysisDeclaration {
  key: string;
  op: string;
  params?: Readonly<Record<string, unknown>>;
  presentation: { directive: string; chartType?: string };
}

const ANALYSIS_EXAMPLE = `analysis: <declared key>
stages:
  - { label: Leads, count: 120 }
  - { label: Qualified, count: 80 }`;

function rejectAnalysis(message: string): DirectiveRender {
  return {
    ok: false,
    diagnostics: [
      {
        code: "DIRECTIVE_INVALID",
        message: `${message} Corrected minimal example:\n\`\`\`tw:analysis\n${ANALYSIS_EXAMPLE}\n\`\`\``,
        location: "tw:analysis",
      },
    ],
  };
}

/** Deterministic display title for an analysis key ("pipeline-conversion" → "Pipeline conversion"). */
function analysisTitle(key: string): string {
  const words = key.replace(/-/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export function renderAnalysisDirective(input: {
  body: string;
  analyses: readonly PlateAnalysisDeclaration[] | undefined;
  chartRenderer?: ChartRenderer;
}): DirectiveRender {
  const declaredKeys = (input.analyses ?? []).map((a) => a.key);
  if (declaredKeys.length === 0) {
    return rejectAnalysis(
      "This plate declares no analyses, so tw:analysis is not available here. Express the data as prose, a markdown table, or another directive.",
    );
  }
  let data: unknown;
  try {
    data = parseYaml(input.body, { strict: true });
  } catch (err) {
    return rejectAnalysis(
      `tw:analysis body failed to parse as YAML: ${err instanceof Error ? err.message.split("\n")[0] : "parse error"}.`,
    );
  }
  const root = asRecord(data);
  if (!root) {
    return rejectAnalysis("tw:analysis body must be a YAML mapping.");
  }
  const key = textOf(root.analysis);
  if (key === null) {
    return rejectAnalysis(
      `tw:analysis needs an \`analysis\` field naming a declared analysis. This plate declares: ${declaredKeys.join(", ")}.`,
    );
  }
  const declared = (input.analyses ?? []).find((a) => a.key === key);
  if (!declared) {
    return rejectAnalysis(
      `Analysis ${JSON.stringify(key)} is not declared by this plate. Declared analyses: ${declaredKeys.join(", ")}.`,
    );
  }
  const opSpec = getAnalysisOp(declared.op);
  if (!opSpec) {
    // Save gates make this unreachable for validated rows; guard for rows
    // predating an op-registry change.
    return rejectAnalysis(
      `Analysis "${key}" references op "${declared.op}", which is not in this release's op registry (${ANALYSIS_OPS.join(", ")}).`,
    );
  }
  // Raw inputs are everything in the block except the reference fields;
  // plate-declared params win over model-supplied values.
  const {
    analysis: _key,
    title: rawTitle,
    qualifier: rawQualifier,
    ...rawInputs
  } = root;
  const result = computeAnalysis({
    op: declared.op,
    inputs: { ...rawInputs, ...(declared.params ?? {}) },
    location: "tw:analysis",
  });
  if (!result.ok) {
    return {
      ok: false,
      diagnostics: result.diagnostics.map((d) => ({
        code: d.code,
        message: `Analysis "${key}": ${d.message}`,
        location: d.location,
      })),
    };
  }

  const title = textOf(rawTitle)?.trim() || analysisTitle(key);
  if (declared.presentation.directive === "stats") {
    // Reuse the stats directive's tile rendering over the computed stats.
    // Stats tiles cap at 8; computed projections are ordered most-significant
    // first, so a deterministic truncation keeps the tiles meaningful.
    return statsSpec.render({
      data: {
        items: result.stats
          .slice(0, 8)
          .map((s) => ({ value: s.value, label: s.label })),
      },
      genre: "analysis",
    });
  }

  const chartData: ChartDirectiveData = {
    type: (declared.presentation.chartType ?? "bar") as ChartType,
    title,
    qualifier: textOf(rawQualifier) ?? undefined,
    series: result.series.slice(0, 24).map((p) => ({ ...p })),
    caption: result.caption,
  };
  const renderer = input.chartRenderer ?? renderChart;
  return {
    ok: true,
    html: chartFigureHtml(renderer(chartData), chartData),
    containsSvg: true,
  };
}

// ---------------------------------------------------------------------------
// tw:waiver — explicit suitability waiver for a manifest section (THINK-183
// U4). The second structural contract directive (KTD11): validated against
// the plate's section manifest, never against allowedDirectives. Placement is
// meaning — the omission notice renders where the block sits (R9), and the
// compositor collects the waiver for the post-parse contract check, the
// provenance footer, and persistence.
// ---------------------------------------------------------------------------

export interface WaiverableSection {
  id: string;
  title: string;
  tier: "required" | "required-if-material" | "suggested";
}

export interface CollectedWaiver {
  sectionId: string;
  title: string;
  tier: "required" | "required-if-material";
  reason: string;
}

export type WaiverRender =
  | { ok: true; html: string; waiver: CollectedWaiver }
  | { ok: false; diagnostics: CompositorDiagnostic[] };

const MAX_WAIVER_REASON = 300;

const WAIVER_EXAMPLE = `section: pipeline-health
reason: No stage-level pipeline data is connected for this rep.`;

function rejectWaiver(message: string): WaiverRender {
  return {
    ok: false,
    diagnostics: [
      {
        code: "DIRECTIVE_INVALID",
        message: `${message} Corrected minimal example:\n\`\`\`tw:waiver\n${WAIVER_EXAMPLE}\n\`\`\``,
        location: "tw:waiver",
      },
    ],
  };
}

export function renderWaiverDirective(input: {
  body: string;
  sections: readonly WaiverableSection[] | undefined;
}): WaiverRender {
  const manifest = input.sections ?? [];
  if (manifest.length === 0) {
    return rejectWaiver(
      "This plate has no section manifest, so there is nothing to waive — remove the tw:waiver block.",
    );
  }
  let data: unknown;
  try {
    data = parseYaml(input.body, { strict: true });
  } catch (err) {
    return rejectWaiver(
      `tw:waiver body failed to parse as YAML: ${err instanceof Error ? err.message.split("\n")[0] : "parse error"}.`,
    );
  }
  const root = asRecord(data);
  const sectionId = textOf(root?.section);
  const waiverable = manifest.filter((s) => s.tier !== "suggested");
  if (sectionId === null) {
    return rejectWaiver(
      `tw:waiver needs a \`section\` field naming a manifest section. Waivable sections: ${waiverable.map((s) => s.id).join(", ") || "(none)"}.`,
    );
  }
  const section = manifest.find((s) => s.id === sectionId);
  if (!section) {
    return rejectWaiver(
      `Section ${JSON.stringify(sectionId)} is not in this plate's manifest. Waivable sections: ${waiverable.map((s) => s.id).join(", ") || "(none)"}.`,
    );
  }
  if (section.tier === "suggested") {
    return rejectWaiver(
      `Section "${sectionId}" is suggested-tier — suggested sections never block, so no waiver is needed. Remove the tw:waiver block.`,
    );
  }
  const reason = textOf(root?.reason)?.trim();
  if (!reason) {
    return rejectWaiver(
      "tw:waiver needs a `reason` explaining why the section's data is unavailable.",
    );
  }
  if (reason.length > MAX_WAIVER_REASON) {
    return rejectWaiver(
      `The waiver reason must be ≤${MAX_WAIVER_REASON} characters — state the data gap, not the narrative.`,
    );
  }
  // The omission notice: house card vocabulary only (tokens follow the plate
  // palette, so light/dark both hold — DocSpector DARK_MODE stays clean).
  const html = `<div class="card waived-section"><div class="q">Section omitted</div><div class="a">${escapeHtml(section.title)}</div><p>${escapeHtml(reason)}</p></div>`;
  return {
    ok: true,
    html,
    waiver: {
      sectionId: section.id,
      title: section.title,
      tier: section.tier,
      reason,
    },
  };
}

// ---------------------------------------------------------------------------
// tw:sources — per-section data-source provenance (plates provenance 2026-07).
// The third structural contract directive (KTD11 posture): routed before the
// plate's allowedDirectives gate, validated against the section manifest when
// one exists. Placement is meaning — the sources card renders where the block
// sits (an audit footnote inside its section), and the compositor collects the
// claims for section facts, conformance rows, and the customized-plate
// enforcement check.
// ---------------------------------------------------------------------------

/** One provenance line inside a tw:sources fence. */
export interface SectionSourceEntry {
  kind: "tool" | "none";
  /** The tool that produced the data (kind "tool" only). */
  tool?: string;
  /** Free-text detail: query/table/filter + row count, or the none-reason. */
  detail: string;
}

export interface CollectedSectionSources {
  sectionId: string;
  entries: SectionSourceEntry[];
}

export type SourcesRender =
  | { ok: true; html: string; sources: CollectedSectionSources }
  | { ok: false; diagnostics: CompositorDiagnostic[] };

const MAX_SOURCE_DETAIL = 300;

export const SOURCES_EXAMPLE = `section: pipeline-health
- tool: mcp_lastmile-data_query — SELECT stage, count(*) FROM opportunity GROUP BY stage (12 rows)
- tool: twenty--crm.search_records — opportunities for the rep, current quarter (72 records)`;

function rejectSources(message: string): SourcesRender {
  return {
    ok: false,
    diagnostics: [
      {
        code: "DIRECTIVE_INVALID",
        message: `${message} Corrected minimal example:\n\`\`\`tw:sources\n${SOURCES_EXAMPLE}\n\`\`\`\nNarrative-only sections use \`- none: <why no tool data backs this section>\` instead of tool lines.`,
        location: "tw:sources",
      },
    ],
  };
}

const SOURCES_SECTION_LINE = /^section:\s*(\S+)\s*$/;
const SOURCES_TOOL_LINE = /^-\s*tool:\s*([^\s—:]+)\s*(?:[—:]\s*(.*))?$/;
const SOURCES_NONE_LINE = /^-\s*none:\s*(.*)$/;

/**
 * Parse a tw:sources fence body. Deliberately NOT YAML: source details are
 * free text (queries carry colons and commas), so the grammar is line-based —
 * one `section:` line, then one `- tool:` or `- none:` line per source.
 */
export function renderSourcesDirective(input: {
  body: string;
  sections: readonly WaiverableSection[] | undefined;
}): SourcesRender {
  const lines = input.body
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l !== "");
  if (lines.length === 0) {
    return rejectSources("tw:sources fence is empty.");
  }
  const sectionMatch = SOURCES_SECTION_LINE.exec(lines[0]);
  if (!sectionMatch) {
    return rejectSources(
      "tw:sources must start with a `section: <section-id>` line naming the section the sources back.",
    );
  }
  const sectionId = sectionMatch[1];
  const manifest = input.sections ?? [];
  if (manifest.length > 0 && !manifest.some((s) => s.id === sectionId)) {
    return rejectSources(
      `Section ${JSON.stringify(sectionId)} is not in this plate's manifest. Manifest sections: ${manifest.map((s) => s.id).join(", ")}.`,
    );
  }
  const entries: SectionSourceEntry[] = [];
  for (const line of lines.slice(1)) {
    const tool = SOURCES_TOOL_LINE.exec(line);
    if (tool) {
      const detail = (tool[2] ?? "").trim();
      if (detail.length > MAX_SOURCE_DETAIL) {
        return rejectSources(
          `The source detail for tool "${tool[1]}" must be ≤${MAX_SOURCE_DETAIL} characters — state the query/filter and row count, not the narrative.`,
        );
      }
      entries.push({ kind: "tool", tool: tool[1], detail });
      continue;
    }
    const none = SOURCES_NONE_LINE.exec(line);
    if (none) {
      const detail = none[1].trim();
      if (!detail) {
        return rejectSources(
          "`- none:` lines need a reason explaining why the section is narrative-only.",
        );
      }
      if (detail.length > MAX_SOURCE_DETAIL) {
        return rejectSources(
          `The \`- none:\` reason must be ≤${MAX_SOURCE_DETAIL} characters.`,
        );
      }
      entries.push({ kind: "none", detail });
      continue;
    }
    return rejectSources(
      `tw:sources line ${JSON.stringify(line)} is not valid — every source line is either \`- tool: <tool-name> — <query/filter + row count>\` or \`- none: <reason>\`.`,
    );
  }
  if (entries.length === 0) {
    return rejectSources(
      "tw:sources needs at least one source line after the `section:` line.",
    );
  }

  const items = entries
    .map((e) =>
      e.kind === "tool"
        ? `<li><code>${escapeHtml(e.tool ?? "")}</code>${e.detail ? ` — ${escapeHtml(e.detail)}` : ""}</li>`
        : `<li>No tool data — ${escapeHtml(e.detail)}</li>`,
    )
    .join("");
  // <details> (collapsed by default) so provenance is one quiet row until the
  // reader opens it — native disclosure, no JS, works in sandboxed viewers.
  const html = `<details class="card section-sources"><summary class="sources-label">Data sources</summary><ul>${items}</ul></details>`;
  return { ok: true, html, sources: { sectionId, entries } };
}

// ---------------------------------------------------------------------------
// Registry + engine
// ---------------------------------------------------------------------------

const DEFAULT_REGISTRY: readonly DirectiveSpec[] = [
  statsSpec,
  verdictGridSpec,
  makeChartSpec(renderChart),
  timelineSpec,
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
