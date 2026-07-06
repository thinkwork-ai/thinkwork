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
import { compileDocument } from "../../../lib/artifacts/document-compositor.js";
import { DIRECTIVE_KINDS } from "../../../lib/artifacts/document-directives.js";
import { runDocumentPreflight } from "../../../lib/artifacts/document-preflight.js";
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

export interface PlateDraftConfig {
  displayName?: string;
  useFor?: string;
  eyebrow?: string;
  titleSuffix?: string;
  paletteLight?: Record<string, string>;
  paletteDark?: Record<string, string>;
  allowedDirectives?: string[];
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

export function plateToGraphql(
  plate: ResolvedPlate,
  overrides: Record<string, unknown> | null,
): Record<string, unknown> {
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
