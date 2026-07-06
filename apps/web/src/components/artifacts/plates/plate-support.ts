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
}

function parseJsonObject(value: unknown): Record<string, string> {
  if (typeof value !== "string" || value.length === 0) return {};
  try {
    const parsed = JSON.parse(value);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      const out: Record<string, string> = {};
      for (const [key, raw] of Object.entries(parsed)) {
        if (typeof raw === "string") out[key] = raw;
      }
      return out;
    }
  } catch {
    // fall through
  }
  return {};
}

function parseOverrides(value: unknown): PlateOverrides | null {
  if (typeof value !== "string" || value.length === 0) return null;
  try {
    const parsed = JSON.parse(value);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as PlateOverrides;
    }
  } catch {
    // fall through
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
  >,
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
