/**
 * Plate registry (THINK-153 U6+U7) — shared client helpers.
 *
 * Pure, framework-free logic so it can be unit-tested without React or urql:
 *  - the palette token vocabulary + directive kinds (R7),
 *  - parsing raw `DocumentPlate` GraphQL nodes (AWSJSON → objects),
 *  - the live-preview sequence guard (U7): an earlier response must never
 *    overwrite a later one, and a diagnostics response keeps the last-good
 *    HTML visible.
 */

import type { DocumentPlate, DocumentPlateDiagnostic } from "@/gql/graphql";

// ─── Vocabulary (R7) ──────────────────────────────────────────────────────

/** The only CSS custom-property names a plate palette may set. */
export const PLATE_PALETTE_TOKENS = [
  "--bg",
  "--ink",
  "--muted",
  "--line",
  "--card",
  "--accent",
  "--accent-soft",
  "--accent-text",
  "--info",
  "--info-soft",
  "--info-text",
  "--warn",
  "--warn-soft",
  "--warn-text",
  "--bad",
  "--bad-soft",
  "--bad-text",
  "--mono",
] as const;

export type PlatePaletteToken = (typeof PLATE_PALETTE_TOKENS)[number];

/** Directive kinds a plate may make available to documents. */
export const PLATE_DIRECTIVE_KINDS = [
  "stats",
  "verdict-grid",
  "chart",
  "timeline",
] as const;

export type PlateDirectiveKind = (typeof PLATE_DIRECTIVE_KINDS)[number];

// ─── Parsed plate model ───────────────────────────────────────────────────

/**
 * The tenant's raw delta config for a plate (drives the editor form + reset).
 * Every field is optional — a fresh platform plate carries none of them.
 */
export interface PlateOverrides {
  displayName?: string;
  useFor?: string;
  eyebrow?: string;
  titleSuffix?: string;
  paletteLight?: Record<string, string>;
  paletteDark?: Record<string, string>;
  allowedDirectives?: string[] | null;
  hidden?: boolean;
}

export interface PlateItem {
  slug: string;
  displayName: string;
  useFor: string;
  eyebrow: string;
  titleSuffix: string;
  /** Fully resolved effective tokens (platform + palette + deltas). */
  tokensLight: Record<string, string>;
  tokensDark: Record<string, string>;
  allowedDirectives: string[] | null;
  origin: "platform" | "tenant";
  hidden: boolean;
  customized: boolean;
  /** The tenant's raw delta config (null when untouched platform default). */
  overrides: PlateOverrides | null;
  /** Resolved, provenance-annotated content contract (THINK-188). */
  sections: PlateContractSection[];
  analyses: PlateContractAnalysis[];
}

/**
 * AWSJSON tolerance: the deployed scalar returns PARSED values over the wire
 * while unit paths see the resolver's JSON strings — accept both shapes.
 */
function jsonish(value: unknown): unknown {
  if (typeof value !== "string" || value.length === 0) return value;
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

function parseJsonObject(value: unknown): Record<string, string> {
  {
    const parsed = jsonish(value);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      const out: Record<string, string> = {};
      for (const [key, raw] of Object.entries(parsed)) {
        if (typeof raw === "string") out[key] = raw;
      }
      return out;
    }
  }
  return {};
}

function parseOverrides(value: unknown): PlateOverrides | null {
  const parsed = jsonish(value);
  if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
    return parsed as PlateOverrides;
  }
  return null;
}

/** Map a raw GraphQL `DocumentPlate` node into the parsed client model. */
export function parsePlate(
  node: Pick<
    DocumentPlate,
    | "slug"
    | "displayName"
    | "useFor"
    | "eyebrow"
    | "titleSuffix"
    | "tokensLight"
    | "tokensDark"
    | "allowedDirectives"
    | "origin"
    | "hidden"
    | "customized"
    | "overrides"
  > & { sections?: unknown; analyses?: unknown },
): PlateItem {
  return {
    slug: node.slug,
    displayName: node.displayName,
    useFor: node.useFor,
    eyebrow: node.eyebrow,
    titleSuffix: node.titleSuffix,
    tokensLight: parseJsonObject(node.tokensLight),
    tokensDark: parseJsonObject(node.tokensDark),
    allowedDirectives: node.allowedDirectives ?? null,
    origin: node.origin === "tenant" ? "tenant" : "platform",
    hidden: node.hidden,
    customized: node.customized,
    overrides: parseOverrides(node.overrides),
    sections: parseContractSections(node.sections),
    analyses: parseContractAnalyses(node.analyses),
  };
}

/** Human summary of a plate's directive availability. */
export function summarizeDirectives(
  allowedDirectives: string[] | null,
): string {
  if (allowedDirectives == null) return "All components";
  if (allowedDirectives.length === 0) return "No components";
  return allowedDirectives.join(", ");
}

// ─── Live-preview sequence guard (U7) ─────────────────────────────────────

export interface PlatePreviewResult {
  /** Monotonically increasing id of the request this response answers. */
  requestId: number;
  /** Compiled HTML; null when validation failed. */
  html: string | null;
  diagnostics: DocumentPlateDiagnostic[];
}

export interface PlatePreviewState {
  /** id of the most recently applied response. */
  appliedRequestId: number;
  /** Last-good HTML — never blanked by a diagnostics response. */
  html: string | null;
  /** Diagnostics from the latest applied response (empty when html is good). */
  diagnostics: DocumentPlateDiagnostic[];
}

export const initialPlatePreviewState: PlatePreviewState = {
  appliedRequestId: 0,
  html: null,
  diagnostics: [],
};

/**
 * Fold a preview response into state, enforcing the U7 contract:
 *  - responses arriving out of order (an earlier requestId) are dropped, so a
 *    late-resolving stale request can never overwrite a newer preview;
 *  - a diagnostics response (html == null) keeps the last-good HTML and
 *    surfaces the diagnostics, so the panel never blanks mid-edit.
 */
export function applyPlatePreviewResult(
  state: PlatePreviewState,
  result: PlatePreviewResult,
): PlatePreviewState {
  if (result.requestId < state.appliedRequestId) return state;
  if (result.html == null) {
    return {
      appliedRequestId: result.requestId,
      html: state.html,
      diagnostics: result.diagnostics,
    };
  }
  return {
    appliedRequestId: result.requestId,
    html: result.html,
    diagnostics: [],
  };
}

// ─── Content contract (THINK-188) ─────────────────────────────────────────

export const PLATE_SECTION_TIERS = [
  "required",
  "required-if-material",
  "suggested",
] as const;

export type PlateSectionTier = (typeof PLATE_SECTION_TIERS)[number];

export const PLATE_SECTION_TIER_LABELS: Record<PlateSectionTier, string> = {
  required: "Required",
  "required-if-material": "Required when data exists",
  suggested: "Suggested",
};

const TIER_RANK: Record<PlateSectionTier, number> = {
  suggested: 0,
  "required-if-material": 1,
  required: 2,
};

/** Tiers an operator may pick for a floor section: the floor tier and up. */
export function tiersAtOrAbove(floor: PlateSectionTier): PlateSectionTier[] {
  return PLATE_SECTION_TIERS.filter((t) => TIER_RANK[t] >= TIER_RANK[floor]);
}

export interface PlateSuggestedWidget {
  kind: string;
  chartType?: string;
}

/** Pristine platform values carried when a floor field is overridden (R13). */
export interface PlateSectionBaseline {
  guidance: string;
  tier: PlateSectionTier;
  suggestedDirectives: PlateSuggestedWidget[] | null;
}

export interface PlateContractSection {
  id: string;
  title: string;
  tier: PlateSectionTier;
  guidance: string;
  suggestedDirectives?: PlateSuggestedWidget[];
  /** "platform" = floor (locked title/remove); "tenant" = addition. */
  source: "platform" | "tenant";
  /** Which fields the tenant patched on a floor section. */
  overridden?: {
    guidance?: boolean;
    tier?: boolean;
    suggestedDirectives?: boolean;
  };
  platformBaseline?: PlateSectionBaseline;
}

export interface PlateContractAnalysis {
  key: string;
  op: string;
  presentation: { directive: string; chartType?: string };
  source: "platform" | "tenant";
}

function isTier(v: unknown): v is PlateSectionTier {
  return (PLATE_SECTION_TIERS as readonly string[]).includes(v as string);
}

/** Parse the annotated AWSJSON contract sections; junk degrades to []. */
export function parseContractSections(value: unknown): PlateContractSection[] {
  {
    const parsed = jsonish(value);
    if (!Array.isArray(parsed)) return [];
    const out: PlateContractSection[] = [];
    for (const entry of parsed) {
      if (!entry || typeof entry !== "object") continue;
      const rec = entry as Record<string, unknown>;
      if (
        typeof rec.id !== "string" ||
        typeof rec.title !== "string" ||
        !isTier(rec.tier) ||
        typeof rec.guidance !== "string"
      ) {
        continue;
      }
      out.push({
        id: rec.id,
        title: rec.title,
        tier: rec.tier,
        guidance: rec.guidance,
        suggestedDirectives: Array.isArray(rec.suggestedDirectives)
          ? (rec.suggestedDirectives as PlateSuggestedWidget[])
          : undefined,
        source: rec.source === "tenant" ? "tenant" : "platform",
        overridden:
          rec.overridden && typeof rec.overridden === "object"
            ? (rec.overridden as PlateContractSection["overridden"])
            : undefined,
        platformBaseline:
          rec.platformBaseline && typeof rec.platformBaseline === "object"
            ? (rec.platformBaseline as PlateSectionBaseline)
            : undefined,
      });
    }
    return out;
  }
}

/** Parse the annotated AWSJSON contract analyses; junk degrades to []. */
export function parseContractAnalyses(value: unknown): PlateContractAnalysis[] {
  {
    const parsed = jsonish(value);
    if (!Array.isArray(parsed)) return [];
    const out: PlateContractAnalysis[] = [];
    for (const entry of parsed) {
      if (!entry || typeof entry !== "object") continue;
      const rec = entry as Record<string, unknown>;
      const presentation =
        rec.presentation && typeof rec.presentation === "object"
          ? (rec.presentation as { directive?: unknown; chartType?: unknown })
          : null;
      if (
        typeof rec.key !== "string" ||
        typeof rec.op !== "string" ||
        typeof presentation?.directive !== "string"
      ) {
        continue;
      }
      out.push({
        key: rec.key,
        op: rec.op,
        presentation: {
          directive: presentation.directive,
          chartType:
            typeof presentation.chartType === "string"
              ? presentation.chartType
              : undefined,
        },
        source: rec.source === "tenant" ? "tenant" : "platform",
      });
    }
    return out;
  }
}

/**
 * Client copy of the compositor's heading-slug transform (THINK-183 KTD6 /
 * THINK-188 KTD6). The server rule `headingSlug(title) === id` remains the
 * authority at save; this copy powers as-you-type id derivation and duplicate
 * detection. Pinned against the server by parity tests on both sides.
 */
export function headingSlugClient(text: string): string {
  return (
    text
      .toLowerCase()
      .replace(/&[a-z#0-9]+;/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 64) || "section"
  );
}

// ─── Contract editor row state (THINK-188 U5) ─────────────────────────────

export interface SectionRowState {
  /** Stable React key (survives title edits). */
  rowKey: string;
  title: string;
  tier: PlateSectionTier;
  guidance: string;
  suggestedDirectives: PlateSuggestedWidget[];
  source: "platform" | "tenant";
  /** Floor rows carry the pristine platform values for divergence + revert. */
  baseline?: PlateSectionBaseline & { title: string };
}

/** Derived id for a row (floor rows keep their fixed id via baseline title). */
export function sectionRowId(row: SectionRowState): string {
  return headingSlugClient(
    row.source === "platform" && row.baseline ? row.baseline.title : row.title,
  );
}

let rowSeq = 0;
export function nextRowKey(): string {
  rowSeq += 1;
  return `row-${rowSeq}`;
}

/** Build editor rows from a parsed contract (edit mode). */
export function sectionRowsFromContract(
  sections: PlateContractSection[],
  ownAll: boolean,
): SectionRowState[] {
  return sections.map((section) => ({
    rowKey: nextRowKey(),
    title: section.title,
    tier: section.tier,
    guidance: section.guidance,
    suggestedDirectives: section.suggestedDirectives ?? [],
    source: ownAll ? "tenant" : section.source,
    baseline:
      !ownAll && section.source === "platform"
        ? {
            title: section.title,
            guidance: section.platformBaseline?.guidance ?? section.guidance,
            tier: section.platformBaseline?.tier ?? section.tier,
            suggestedDirectives:
              section.platformBaseline !== undefined
                ? section.platformBaseline.suggestedDirectives
                : (section.suggestedDirectives ?? null),
          }
        : undefined,
  }));
}

/** Duplicate-id detection across all rows (AE6). Returns offending rowKeys. */
export function duplicateSectionRowKeys(rows: SectionRowState[]): Set<string> {
  const byId = new Map<string, string[]>();
  for (const row of rows) {
    const id = sectionRowId(row);
    byId.set(id, [...(byId.get(id) ?? []), row.rowKey]);
  }
  const dupes = new Set<string>();
  for (const keys of byId.values()) {
    if (keys.length > 1) for (const k of keys) dupes.add(k);
  }
  return dupes;
}

export interface AnalysisRowState {
  rowKey: string;
  key: string;
  op: string;
  presentation: { directive: string; chartType?: string };
  source: "platform" | "tenant";
}

export function analysisRowsFromContract(
  analyses: PlateContractAnalysis[],
  ownAll: boolean,
): AnalysisRowState[] {
  return analyses.map((a) => ({
    rowKey: nextRowKey(),
    key: a.key,
    op: a.op,
    presentation: a.presentation,
    source: ownAll ? "tenant" : a.source,
  }));
}

// ─── Contract payload assembly (draft preview + save share this) ──────────

export interface ContractPayload {
  sections?: string;
  analyses?: string;
  sectionOverrides?: string;
}

function widgetsEqual(
  a: PlateSuggestedWidget[] | null | undefined,
  b: PlateSuggestedWidget[] | null | undefined,
): boolean {
  // An empty list and "none declared" are the same thing.
  const norm = (v: PlateSuggestedWidget[] | null | undefined) =>
    v && v.length > 0 ? JSON.stringify(v) : null;
  return norm(a) === norm(b);
}

/**
 * Assemble the wire contract payload (THINK-188 KTD1). Platform plates send
 * additions + per-floor-field overrides (only fields that diverge from the
 * platform baseline); tenant plates send the full contract. The save path
 * ALWAYS sends this whole payload — the server rebuilds row config from
 * input, so omitting it on a style-only save would wipe stored deltas.
 */
export function buildContractPayload(
  rows: SectionRowState[],
  analyses: AnalysisRowState[],
  isPlatform: boolean,
): ContractPayload {
  const toSection = (row: SectionRowState) => ({
    id: sectionRowId(row),
    title: row.title.trim(),
    tier: row.tier,
    guidance: row.guidance.trim(),
    ...(row.suggestedDirectives.length > 0
      ? { suggestedDirectives: row.suggestedDirectives }
      : {}),
  });
  if (!isPlatform) {
    return {
      sections: JSON.stringify(rows.map(toSection)),
      analyses: JSON.stringify(
        analyses.map((a) => ({
          key: a.key,
          op: a.op,
          presentation: a.presentation,
        })),
      ),
    };
  }
  const additions = rows.filter((r) => r.source === "tenant");
  const overrides: Record<string, Record<string, unknown>> = {};
  for (const row of rows) {
    if (row.source !== "platform" || !row.baseline) continue;
    const patch: Record<string, unknown> = {};
    if (row.guidance.trim() !== row.baseline.guidance) {
      patch.guidance = row.guidance.trim();
    }
    if (row.tier !== row.baseline.tier) patch.tier = row.tier;
    if (
      !widgetsEqual(row.suggestedDirectives, row.baseline.suggestedDirectives)
    ) {
      patch.suggestedDirectives = row.suggestedDirectives;
    }
    if (Object.keys(patch).length > 0) overrides[sectionRowId(row)] = patch;
  }
  const additionAnalyses = analyses.filter((a) => a.source === "tenant");
  return {
    sections: JSON.stringify(additions.map(toSection)),
    analyses: JSON.stringify(
      additionAnalyses.map((a) => ({
        key: a.key,
        op: a.op,
        presentation: a.presentation,
      })),
    ),
    sectionOverrides: JSON.stringify(overrides),
  };
}

// ─── Analysis template catalog (THINK-188 U6 / KTD5) ──────────────────────
//
// Duplicated-as-data from the server op registry (document-analyses/v1 in
// packages/api/src/lib/artifacts/document-analyses.ts) — the established
// client-vocabulary pattern (see PLATE_DIRECTIVE_KINDS above). The op list is
// pinned on both sides against the same literals, so registry drift breaks a
// test loudly rather than silently skewing the picker.

export interface PlateAnalysisTemplate {
  op: string;
  label: string;
  /** Operator-terms description of what the analysis needs and shows. */
  description: string;
  /** Default presentation; chart templates fall back to stats on restricted plates. */
  defaultPresentation: { directive: "chart" | "stats"; chartType?: string };
  /** Chart types that suit this op (chart presentation only). */
  chartTypes?: string[];
}

export const PLATE_ANALYSIS_TEMPLATES: readonly PlateAnalysisTemplate[] = [
  {
    op: "funnel_conversion",
    label: "Funnel with conversion rates",
    description:
      "The agent supplies ordered stage counts (e.g. Leads → Qualified → Won); the platform computes stage-to-stage and overall conversion.",
    defaultPresentation: { directive: "chart", chartType: "funnel" },
    chartTypes: ["funnel", "bar"],
  },
  {
    op: "ratio_pct",
    label: "Percentage of target",
    description:
      "One number against another — quota attainment, adoption rate, budget used. The platform computes the percentage.",
    defaultPresentation: { directive: "stats" },
    chartTypes: ["meter", "donut"],
  },
  {
    op: "variance_vs_prior",
    label: "Vs-prior comparison",
    description:
      "A current value against the prior period — the platform computes the change and % change.",
    defaultPresentation: { directive: "stats" },
    chartTypes: ["bar"],
  },
  {
    op: "group_count",
    label: "Count by category",
    description:
      "A list of category labels (deal stages, ticket types) — the platform counts each group.",
    defaultPresentation: { directive: "chart", chartType: "bar" },
    chartTypes: ["bar", "donut"],
  },
  {
    op: "top_n",
    label: "Top items by value",
    description:
      "Labeled values (accounts, products) — the platform ranks them and keeps the top N.",
    defaultPresentation: { directive: "chart", chartType: "bar" },
    chartTypes: ["bar"],
  },
  {
    op: "trend",
    label: "Trend over time",
    description:
      "An ordered series of at least three points — the platform computes direction and net change.",
    defaultPresentation: { directive: "chart", chartType: "line" },
    chartTypes: ["line", "sparkline", "bar"],
  },
] as const;
