/**
 * Plate registry (THINK-153): resolution, token guard, and exemplar builder.
 *
 * One resolution path (KTD2): `resolvePlate` merges platform plate definition
 * → tenant document palette → per-plate tenant overrides into a ResolvedPlate
 * the compositor consumes. The same function serves emission, save-time
 * validation, preview, and the dispatch-payload plate list — one code path,
 * no drift.
 *
 * Layering rules:
 * - `origin: "tenant"` rows are full definitions; a tenant row whose slug
 *   collides with a platform plate SHADOWS the platform definition (KTD1).
 * - `origin: "platform_override"` rows carry deltas merged over the platform
 *   definition (R4: token overrides + hidden; save enforces the field set).
 * - The tenant document palette (tenant_settings.features.documentPalette)
 *   sits beneath every plate's own palette overrides (R8).
 *
 * Defense in depth: stored token maps are re-filtered through the guard at
 * resolution time, so a row that predates a guard tightening can never leak
 * an unsafe value into compiled CSS.
 */

import { getDb } from "@thinkwork/database-pg";
import {
  documentPlates,
  tenantSettings,
  type DocumentPlateConfig,
  type DocumentPlateOrigin,
} from "@thinkwork/database-pg/schema";
import { and, eq } from "drizzle-orm";
import { ANALYSIS_OPS, getAnalysisOp } from "./document-analyses.js";
import {
  ANALYSIS_PRESENTATION_DIRECTIVES,
  CHART_TYPES,
  DIRECTIVE_KINDS,
} from "./document-directives.js";
import {
  getPlatformPlate,
  PLATFORM_PLATES,
  PLATE_SECTION_TIERS,
  type PlateAnalysisSpec,
  type PlateDefinition,
  type PlatePalette,
  type PlateSectionSpec,
  type PlateSectionTier,
  type PlateSuggestedDirective,
} from "./plate-definitions.js";

// ---------------------------------------------------------------------------
// Token guard (R7) — server port of apps/web/src/applets/theme-tokens.ts
// ---------------------------------------------------------------------------

/** The plate CSS custom-property vocabulary (R7). Nothing else is accepted. */
export const PLATE_TOKEN_VOCABULARY = [
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

const VOCABULARY_SET: ReadonlySet<string> = new Set(PLATE_TOKEN_VOCABULARY);

const SAFE_TOKEN_NAME = /^--[a-z0-9-]+$/i;
const UNSAFE_TOKEN_VALUE =
  /[{};<>]|url\s*\(|expression\s*\(|@import|javascript:/i;

export function isSafePlateTokenValue(value: string): boolean {
  if (!value || value.length > 180) return false;
  return !UNSAFE_TOKEN_VALUE.test(value);
}

export interface PaletteValidation {
  ok: boolean;
  /** Model/operator-actionable messages, one per offending entry. */
  errors: string[];
}

/** Validate a palette map against the vocabulary and value guard (R7/AE3). */
export function validatePlatePalette(
  palette: Record<string, unknown>,
): PaletteValidation {
  const errors: string[] = [];
  for (const [name, value] of Object.entries(palette)) {
    if (!SAFE_TOKEN_NAME.test(name) || !VOCABULARY_SET.has(name)) {
      errors.push(
        `Unknown palette token "${name}". Allowed tokens: ${PLATE_TOKEN_VOCABULARY.join(", ")}.`,
      );
      continue;
    }
    if (typeof value !== "string" || !isSafePlateTokenValue(value)) {
      errors.push(
        `Token "${name}" has an unsafe or invalid value. Values must be plain CSS values ≤180 chars with no url(), expression(), @import, javascript:, braces, or angle brackets.`,
      );
    }
  }
  return { ok: errors.length === 0, errors };
}

/** Keep only vocabulary tokens with safe values (resolution-time re-filter). */
function filterPalette(palette: unknown): Record<string, string> {
  if (
    palette === null ||
    typeof palette !== "object" ||
    Array.isArray(palette)
  ) {
    return {};
  }
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(
    palette as Record<string, unknown>,
  )) {
    if (!SAFE_TOKEN_NAME.test(name) || !VOCABULARY_SET.has(name)) continue;
    if (typeof value !== "string" || !isSafePlateTokenValue(value)) continue;
    out[name] = value;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Resolution (KTD2)
// ---------------------------------------------------------------------------

export interface ResolvedPlate {
  slug: string;
  displayName: string;
  useFor: string;
  eyebrow: string;
  titleSuffix: string;
  /** Effective CSS custom-property overrides (may be empty = base defaults). */
  tokensLight: Record<string, string>;
  tokensDark: Record<string, string>;
  /** Directive kinds documents in this plate may use; "all" = unrestricted. */
  allowedDirectives: readonly string[] | "all";
  /** Content contract: tiered section manifest (THINK-183; absent = none). */
  sections?: readonly PlateSectionSpec[];
  /** Content contract: declared analyses (THINK-183; absent = none). */
  analyses?: readonly PlateAnalysisSpec[];
  /** "platform" (code-defined, possibly overridden) or "tenant" (row-owned). */
  origin: "platform" | "tenant";
  hidden: boolean;
  /** True when a platform plate has a tenant delta row. */
  customized: boolean;
}

export interface PlateRow {
  slug: string;
  origin: DocumentPlateOrigin;
  config: DocumentPlateConfig;
  hidden: boolean;
  updatedAt?: Date | null;
}

export interface TenantDocumentPalette {
  light: Record<string, string>;
  dark: Record<string, string>;
}

/** Injectable store seam so tests exercise resolution without a live DB. */
export interface PlateStore {
  getPlateRow(tenantId: string, slug: string): Promise<PlateRow | null>;
  listPlateRows(tenantId: string): Promise<PlateRow[]>;
  getTenantDocumentPalette(tenantId: string): Promise<TenantDocumentPalette>;
}

const EMPTY_PALETTE: TenantDocumentPalette = { light: {}, dark: {} };

export function drizzlePlateStore(): PlateStore {
  return {
    getPlateRow: async (tenantId, slug) => {
      const rows = await getDb()
        .select()
        .from(documentPlates)
        .where(
          and(
            eq(documentPlates.tenant_id, tenantId),
            eq(documentPlates.slug, slug),
          ),
        )
        .limit(1);
      const row = rows[0];
      return row
        ? {
            slug: row.slug,
            origin: row.origin as DocumentPlateOrigin,
            config: row.config ?? {},
            hidden: row.hidden,
            updatedAt: row.updated_at,
          }
        : null;
    },
    listPlateRows: async (tenantId) => {
      const rows = await getDb()
        .select()
        .from(documentPlates)
        .where(eq(documentPlates.tenant_id, tenantId));
      return rows.map((row) => ({
        slug: row.slug,
        origin: row.origin as DocumentPlateOrigin,
        config: row.config ?? {},
        hidden: row.hidden,
        updatedAt: row.updated_at,
      }));
    },
    getTenantDocumentPalette: async (tenantId) => {
      const rows = await getDb()
        .select({ features: tenantSettings.features })
        .from(tenantSettings)
        .where(eq(tenantSettings.tenant_id, tenantId))
        .limit(1);
      return parseTenantDocumentPalette(rows[0]?.features);
    },
  };
}

/** Parse `features.documentPalette` defensively; garbage → empty palette. */
export function parseTenantDocumentPalette(
  features: unknown,
): TenantDocumentPalette {
  if (
    features === null ||
    typeof features !== "object" ||
    Array.isArray(features)
  ) {
    return EMPTY_PALETTE;
  }
  const palette = (features as Record<string, unknown>).documentPalette;
  if (
    palette === null ||
    typeof palette !== "object" ||
    Array.isArray(palette)
  ) {
    return EMPTY_PALETTE;
  }
  const p = palette as Record<string, unknown>;
  return {
    light: filterPalette(p.light),
    dark: filterPalette(p.dark),
  };
}

function normalizeAllowedDirectives(
  raw: unknown,
): readonly string[] | "all" | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (raw === "all") return "all";
  if (!Array.isArray(raw)) return undefined;
  const kinds = raw.filter(
    (k): k is string => typeof k === "string" && DIRECTIVE_KINDS.includes(k),
  );
  return kinds;
}

// ---------------------------------------------------------------------------
// Content-contract normalization (THINK-183). Save gates validate loudly;
// these re-filter stored config at resolution time (defense in depth, same
// posture as filterPalette) so a row predating a vocabulary tightening can
// never push an invalid contract into the compiler.
// ---------------------------------------------------------------------------

/** Matches the document_plates slug CHECK and the compositor slug shape. */
const CONTRACT_SLUG_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;

function normalizeSuggestedDirectives(
  raw: unknown,
): PlateSuggestedDirective[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: PlateSuggestedDirective[] = [];
  for (const entry of raw) {
    const rec =
      entry !== null && typeof entry === "object" && !Array.isArray(entry)
        ? (entry as Record<string, unknown>)
        : null;
    const kind = rec?.kind;
    if (typeof kind !== "string" || !DIRECTIVE_KINDS.includes(kind)) continue;
    const chartType = rec?.chartType;
    out.push(
      typeof chartType === "string" &&
        (CHART_TYPES as readonly string[]).includes(chartType)
        ? { kind, chartType }
        : { kind },
    );
  }
  return out.length > 0 ? out : undefined;
}

function normalizeSections(raw: unknown): PlateSectionSpec[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: PlateSectionSpec[] = [];
  const seen = new Set<string>();
  for (const entry of raw) {
    const rec =
      entry !== null && typeof entry === "object" && !Array.isArray(entry)
        ? (entry as Record<string, unknown>)
        : null;
    if (!rec) continue;
    const id = rec.id;
    const title = rec.title;
    const tier = rec.tier;
    const guidance = rec.guidance;
    if (
      typeof id !== "string" ||
      !CONTRACT_SLUG_RE.test(id) ||
      seen.has(id) ||
      typeof title !== "string" ||
      title.trim() === "" ||
      !(PLATE_SECTION_TIERS as readonly string[]).includes(tier as string) ||
      typeof guidance !== "string"
    ) {
      continue;
    }
    seen.add(id);
    out.push({
      id,
      title: title.trim(),
      tier: tier as PlateSectionTier,
      guidance: guidance.trim(),
      suggestedDirectives: normalizeSuggestedDirectives(
        rec.suggestedDirectives,
      ),
    });
  }
  return out.length > 0 ? out : undefined;
}

/**
 * Floor-model tier order (THINK-188 KTD2): overrides may only raise. The
 * resolution-time clamp `max(platform, override)` means a stale row that
 * predates a validation tightening can never weaken the floor.
 */
const SECTION_TIER_RANK: Record<PlateSectionTier, number> = {
  suggested: 0,
  "required-if-material": 1,
  required: 2,
};

function maxTier(a: PlateSectionTier, b: PlateSectionTier): PlateSectionTier {
  return SECTION_TIER_RANK[a] >= SECTION_TIER_RANK[b] ? a : b;
}

interface NormalizedSectionOverride {
  guidance?: string;
  tier?: PlateSectionTier;
  suggestedDirectives?: PlateSuggestedDirective[];
}

/** Defensive re-filter of stored sectionOverrides (filterPalette posture). */
function normalizeSectionOverrides(
  raw: unknown,
): Record<string, NormalizedSectionOverride> | undefined {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return undefined;
  }
  const out: Record<string, NormalizedSectionOverride> = {};
  for (const [id, entry] of Object.entries(raw as Record<string, unknown>)) {
    if (!CONTRACT_SLUG_RE.test(id)) continue;
    const rec =
      entry !== null && typeof entry === "object" && !Array.isArray(entry)
        ? (entry as Record<string, unknown>)
        : null;
    if (!rec) continue;
    const override: NormalizedSectionOverride = {};
    if (typeof rec.guidance === "string" && rec.guidance.trim() !== "") {
      override.guidance = rec.guidance.trim();
    }
    if (
      typeof rec.tier === "string" &&
      (PLATE_SECTION_TIERS as readonly string[]).includes(rec.tier)
    ) {
      override.tier = rec.tier as PlateSectionTier;
    }
    const suggested = normalizeSuggestedDirectives(rec.suggestedDirectives);
    if (suggested) override.suggestedDirectives = suggested;
    if (Object.keys(override).length > 0) out[id] = override;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/**
 * The floor-model merge for platform plates (THINK-188 KTD1/R7): platform
 * floor sections in platform order, each patched by its override (tier
 * clamped raise-only), then tenant additions appended — dropping any addition
 * whose id collides with a floor id (defense in depth; save gates reject the
 * collision loudly).
 */
function mergeFloorSections(
  floor: readonly PlateSectionSpec[] | undefined,
  overrides: Record<string, NormalizedSectionOverride> | undefined,
  additions: PlateSectionSpec[] | undefined,
): PlateSectionSpec[] | undefined {
  const floorIds = new Set((floor ?? []).map((s) => s.id));
  const patched = (floor ?? []).map((section) => {
    const override = overrides?.[section.id];
    if (!override) return section;
    return {
      ...section,
      guidance: override.guidance ?? section.guidance,
      tier: override.tier ? maxTier(section.tier, override.tier) : section.tier,
      suggestedDirectives:
        override.suggestedDirectives ?? section.suggestedDirectives,
    };
  });
  const appended = (additions ?? []).filter((s) => !floorIds.has(s.id));
  const merged = [...patched, ...appended];
  return merged.length > 0 ? merged : undefined;
}

/** Platform floor analyses + tenant additions (key collisions dropped). */
function mergeFloorAnalyses(
  floor: readonly PlateAnalysisSpec[] | undefined,
  additions: PlateAnalysisSpec[] | undefined,
): PlateAnalysisSpec[] | undefined {
  const floorKeys = new Set((floor ?? []).map((a) => a.key));
  const merged = [
    ...(floor ?? []),
    ...(additions ?? []).filter((a) => !floorKeys.has(a.key)),
  ];
  return merged.length > 0 ? merged : undefined;
}

function normalizeAnalyses(raw: unknown): PlateAnalysisSpec[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: PlateAnalysisSpec[] = [];
  const seen = new Set<string>();
  for (const entry of raw) {
    const rec =
      entry !== null && typeof entry === "object" && !Array.isArray(entry)
        ? (entry as Record<string, unknown>)
        : null;
    if (!rec) continue;
    const key = rec.key;
    const op = rec.op;
    const presentation =
      rec.presentation !== null &&
      typeof rec.presentation === "object" &&
      !Array.isArray(rec.presentation)
        ? (rec.presentation as Record<string, unknown>)
        : null;
    const directive = presentation?.directive;
    if (
      typeof key !== "string" ||
      !CONTRACT_SLUG_RE.test(key) ||
      seen.has(key) ||
      typeof op !== "string" ||
      !ANALYSIS_OPS.includes(op) ||
      typeof directive !== "string" ||
      !(ANALYSIS_PRESENTATION_DIRECTIVES as readonly string[]).includes(
        directive,
      )
    ) {
      continue;
    }
    const chartType = presentation?.chartType;
    const params =
      rec.params !== null &&
      typeof rec.params === "object" &&
      !Array.isArray(rec.params)
        ? (rec.params as Record<string, unknown>)
        : undefined;
    seen.add(key);
    out.push({
      key,
      op,
      params,
      presentation:
        typeof chartType === "string" &&
        (CHART_TYPES as readonly string[]).includes(chartType)
          ? { directive, chartType }
          : { directive },
      source: "model-supplied",
    });
  }
  return out.length > 0 ? out : undefined;
}

function str(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() !== "" ? v.trim() : undefined;
}

function resolveFromLayers(input: {
  slug: string;
  platform: PlateDefinition | null;
  row: PlateRow | null;
  tenantPalette: TenantDocumentPalette;
}): ResolvedPlate | null {
  const { slug, platform, row, tenantPalette } = input;

  // KTD1 collision rule: a tenant-created row shadows the platform definition.
  if (row && row.origin === "tenant") {
    const c = row.config ?? {};
    return {
      slug,
      displayName: str(c.displayName) ?? slug,
      useFor: str(c.useFor) ?? "",
      eyebrow: str(c.eyebrow) ?? slug.toUpperCase().replace(/-/g, " "),
      titleSuffix: str(c.titleSuffix) ?? str(c.displayName) ?? slug,
      tokensLight: {
        ...tenantPalette.light,
        ...filterPalette(c.paletteLight),
      },
      tokensDark: { ...tenantPalette.dark, ...filterPalette(c.paletteDark) },
      allowedDirectives:
        normalizeAllowedDirectives(c.allowedDirectives) ?? "all",
      sections: normalizeSections(c.sections),
      analyses: normalizeAnalyses(c.analyses),
      origin: "tenant",
      hidden: row.hidden,
      customized: false,
    };
  }

  if (!platform) return null;

  const c = row?.config ?? {};
  return {
    slug,
    displayName: str(c.displayName) ?? platform.displayName,
    useFor: str(c.useFor) ?? platform.useFor,
    eyebrow: str(c.eyebrow) ?? platform.eyebrow,
    titleSuffix: str(c.titleSuffix) ?? platform.titleSuffix,
    tokensLight: {
      ...filterPalette(platform.paletteLight as PlatePalette),
      ...tenantPalette.light,
      ...filterPalette(c.paletteLight),
    },
    tokensDark: {
      ...filterPalette(platform.paletteDark as PlatePalette),
      ...tenantPalette.dark,
      ...filterPalette(c.paletteDark),
    },
    allowedDirectives:
      normalizeAllowedDirectives(c.allowedDirectives) ??
      platform.allowedDirectives,
    // Floor-model layered merge (THINK-188 KTD1/R7): the platform contract is
    // a floor — config `sections`/`analyses` are tenant ADDITIONS and
    // `sectionOverrides` patches floor sections (tier raise-only) — so
    // platform contract improvements keep flowing to customized tenants.
    // (Replaces THINK-183's wholesale per-key override for platform rows;
    // tenant-origin rows above keep full-contract semantics.)
    sections: mergeFloorSections(
      platform.sections,
      normalizeSectionOverrides(c.sectionOverrides),
      normalizeSections(c.sections),
    ),
    analyses: mergeFloorAnalyses(
      platform.analyses,
      normalizeAnalyses(c.analyses),
    ),
    origin: "platform",
    hidden: row?.hidden ?? false,
    customized:
      row !== null && (row.hidden || Object.keys(row.config ?? {}).length > 0),
  };
}

/**
 * Resolve a platform plate with NO tenant deltas — pure and synchronous.
 * Serves tests, fixtures, and fallback paths that have no tenant context.
 */
export function resolvePlatformPlate(slug: string): ResolvedPlate | null {
  return resolveFromLayers({
    slug,
    platform: getPlatformPlate(slug),
    row: null,
    tenantPalette: EMPTY_PALETTE,
  });
}

/**
 * Resolve one plate for a tenant (KTD2). Returns null for an unknown slug —
 * callers own the rejection shape (emission: self-repair error; GraphQL:
 * not-found).
 */
export async function resolvePlate(
  tenantId: string,
  slug: string,
  store: PlateStore = drizzlePlateStore(),
): Promise<ResolvedPlate | null> {
  const [row, tenantPalette] = await Promise.all([
    store.getPlateRow(tenantId, slug),
    store.getTenantDocumentPalette(tenantId),
  ]);
  return resolveFromLayers({
    slug,
    platform: getPlatformPlate(slug),
    row,
    tenantPalette,
  });
}

/**
 * Resolve the WOULD-BE plate for an unsaved row (save validation and editor
 * draft preview): merges exactly as resolvePlate would after the row is
 * written — one merge code path (KTD2), no drift between preview and save.
 * Null only when a platform_override candidate names no platform slug.
 */
export async function resolveCandidatePlate(
  tenantId: string,
  slug: string,
  candidate: {
    origin: DocumentPlateOrigin;
    config: DocumentPlateConfig;
    hidden?: boolean;
  },
  store: PlateStore = drizzlePlateStore(),
): Promise<ResolvedPlate | null> {
  const tenantPalette = await store.getTenantDocumentPalette(tenantId);
  return resolveFromLayers({
    slug,
    platform: getPlatformPlate(slug),
    row: {
      slug,
      origin: candidate.origin,
      config: candidate.config,
      hidden: candidate.hidden ?? false,
    },
    tenantPalette,
  });
}

/**
 * All plates for a tenant, resolved: platform library (minus shadowed slugs,
 * with overrides applied) in definition order, then tenant-created plates by
 * slug. Includes hidden plates — callers filter for agent-facing surfaces.
 */
export async function listPlates(
  tenantId: string,
  store: PlateStore = drizzlePlateStore(),
): Promise<ResolvedPlate[]> {
  const [rows, tenantPalette] = await Promise.all([
    store.listPlateRows(tenantId),
    store.getTenantDocumentPalette(tenantId),
  ]);
  const rowsBySlug = new Map(rows.map((r) => [r.slug, r]));

  const resolved: ResolvedPlate[] = [];
  for (const platform of PLATFORM_PLATES) {
    const plate = resolveFromLayers({
      slug: platform.slug,
      platform,
      row: rowsBySlug.get(platform.slug) ?? null,
      tenantPalette,
    });
    if (plate) resolved.push(plate);
    rowsBySlug.delete(platform.slug);
  }
  const tenantRows = [...rowsBySlug.values()]
    .filter((r) => r.origin === "tenant")
    .sort((a, b) => a.slug.localeCompare(b.slug));
  for (const row of tenantRows) {
    const plate = resolveFromLayers({
      slug: row.slug,
      platform: null,
      row,
      tenantPalette,
    });
    if (plate) resolved.push(plate);
  }
  return resolved;
}

/**
 * The agent-facing plate summary (R10 + THINK-183 KTD8/R14): discovery
 * fields plus a terse contract projection — enforced section ids with their
 * expected titles and tier, and declared analysis keys with their ops and
 * the op's one-line input-shape hint. No guidance text (token cost scales
 * with plate count; full guidance arrives in rejection diagnostics at point
 * of use). Contract-less plates keep the original three-field shape.
 */
export interface PlateDispatchSummary {
  slug: string;
  displayName: string;
  useFor: string;
  sections?: Array<{
    id: string;
    title: string;
    tier: "required" | "required-if-material";
  }>;
  analyses?: Array<{ key: string; op: string; inputHint: string }>;
}

export function visiblePlateSummaries(
  plates: readonly ResolvedPlate[],
): PlateDispatchSummary[] {
  return plates
    .filter((p) => !p.hidden)
    .map((p) => {
      const sections = (p.sections ?? [])
        .filter((s) => s.tier !== "suggested")
        .map((s) => ({
          id: s.id,
          title: s.title,
          tier: s.tier as "required" | "required-if-material",
        }));
      const analyses = (p.analyses ?? []).map((a) => ({
        key: a.key,
        op: a.op,
        inputHint: getAnalysisOp(a.op)?.inputHint ?? "",
      }));
      return {
        slug: p.slug,
        displayName: p.displayName,
        useFor: p.useFor,
        ...(sections.length > 0 ? { sections } : {}),
        ...(analyses.length > 0 ? { analyses } : {}),
      };
    });
}

/**
 * Emission-facing resolution (KTD3): resolves the plate AND carries the
 * tenant's visible slugs so rejection diagnostics can name the valid set
 * (R11) without a second round trip.
 */
export type EmissionPlateResolution =
  | { ok: true; plate: ResolvedPlate; visibleSlugs: string[] }
  | { ok: false; visibleSlugs: string[] };

export async function resolvePlateForEmission(
  tenantId: string,
  slug: string,
  store: PlateStore = drizzlePlateStore(),
): Promise<EmissionPlateResolution> {
  const all = await listPlates(tenantId, store);
  const visibleSlugs = all.filter((p) => !p.hidden).map((p) => p.slug);
  const plate = all.find((p) => p.slug === slug) ?? null;
  return plate
    ? { ok: true, plate, visibleSlugs }
    : { ok: false, visibleSlugs };
}

/**
 * Dispatch-payload helper (KTD4): the tenant's visible plates as discovery
 * summaries for `document_plates`. Never throws — a registry read failure
 * degrades to undefined so dispatch proceeds and the Pi extension falls back
 * to the core four (server-side validation stays authoritative).
 */
export async function documentPlatesForDispatch(
  tenantId: string,
  store: PlateStore = drizzlePlateStore(),
): Promise<PlateDispatchSummary[] | undefined> {
  try {
    return visiblePlateSummaries(await listPlates(tenantId, store));
  } catch (err) {
    console.error(
      "[plate-registry] dispatch plate list failed (extension falls back to core four):",
      err,
    );
    return undefined;
  }
}

// ---------------------------------------------------------------------------
// Exemplar builder (KTD7) — the canned document for validation and preview
// ---------------------------------------------------------------------------

/**
 * Per-directive snippet library. The exemplar includes one block per
 * directive the plate ALLOWS, so validation and preview always compile
 * exactly what the plate permits — a plate that excludes tw:chart validates
 * without a chart block instead of self-rejecting on
 * DIRECTIVE_GENRE_RESTRICTED.
 */
const EXEMPLAR_DIRECTIVE_SNIPPETS: Record<string, string> = {
  stats: `\`\`\`tw:stats
items:
  - { value: 12, label: initiatives on track }
  - { value: "94%", label: renewal rate }
  - { value: "+18%", label: quarter over quarter }
\`\`\``,
  "verdict-grid": `\`\`\`tw:verdict-grid
cards:
  - { question: Overall health, answer: Strong, note: All commitments met this period, tone: acc }
  - { question: Attention needed, answer: One item, note: Renewal paperwork pending signature, tone: warn }
\`\`\``,
  chart: `\`\`\`tw:chart
type: bar
title: Quarterly momentum
qualifier: closed items per month
series:
  - { label: Month 1, value: 14 }
  - { label: Month 2, value: 18 }
  - { label: Month 3, value: 23 }
caption: Delivery pace accelerated through the quarter.
\`\`\``,
};

export interface PlateExemplar {
  title: string;
  abstract: string;
  markdownBody: string;
}

/**
 * Assemble the representative document for a plate: fixed prose base plus one
 * block per allowed directive — and, for contract-bearing plates (THINK-183
 * KTD7), a heading per manifest section and one example tw:analysis block per
 * declared analysis, so the exemplar satisfies the plate's own contract and
 * gate 2 compiles clean. Deterministic — same plate config, same exemplar.
 */
export function buildPlateExemplar(plate: ResolvedPlate): PlateExemplar {
  const allowed =
    plate.allowedDirectives === "all"
      ? Object.keys(EXEMPLAR_DIRECTIVE_SNIPPETS)
      : plate.allowedDirectives;
  const directiveBlocks = allowed
    .map((kind) => EXEMPLAR_DIRECTIVE_SNIPPETS[kind])
    .filter(Boolean);

  // One example block per declared analysis: the op's corrected minimal
  // example with the declared key substituted in.
  const analysisBlocks = (plate.analyses ?? [])
    .map((analysis) => {
      const spec = getAnalysisOp(analysis.op);
      if (!spec) return null;
      const body = spec.example.replace("<declared key>", analysis.key);
      return `\`\`\`tw:analysis\n${body}\n\`\`\``;
    })
    .filter((b): b is string => b !== null);

  // A heading per manifest section (title verbatim — its slug is the section
  // id by the KTD6 save-time consistency check) with representative prose.
  const manifestSections = (plate.sections ?? []).map(
    (section) =>
      `## ${section.title}\n\nRepresentative content for this section. ${section.guidance}`,
  );

  const markdownBody = `---
date: Q3 2026
context: Sample document — compiled to validate and preview this plate
---

## Where things stand

This is a representative document compiled with the **${plate.displayName}** plate. It exercises the elements a real document uses: prose, emphasis, lists, a table, and the plate's component vocabulary, so what you see is what documents in this plate will look like.

${[...directiveBlocks, ...analysisBlocks].join("\n\n")}

- The first point carries the headline finding.
- The second point adds supporting detail with \`inline code\`.
- The third point notes an open question.

${manifestSections.length > 0 ? `${manifestSections.join("\n\n")}\n\n` : ""}## Detail by area

| Area | Status | Note |
| --- | --- | --- |
| Delivery | On track | Milestones met through this period |
| Adoption | Improving | Weekly active usage up steadily |
| Risks | Watch | One dependency pending external review |

## What happens next

> The takeaway sits here: a short, quotable summary of the recommendation and the immediate next step.

A closing paragraph wraps up the narrative and points at the decision or action the document exists to drive.
`;

  return {
    title: `Acme Corp — Sample ${plate.displayName}`,
    abstract: `A representative ${plate.displayName} used to validate and preview the "${plate.slug}" plate.`,
    markdownBody,
  };
}
