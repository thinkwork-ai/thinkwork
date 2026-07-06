/**
 * Analysis op registry (THINK-183 U1): the closed, versioned calculation
 * vocabulary for plate-declared analyses.
 *
 * A plate declares analyses by op key; the model supplies raw inputs in a
 * `tw:analysis` block and the server does the arithmetic — rendered numbers
 * come from `compute`, never from model prose. Mirrors the directive
 * registry's doctrine exactly: closed vocabulary, typed inputs, rejection of
 * unknowns with a corrected minimal example the model can self-repair from.
 *
 * Pure module — no DB, no network, no clock. Every op is deterministic:
 * identical inputs produce identical results.
 */

export const ANALYSIS_VOCABULARY_VERSION = "document-analyses/v1";

export interface AnalysisDiagnostic {
  code: string;
  message: string;
  location: string;
}

export interface AnalysisSeriesPoint {
  label: string;
  value: number;
}

export interface AnalysisStat {
  label: string;
  value: string;
}

/**
 * Every op yields both a chartable series and a stats projection so the
 * analysis's declared presentation (chart vs stats) is a free choice.
 */
export interface AnalysisComputeOk {
  ok: true;
  op: string;
  series: AnalysisSeriesPoint[];
  stats: AnalysisStat[];
  /** Computed takeaway suitable as a figure caption. */
  caption?: string;
}

export interface AnalysisComputeRejected {
  ok: false;
  diagnostics: AnalysisDiagnostic[];
}

export type AnalysisComputeResult = AnalysisComputeOk | AnalysisComputeRejected;

export interface AnalysisOpSpec {
  op: string;
  /** One-line input-shape hint for the dispatch tool surface (KTD8). */
  inputHint: string;
  /** Full input schema summary used in rejection diagnostics. */
  schema: string;
  /** Corrected minimal example (KTD7 self-repair posture). */
  example: string;
  compute: (inputs: unknown, params: unknown) => AnalysisComputeResult;
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return v !== null && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null;
}

function finiteNumber(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function textOf(v: unknown): string | null {
  if (typeof v === "string") return v;
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return null;
}

/** Round to one decimal and drop a trailing ".0" (66.666 → "66.7", 40 → "40"). */
function pct(n: number): string {
  const rounded = Math.round(n * 10) / 10;
  return `${Number.isInteger(rounded) ? rounded.toFixed(0) : rounded.toFixed(1)}%`;
}

function signed(n: number): string {
  const rounded = Math.round(n * 100) / 100;
  return rounded > 0 ? `+${rounded}` : String(rounded);
}

function reject(
  op: string,
  message: string,
  spec?: AnalysisOpSpec,
): AnalysisComputeRejected {
  const suffix = spec
    ? ` Expected inputs: ${spec.schema}. Corrected minimal example:\n${spec.example}`
    : "";
  return {
    ok: false,
    diagnostics: [
      {
        code: "ANALYSIS_INVALID",
        message: `${message}${suffix}`,
        location: `analysis:${op}`,
      },
    ],
  };
}

/** Parse a labeled-point list ({ label, value-under-`valueKey` }). */
function parsePoints(
  raw: unknown,
  valueKey: string,
): { points: AnalysisSeriesPoint[] } | { error: string } {
  if (!Array.isArray(raw)) return { error: "not-a-list" };
  const points: AnalysisSeriesPoint[] = [];
  for (const [i, entry] of raw.entries()) {
    const rec = asRecord(entry);
    const label = textOf(rec?.label);
    const value = finiteNumber(rec?.[valueKey]);
    if (label === null || value === null) {
      return {
        error: `entry [${i}] must be { label: string, ${valueKey}: finite number }`,
      };
    }
    points.push({ label, value });
  }
  return { points };
}

// ---------------------------------------------------------------------------
// funnel_conversion — ordered stages → per-transition rates + overall
// ---------------------------------------------------------------------------

const funnelConversionSpec: AnalysisOpSpec = {
  op: "funnel_conversion",
  inputHint: "ordered stages: [{ label, count }], >=2 stages",
  schema:
    "stages: ordered list of { label: string, count: finite number >= 0 } (2–24 stages, widest first)",
  example: `analysis: <declared key>
stages:
  - { label: Leads, count: 120 }
  - { label: Qualified, count: 80 }`,
  compute: (inputs) => {
    const root = asRecord(inputs);
    const parsed = parsePoints(root?.stages, "count");
    if ("error" in parsed) {
      return reject(
        "funnel_conversion",
        parsed.error === "not-a-list"
          ? "funnel_conversion needs a `stages` list."
          : `stages ${parsed.error}.`,
        funnelConversionSpec,
      );
    }
    const stages = parsed.points;
    if (stages.length < 2 || stages.length > 24) {
      return reject(
        "funnel_conversion",
        `funnel_conversion needs 2–24 ordered stages (got ${stages.length}).`,
        funnelConversionSpec,
      );
    }
    if (stages.some((s) => s.value < 0)) {
      return reject(
        "funnel_conversion",
        "Stage counts must be >= 0.",
        funnelConversionSpec,
      );
    }
    const stats: AnalysisStat[] = [];
    const series: AnalysisSeriesPoint[] = [stages[0]];
    for (let i = 1; i < stages.length; i++) {
      const prior = stages[i - 1];
      const cur = stages[i];
      const rate = prior.value === 0 ? null : (cur.value / prior.value) * 100;
      const rateText = rate === null ? "n/a" : pct(rate);
      series.push({ label: `${cur.label} (${rateText})`, value: cur.value });
      stats.push({
        label: `${prior.label} → ${cur.label}`,
        value: rateText,
      });
    }
    const first = stages[0].value;
    const last = stages[stages.length - 1].value;
    const overall = first === 0 ? "n/a" : pct((last / first) * 100);
    stats.push({ label: "Overall conversion", value: overall });
    return {
      ok: true,
      op: "funnel_conversion",
      series,
      stats,
      caption: `Overall conversion ${overall} (${stages[0].label} → ${stages[stages.length - 1].label}).`,
    };
  },
};

// ---------------------------------------------------------------------------
// ratio_pct — numerator / denominator as a percentage
// ---------------------------------------------------------------------------

const ratioPctSpec: AnalysisOpSpec = {
  op: "ratio_pct",
  inputHint: "numerator + denominator (nonzero), optional label",
  schema:
    "numerator: finite number; denominator: finite nonzero number; label?: string",
  example: `analysis: <declared key>
numerator: 82
denominator: 100
label: Quota attainment`,
  compute: (inputs) => {
    const root = asRecord(inputs);
    const numerator = finiteNumber(root?.numerator);
    const denominator = finiteNumber(root?.denominator);
    if (numerator === null || denominator === null) {
      return reject(
        "ratio_pct",
        "ratio_pct needs finite `numerator` and `denominator` numbers.",
        ratioPctSpec,
      );
    }
    if (denominator === 0) {
      return reject(
        "ratio_pct",
        "`denominator` must be nonzero — a ratio against zero is undefined. If you are comparing against a prior value that may be zero, use variance_vs_prior.",
        ratioPctSpec,
      );
    }
    const label = textOf(root?.label) ?? "Ratio";
    const value = (numerator / denominator) * 100;
    const rounded = Math.round(value * 10) / 10;
    return {
      ok: true,
      op: "ratio_pct",
      series: [{ label, value: rounded }],
      stats: [{ label, value: pct(value) }],
      caption: `${label}: ${pct(value)} (${numerator} of ${denominator}).`,
    };
  },
};

// ---------------------------------------------------------------------------
// variance_vs_prior — current vs prior: delta and % change
// ---------------------------------------------------------------------------

const varianceVsPriorSpec: AnalysisOpSpec = {
  op: "variance_vs_prior",
  inputHint: "current + prior numbers, optional label",
  schema: "current: finite number; prior: finite number; label?: string",
  example: `analysis: <declared key>
current: 118
prior: 104
label: Closed-won deals`,
  compute: (inputs) => {
    const root = asRecord(inputs);
    const current = finiteNumber(root?.current);
    const prior = finiteNumber(root?.prior);
    if (current === null || prior === null) {
      return reject(
        "variance_vs_prior",
        "variance_vs_prior needs finite `current` and `prior` numbers.",
        varianceVsPriorSpec,
      );
    }
    const label = textOf(root?.label) ?? "Value";
    const delta = current - prior;
    const changeText =
      prior === 0 ? "n/a (prior is 0)" : pct((delta / prior) * 100);
    return {
      ok: true,
      op: "variance_vs_prior",
      series: [
        { label: `${label} (prior)`, value: prior },
        { label: `${label} (current)`, value: current },
      ],
      stats: [
        { label: `${label} (current)`, value: String(current) },
        { label: `${label} (prior)`, value: String(prior) },
        { label: "Change", value: signed(delta) },
        { label: "Change %", value: changeText },
      ],
      caption: `${label}: ${signed(delta)} vs prior (${changeText}).`,
    };
  },
};

// ---------------------------------------------------------------------------
// group_count — count occurrences per distinct value
// ---------------------------------------------------------------------------

const groupCountSpec: AnalysisOpSpec = {
  op: "group_count",
  inputHint: "values: list of group labels (strings), <=500",
  schema: "values: list of strings (1–500 entries, at most 24 distinct groups)",
  example: `analysis: <declared key>
values: [Discovery, Discovery, Negotiation, Closed]`,
  compute: (inputs) => {
    const root = asRecord(inputs);
    const values = root?.values;
    if (!Array.isArray(values) || values.length === 0) {
      return reject(
        "group_count",
        "group_count needs a non-empty `values` list.",
        groupCountSpec,
      );
    }
    if (values.length > 500) {
      return reject(
        "group_count",
        `group_count accepts at most 500 values (got ${values.length}).`,
        groupCountSpec,
      );
    }
    const counts = new Map<string, number>();
    for (const [i, v] of values.entries()) {
      const label = textOf(v);
      if (label === null) {
        return reject(
          "group_count",
          `values[${i}] must be a string.`,
          groupCountSpec,
        );
      }
      counts.set(label, (counts.get(label) ?? 0) + 1);
    }
    if (counts.size > 24) {
      return reject(
        "group_count",
        `group_count renders at most 24 distinct groups (got ${counts.size}). Use top_n over pre-aggregated { label, value } items instead.`,
        groupCountSpec,
      );
    }
    // Deterministic order: count desc, then label asc.
    const series = [...counts.entries()]
      .map(([label, value]) => ({ label, value }))
      .sort((a, b) => b.value - a.value || a.label.localeCompare(b.label));
    return {
      ok: true,
      op: "group_count",
      series,
      stats: series.map((p) => ({ label: p.label, value: String(p.value) })),
      caption: `${values.length} items across ${counts.size} group${counts.size === 1 ? "" : "s"}.`,
    };
  },
};

// ---------------------------------------------------------------------------
// top_n — largest n items by value
// ---------------------------------------------------------------------------

const topNSpec: AnalysisOpSpec = {
  op: "top_n",
  inputHint: "items: [{ label, value }] (<=200) + n (1-24)",
  schema:
    "items: list of { label: string, value: finite number } (1–200); n: integer 1–24",
  example: `analysis: <declared key>
n: 3
items:
  - { label: Acme, value: 42000 }
  - { label: Globex, value: 30500 }
  - { label: Initech, value: 12000 }
  - { label: Umbrella, value: 8000 }`,
  compute: (inputs) => {
    const root = asRecord(inputs);
    const parsed = parsePoints(root?.items, "value");
    if ("error" in parsed) {
      return reject(
        "top_n",
        parsed.error === "not-a-list"
          ? "top_n needs an `items` list."
          : `items ${parsed.error}.`,
        topNSpec,
      );
    }
    const items = parsed.points;
    if (items.length === 0 || items.length > 200) {
      return reject(
        "top_n",
        `top_n accepts 1–200 items (got ${items.length}).`,
        topNSpec,
      );
    }
    const n = finiteNumber(root?.n);
    if (n === null || !Number.isInteger(n) || n < 1 || n > 24) {
      return reject(
        "top_n",
        "`n` must be an integer between 1 and 24.",
        topNSpec,
      );
    }
    // Deterministic order: value desc, then label asc.
    const series = [...items]
      .sort((a, b) => b.value - a.value || a.label.localeCompare(b.label))
      .slice(0, n);
    return {
      ok: true,
      op: "top_n",
      series,
      stats: series.map((p) => ({ label: p.label, value: String(p.value) })),
      caption: `Top ${series.length} of ${items.length} by value.`,
    };
  },
};

// ---------------------------------------------------------------------------
// trend — ordered points → direction + net change
// ---------------------------------------------------------------------------

// Input floor settled here (plan's deferred question): 3 points. With two,
// variance_vs_prior is the right op — the diagnostic says so.
const trendSpec: AnalysisOpSpec = {
  op: "trend",
  inputHint: "ordered points: [{ label, value }], 3-24 points",
  schema:
    "points: ordered list of { label: string, value: finite number } (3–24 points, oldest first)",
  example: `analysis: <declared key>
points:
  - { label: Apr, value: 92 }
  - { label: May, value: 104 }
  - { label: Jun, value: 118 }`,
  compute: (inputs) => {
    const root = asRecord(inputs);
    const parsed = parsePoints(root?.points, "value");
    if ("error" in parsed) {
      return reject(
        "trend",
        parsed.error === "not-a-list"
          ? "trend needs a `points` list."
          : `points ${parsed.error}.`,
        trendSpec,
      );
    }
    const points = parsed.points;
    if (points.length < 3 || points.length > 24) {
      return reject(
        "trend",
        `trend needs 3–24 ordered points (got ${points.length}). For exactly two values, use variance_vs_prior.`,
        trendSpec,
      );
    }
    const first = points[0].value;
    const last = points[points.length - 1].value;
    const delta = last - first;
    const direction = delta > 0 ? "up" : delta < 0 ? "down" : "flat";
    const changeText =
      first === 0 ? "n/a (first point is 0)" : pct((delta / first) * 100);
    return {
      ok: true,
      op: "trend",
      series: points,
      stats: [
        { label: "Direction", value: direction },
        { label: "Net change", value: signed(delta) },
        { label: "Change %", value: changeText },
      ],
      caption: `Trend ${direction}: ${signed(delta)} from ${points[0].label} to ${points[points.length - 1].label} (${changeText}).`,
    };
  },
};

// ---------------------------------------------------------------------------
// Registry + entry point
// ---------------------------------------------------------------------------

const DEFAULT_ANALYSIS_REGISTRY: readonly AnalysisOpSpec[] = [
  funnelConversionSpec,
  ratioPctSpec,
  varianceVsPriorSpec,
  groupCountSpec,
  topNSpec,
  trendSpec,
];

/** Canonical op keys — the plate save gate's analysis vocabulary. */
export const ANALYSIS_OPS: readonly string[] = DEFAULT_ANALYSIS_REGISTRY.map(
  (s) => s.op,
);

const OPS_BY_KEY = new Map(DEFAULT_ANALYSIS_REGISTRY.map((s) => [s.op, s]));

export function getAnalysisOp(op: string): AnalysisOpSpec | null {
  return OPS_BY_KEY.get(op) ?? null;
}

/**
 * Validate-then-compute entry point. `location` overrides the diagnostic
 * location so callers can point at the authored block (`tw:analysis`).
 */
export function computeAnalysis(args: {
  op: string;
  inputs: unknown;
  params?: unknown;
  location?: string;
}): AnalysisComputeResult {
  const spec = OPS_BY_KEY.get(args.op);
  if (!spec) {
    return {
      ok: false,
      diagnostics: [
        {
          code: "ANALYSIS_UNKNOWN_OP",
          message: `Unknown analysis op ${JSON.stringify(args.op)}. Available ops: ${ANALYSIS_OPS.join(", ")}.`,
          location: args.location ?? `analysis:${args.op}`,
        },
      ],
    };
  }
  const result = spec.compute(args.inputs, args.params);
  if (!result.ok && args.location) {
    return {
      ok: false,
      diagnostics: result.diagnostics.map((d) => ({
        ...d,
        location: args.location as string,
      })),
    };
  }
  return result;
}
