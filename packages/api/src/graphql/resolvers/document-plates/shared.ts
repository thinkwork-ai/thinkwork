/**
 * Plate registry GraphQL surface (THINK-153 U3): shared tenant resolution,
 * draft-config bounds, the KTD7 three-gate validation, and the plate →
 * GraphQL mapping.
 *
 * Validation gates (all server-side, nothing persists on failure):
 *   1. token-name/value guard over the R7 vocabulary (plate-registry.ts)
 *   2. compile the per-plate exemplar with the WOULD-BE resolved tokens
 *   3. full DocSpector preflight on the compiled output
 */

import { GraphQLError } from "graphql";
import type { GraphQLContext } from "../../context.js";
import { ANALYSIS_OPS } from "../../../lib/artifacts/document-analyses.js";
import {
  compileDocument,
  headingSlug,
} from "../../../lib/artifacts/document-compositor.js";
import {
  ANALYSIS_PRESENTATION_DIRECTIVES,
  CHART_TYPES,
  DIRECTIVE_KINDS,
} from "../../../lib/artifacts/document-directives.js";
import { runDocumentPreflight } from "../../../lib/artifacts/document-preflight.js";
import {
  getPlatformPlate,
  PLATE_SECTION_TIERS,
} from "../../../lib/artifacts/plate-definitions.js";
import {
  buildPlateExemplar,
  validatePlatePalette,
  type ResolvedPlate,
} from "../../../lib/artifacts/plate-registry.js";
import { requireTenantAdmin, requireTenantMember } from "../core/authz.js";
import { resolveCallerTenantId } from "../core/resolve-auth-user.js";

export function badInput(message: string): GraphQLError {
  return new GraphQLError(message, {
    extensions: { code: "BAD_USER_INPUT" },
  });
}

export function notFound(message: string): GraphQLError {
  return new GraphQLError(message, { extensions: { code: "NOT_FOUND" } });
}

async function resolveTenantId(
  ctx: GraphQLContext,
  requestedTenantId?: string | null,
): Promise<string> {
  const callerTenantId =
    ctx.auth?.tenantId ?? (await resolveCallerTenantId(ctx));
  const tenantId = requestedTenantId ?? callerTenantId;
  if (!tenantId) {
    throw badInput("Unable to resolve tenant for document plate request");
  }
  return tenantId;
}

/** Member-gated read; returns whether the caller is an operator. */
export async function requirePlateReader(
  ctx: GraphQLContext,
  requestedTenantId?: string | null,
): Promise<{ tenantId: string; isOperator: boolean }> {
  const tenantId = await resolveTenantId(ctx, requestedTenantId);
  const role = await requireTenantMember(ctx, tenantId);
  return { tenantId, isOperator: role === "owner" || role === "admin" };
}

/** Operator-gated write. */
export async function requirePlateAdmin(
  ctx: GraphQLContext,
  requestedTenantId?: string | null,
): Promise<string> {
  const tenantId = await resolveTenantId(ctx, requestedTenantId);
  await requireTenantAdmin(ctx, tenantId);
  return tenantId;
}

// ---------------------------------------------------------------------------
// Draft-config bounds (R7 + cost control): parsed BEFORE any compile.
// ---------------------------------------------------------------------------

const MAX_TEXT_FIELD = 200;
const MAX_PALETTE_ENTRIES = 24;
const MAX_SECTIONS = 24;
const MAX_ANALYSES = 12;
const MAX_GUIDANCE = 500;
const MAX_SUGGESTED_DIRECTIVES = 4;
const CONTRACT_SLUG_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;

export type PlateDraftSectionTier =
  | "required"
  | "required-if-material"
  | "suggested";

export interface PlateDraftSection {
  id: string;
  title: string;
  tier: PlateDraftSectionTier;
  guidance: string;
  suggestedDirectives?: Array<{ kind: string; chartType?: string }>;
}

export interface PlateDraftAnalysis {
  key: string;
  op: string;
  params?: Record<string, unknown>;
  presentation: { directive: string; chartType?: string };
  source?: "model-supplied";
}

export interface PlateDraftConfig {
  displayName?: string;
  useFor?: string;
  eyebrow?: string;
  titleSuffix?: string;
  paletteLight?: Record<string, string>;
  paletteDark?: Record<string, string>;
  allowedDirectives?: string[];
  sections?: PlateDraftSection[];
  analyses?: PlateDraftAnalysis[];
}

function boundedText(value: unknown, field: string): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") throw badInput(`${field} must be a string`);
  const trimmed = value.trim();
  if (trimmed.length > MAX_TEXT_FIELD) {
    throw badInput(`${field} must be ≤${MAX_TEXT_FIELD} characters`);
  }
  return trimmed || undefined;
}

/** Parse an AWSJSON palette map with entry/length caps (pre-compile bound). */
export function boundedPalette(
  value: unknown,
  field: string,
): Record<string, string> | undefined {
  if (value === undefined || value === null) return undefined;
  const parsed = typeof value === "string" ? JSON.parse(value) : value;
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw badInput(`${field} must be a JSON object of token → value`);
  }
  const entries = Object.entries(parsed as Record<string, unknown>);
  if (entries.length > MAX_PALETTE_ENTRIES) {
    throw badInput(`${field} must have ≤${MAX_PALETTE_ENTRIES} entries`);
  }
  const out: Record<string, string> = {};
  for (const [name, raw] of entries) {
    if (typeof raw !== "string" || name.length > 64 || raw.length > 200) {
      throw badInput(`${field}: token values must be strings ≤200 chars`);
    }
    out[name] = raw;
  }
  return out;
}

export function boundedDirectives(value: unknown): string[] | undefined {
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value)) {
    throw badInput("allowedDirectives must be a list of directive kinds");
  }
  const kinds = value.filter(
    (k): k is string => typeof k === "string" && DIRECTIVE_KINDS.includes(k),
  );
  const unknown = value.filter(
    (k) => typeof k !== "string" || !DIRECTIVE_KINDS.includes(k),
  );
  if (unknown.length > 0) {
    throw badInput(
      `Unknown directive kinds: ${unknown.join(", ")}. Known kinds: ${DIRECTIVE_KINDS.join(", ")}.`,
    );
  }
  return kinds;
}

function asObject(v: unknown): Record<string, unknown> | null {
  return v !== null && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null;
}

/**
 * AWSJSON tolerance: contract fields arrive as JSON strings over the wire
 * (like palettes) but as plain values from internal callers/tests. A parse
 * failure falls through to the bound's own shape error.
 */
export function parseJsonish(v: unknown): unknown {
  if (typeof v !== "string") return v;
  try {
    return JSON.parse(v);
  } catch {
    return v;
  }
}

function boundedSuggestedDirectives(
  value: unknown,
  where: string,
): Array<{ kind: string; chartType?: string }> | undefined {
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value)) {
    throw badInput(`${where}: suggestedDirectives must be a list`);
  }
  if (value.length > MAX_SUGGESTED_DIRECTIVES) {
    throw badInput(
      `${where}: at most ${MAX_SUGGESTED_DIRECTIVES} suggested directives per section`,
    );
  }
  const out: Array<{ kind: string; chartType?: string }> = [];
  for (const entry of value) {
    const rec = asObject(entry);
    const kind = rec?.kind;
    if (typeof kind !== "string" || !DIRECTIVE_KINDS.includes(kind)) {
      throw badInput(
        `${where}: unknown suggested directive kind ${JSON.stringify(kind)}. Known kinds: ${DIRECTIVE_KINDS.join(", ")}.`,
      );
    }
    const chartType = rec?.chartType;
    if (chartType !== undefined) {
      if (
        typeof chartType !== "string" ||
        !(CHART_TYPES as readonly string[]).includes(chartType)
      ) {
        throw badInput(
          `${where}: unknown chart type ${JSON.stringify(chartType)}. Known types: ${CHART_TYPES.join(", ")}.`,
        );
      }
      out.push({ kind, chartType });
    } else {
      out.push({ kind });
    }
  }
  return out;
}

/** Bound and validate a section manifest (THINK-183 R13/KTD6). */
export function boundedSections(
  value: unknown,
): PlateDraftSection[] | undefined {
  value = parseJsonish(value);
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value)) {
    throw badInput("sections must be a list of section manifest entries");
  }
  if (value.length > MAX_SECTIONS) {
    throw badInput(`sections must have ≤${MAX_SECTIONS} entries`);
  }
  const out: PlateDraftSection[] = [];
  const seen = new Set<string>();
  for (const [i, entry] of value.entries()) {
    const rec = asObject(entry);
    if (!rec) throw badInput(`sections[${i}] must be an object`);
    const id = rec.id;
    if (typeof id !== "string" || !CONTRACT_SLUG_RE.test(id)) {
      throw badInput(
        `sections[${i}].id must be a lowercase ASCII slug (a-z, 0-9, hyphens, ≤64 chars)`,
      );
    }
    if (seen.has(id)) {
      throw badInput(`sections has a duplicate id "${id}"`);
    }
    seen.add(id);
    const title = boundedText(rec.title, `sections[${i}].title`);
    if (!title) throw badInput(`sections[${i}].title is required`);
    // KTD6: the diagnostic tells the model "author a heading titled X" — that
    // only repairs the miss if X's heading slug IS the section id.
    if (headingSlug(title) !== id) {
      throw badInput(
        `sections[${i}]: title "${title}" slugs to "${headingSlug(title)}", not "${id}". The section id must equal the heading slug of its title so authoring the title satisfies the manifest.`,
      );
    }
    const tier = rec.tier;
    if (
      typeof tier !== "string" ||
      !(PLATE_SECTION_TIERS as readonly string[]).includes(tier)
    ) {
      throw badInput(
        `sections[${i}].tier must be one of: ${PLATE_SECTION_TIERS.join(", ")}`,
      );
    }
    const guidance = rec.guidance;
    if (typeof guidance !== "string" || guidance.trim() === "") {
      throw badInput(`sections[${i}].guidance is required`);
    }
    if (guidance.length > MAX_GUIDANCE) {
      throw badInput(
        `sections[${i}].guidance must be ≤${MAX_GUIDANCE} characters`,
      );
    }
    out.push({
      id,
      title,
      tier: tier as PlateDraftSectionTier,
      guidance: guidance.trim(),
      suggestedDirectives: boundedSuggestedDirectives(
        rec.suggestedDirectives,
        `sections[${i}]`,
      ),
    });
  }
  return out;
}

/** Floor-model tier rank (THINK-188 KTD2): overrides may only raise. */
const TIER_RANK: Record<string, number> = {
  suggested: 0,
  "required-if-material": 1,
  required: 2,
};

export interface PlateDraftSectionOverride {
  guidance?: string;
  tier?: PlateDraftSectionTier;
  suggestedDirectives?: Array<{ kind: string; chartType?: string }>;
}

/**
 * Bound and validate floor-section overrides on a platform plate (THINK-188
 * R5/R6). Keys must name the platform floor's section ids; tier patches may
 * raise but never lower; the patch shape carries no id/title, so removal and
 * retitle stay unrepresentable.
 */
export function boundedSectionOverrides(
  value: unknown,
  platformSections: ReadonlyArray<{ id: string; tier: string }>,
): Record<string, PlateDraftSectionOverride> | undefined {
  value = parseJsonish(value);
  if (value === undefined || value === null) return undefined;
  const rec = asObject(value);
  if (!rec) {
    throw badInput(
      "sectionOverrides must be an object keyed by platform section id",
    );
  }
  const floorIds = platformSections.map((s) => s.id);
  const out: Record<string, PlateDraftSectionOverride> = {};
  for (const [id, raw] of Object.entries(rec)) {
    const floor = platformSections.find((s) => s.id === id);
    if (!floor) {
      throw badInput(
        `sectionOverrides["${id}"]: not a platform floor section of this plate. Floor sections: ${floorIds.join(", ") || "(none)"}.`,
      );
    }
    const patch = asObject(raw);
    if (!patch) {
      throw badInput(`sectionOverrides["${id}"] must be an object`);
    }
    const allowed = new Set(["guidance", "tier", "suggestedDirectives"]);
    for (const key of Object.keys(patch)) {
      if (!allowed.has(key)) {
        throw badInput(
          `sectionOverrides["${id}"].${key} is not an overridable field. Floor sections allow: guidance, tier (raise only), suggestedDirectives.`,
        );
      }
    }
    const override: PlateDraftSectionOverride = {};
    if (patch.guidance !== undefined) {
      if (typeof patch.guidance !== "string" || patch.guidance.trim() === "") {
        throw badInput(`sectionOverrides["${id}"].guidance must be non-empty`);
      }
      if (patch.guidance.length > MAX_GUIDANCE) {
        throw badInput(
          `sectionOverrides["${id}"].guidance must be ≤${MAX_GUIDANCE} characters`,
        );
      }
      override.guidance = patch.guidance.trim();
    }
    if (patch.tier !== undefined) {
      if (
        typeof patch.tier !== "string" ||
        !(PLATE_SECTION_TIERS as readonly string[]).includes(patch.tier)
      ) {
        throw badInput(
          `sectionOverrides["${id}"].tier must be one of: ${PLATE_SECTION_TIERS.join(", ")}`,
        );
      }
      if (TIER_RANK[patch.tier] < TIER_RANK[floor.tier]) {
        throw badInput(
          `sectionOverrides["${id}"].tier cannot lower the platform floor: "${id}" is ${floor.tier} on the platform plate (floor rule — tiers may only be raised, or cleared back to the floor).`,
        );
      }
      override.tier = patch.tier as PlateDraftSectionTier;
    }
    if (patch.suggestedDirectives !== undefined) {
      override.suggestedDirectives = boundedSuggestedDirectives(
        patch.suggestedDirectives,
        `sectionOverrides["${id}"]`,
      );
    }
    if (Object.keys(override).length > 0) out[id] = override;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/** Bound and validate declared analyses (THINK-183 R13/AE5). */
export function boundedAnalyses(
  value: unknown,
): PlateDraftAnalysis[] | undefined {
  value = parseJsonish(value);
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value)) {
    throw badInput("analyses must be a list of declared analyses");
  }
  if (value.length > MAX_ANALYSES) {
    throw badInput(`analyses must have ≤${MAX_ANALYSES} entries`);
  }
  const out: PlateDraftAnalysis[] = [];
  const seen = new Set<string>();
  for (const [i, entry] of value.entries()) {
    const rec = asObject(entry);
    if (!rec) throw badInput(`analyses[${i}] must be an object`);
    const key = rec.key;
    if (typeof key !== "string" || !CONTRACT_SLUG_RE.test(key)) {
      throw badInput(
        `analyses[${i}].key must be a lowercase ASCII slug (a-z, 0-9, hyphens, ≤64 chars)`,
      );
    }
    if (seen.has(key)) {
      throw badInput(`analyses has a duplicate key "${key}"`);
    }
    seen.add(key);
    const op = rec.op;
    if (typeof op !== "string" || !ANALYSIS_OPS.includes(op)) {
      throw badInput(
        `analyses[${i}].op ${JSON.stringify(op)} is not a registered analysis op. Available ops: ${ANALYSIS_OPS.join(", ")}.`,
      );
    }
    const presentation = asObject(rec.presentation);
    const directive = presentation?.directive;
    if (
      typeof directive !== "string" ||
      !(ANALYSIS_PRESENTATION_DIRECTIVES as readonly string[]).includes(
        directive,
      )
    ) {
      throw badInput(
        `analyses[${i}].presentation.directive must be one of: ${ANALYSIS_PRESENTATION_DIRECTIVES.join(", ")}`,
      );
    }
    const chartType = presentation?.chartType;
    if (
      chartType !== undefined &&
      (typeof chartType !== "string" ||
        !(CHART_TYPES as readonly string[]).includes(chartType))
    ) {
      throw badInput(
        `analyses[${i}].presentation.chartType must be one of: ${CHART_TYPES.join(", ")}`,
      );
    }
    const source = rec.source;
    if (source !== undefined && source !== "model-supplied") {
      throw badInput(
        `analyses[${i}].source must be "model-supplied" (binding-backed sources are not available yet)`,
      );
    }
    const params = rec.params;
    if (params !== undefined && asObject(params) === null) {
      throw badInput(`analyses[${i}].params must be an object`);
    }
    out.push({
      key,
      op,
      params:
        params !== undefined ? (params as Record<string, unknown>) : undefined,
      presentation:
        chartType !== undefined
          ? { directive, chartType: chartType as string }
          : { directive },
      source: "model-supplied",
    });
  }
  return out;
}

export function parseDraftConfig(raw: unknown): PlateDraftConfig {
  if (raw === null || raw === undefined) return {};
  if (typeof raw !== "object" || Array.isArray(raw)) {
    throw badInput("draftConfig must be an object");
  }
  const c = raw as Record<string, unknown>;
  return {
    displayName: boundedText(c.displayName, "displayName"),
    useFor: boundedText(c.useFor, "useFor"),
    eyebrow: boundedText(c.eyebrow, "eyebrow"),
    titleSuffix: boundedText(c.titleSuffix, "titleSuffix"),
    paletteLight: boundedPalette(c.paletteLight, "paletteLight"),
    paletteDark: boundedPalette(c.paletteDark, "paletteDark"),
    allowedDirectives: boundedDirectives(c.allowedDirectives),
    sections: boundedSections(c.sections),
    analyses: boundedAnalyses(c.analyses),
  };
}

// ---------------------------------------------------------------------------
// Three-gate validation (KTD7)
// ---------------------------------------------------------------------------

export interface PlateValidationDiagnostic {
  code: string;
  message: string;
}

/**
 * Run the three gates against a candidate ResolvedPlate. Returns compiled
 * HTML on success (reused by preview) or diagnostics on failure.
 */
export function validateCandidatePlate(
  candidate: ResolvedPlate,
  rawPalettes: {
    light?: Record<string, string>;
    dark?: Record<string, string>;
  },
):
  | { ok: true; html: string }
  | { ok: false; diagnostics: PlateValidationDiagnostic[] } {
  // Gate 1: token guard over the RAW input palettes (the resolved candidate
  // is pre-filtered; guarding the raw maps reports the offending entries).
  const diagnostics: PlateValidationDiagnostic[] = [];
  for (const [label, palette] of [
    ["paletteLight", rawPalettes.light],
    ["paletteDark", rawPalettes.dark],
  ] as const) {
    if (!palette) continue;
    const verdict = validatePlatePalette(palette);
    if (!verdict.ok) {
      diagnostics.push(
        ...verdict.errors.map((message) => ({
          code: "PLATE_TOKEN_INVALID",
          message: `${label}: ${message}`,
        })),
      );
    }
  }
  // Gate 1b (THINK-183 KTD11 second half): tw:analysis itself bypasses
  // per-plate directive gating as a structural directive, but the
  // presentation kind an analysis renders THROUGH must be allowed — a plate
  // that excludes charts cannot declare a chart-presented analysis.
  if (candidate.allowedDirectives !== "all") {
    const allowed = candidate.allowedDirectives;
    for (const analysis of candidate.analyses ?? []) {
      if (!allowed.includes(analysis.presentation.directive)) {
        diagnostics.push({
          code: "PLATE_ANALYSIS_PRESENTATION_RESTRICTED",
          message: `Analysis "${analysis.key}" presents through "tw:${analysis.presentation.directive}", which this plate's allowedDirectives excludes. Allowed kinds: ${allowed.join(", ") || "(none)"}.`,
        });
      }
    }
  }
  if (diagnostics.length > 0) return { ok: false, diagnostics };

  // Gate 2: compile the per-plate exemplar with the would-be resolved tokens.
  const exemplar = buildPlateExemplar(candidate);
  const compiled = compileDocument({
    plate: candidate,
    title: exemplar.title,
    abstract: exemplar.abstract,
    markdownBody: exemplar.markdownBody,
  });
  if (!compiled.ok) {
    return {
      ok: false,
      diagnostics: compiled.diagnostics.map((d) => ({
        code: d.code,
        message: d.message,
      })),
    };
  }

  // Gate 3: full DocSpector preflight on the compiled output.
  const preflight = runDocumentPreflight({
    renderHtml: compiled.renderHtml,
    digestMarkdown: exemplar.markdownBody,
  });
  if (!preflight.ok) {
    return {
      ok: false,
      diagnostics: preflight.diagnostics.map((d) => ({
        code: `PREFLIGHT:${d.code}`,
        message: d.message,
      })),
    };
  }

  return { ok: true, html: compiled.renderHtml };
}

// ---------------------------------------------------------------------------
// GraphQL mapping
// ---------------------------------------------------------------------------

/**
 * Annotate the resolved contract with floor provenance (THINK-188 R5/U4):
 * each entry carries `source` ("platform" floor vs "tenant" addition) and,
 * for floor sections, an `overridden` flag map naming which fields the
 * tenant patched — the editor's lock/divergence/revert affordances key on it.
 */
function annotatedSections(plate: ResolvedPlate): unknown[] | null {
  if (!plate.sections || plate.sections.length === 0) return null;
  const floorDef =
    plate.origin === "platform" ? getPlatformPlate(plate.slug) : null;
  const floor = new Map((floorDef?.sections ?? []).map((s) => [s.id, s]));
  return plate.sections.map((section) => {
    const base = floor.get(section.id);
    if (!base) return { ...section, source: "tenant" };
    const overridden: Record<string, boolean> = {};
    if (section.guidance !== base.guidance) overridden.guidance = true;
    if (section.tier !== base.tier) overridden.tier = true;
    if (
      JSON.stringify(section.suggestedDirectives ?? null) !==
      JSON.stringify(base.suggestedDirectives ?? null)
    ) {
      overridden.suggestedDirectives = true;
    }
    return {
      ...section,
      source: "platform",
      ...(Object.keys(overridden).length > 0
        ? {
            overridden,
            // The pristine platform values, so the editor's per-field
            // revert-to-platform affordance (R13) can restore them locally.
            platformBaseline: {
              guidance: base.guidance,
              tier: base.tier,
              suggestedDirectives: base.suggestedDirectives ?? null,
            },
          }
        : {}),
    };
  });
}

function annotatedAnalyses(plate: ResolvedPlate): unknown[] | null {
  if (!plate.analyses || plate.analyses.length === 0) return null;
  const floorDef =
    plate.origin === "platform" ? getPlatformPlate(plate.slug) : null;
  const floorKeys = new Set((floorDef?.analyses ?? []).map((a) => a.key));
  return plate.analyses.map((analysis) => ({
    ...analysis,
    source: floorKeys.has(analysis.key) ? "platform" : "tenant",
  }));
}

export function plateToGraphql(
  plate: ResolvedPlate,
  overrides: Record<string, unknown> | null,
): Record<string, unknown> {
  const sections = annotatedSections(plate);
  const analyses = annotatedAnalyses(plate);
  return {
    slug: plate.slug,
    displayName: plate.displayName,
    useFor: plate.useFor,
    eyebrow: plate.eyebrow,
    titleSuffix: plate.titleSuffix,
    tokensLight: JSON.stringify(plate.tokensLight),
    tokensDark: JSON.stringify(plate.tokensDark),
    allowedDirectives:
      plate.allowedDirectives === "all" ? null : [...plate.allowedDirectives],
    origin: plate.origin,
    hidden: plate.hidden,
    customized: plate.customized,
    overrides: overrides ? JSON.stringify(overrides) : null,
    sections: sections ? JSON.stringify(sections) : null,
    analyses: analyses ? JSON.stringify(analyses) : null,
  };
}

// ---------------------------------------------------------------------------
// Preview rate limiting: member-reachable compile+preflight must not be an
// unthrottled cost vector. Per-container sliding window keyed by tenant+user.
// ---------------------------------------------------------------------------

const PREVIEW_WINDOW_MS = 60_000;
const PREVIEW_MAX_PER_WINDOW = 30;
const previewHits = new Map<string, number[]>();

export function enforcePreviewRateLimit(
  tenantId: string,
  callerKey: string,
  now: number = Date.now(),
): void {
  const key = `${tenantId}:${callerKey}`;
  const hits = (previewHits.get(key) ?? []).filter(
    (t) => now - t < PREVIEW_WINDOW_MS,
  );
  if (hits.length >= PREVIEW_MAX_PER_WINDOW) {
    throw new GraphQLError(
      "Plate preview rate limit exceeded — retry in a minute",
      {
        extensions: { code: "RATE_LIMITED" },
      },
    );
  }
  hits.push(now);
  previewHits.set(key, hits);
}
