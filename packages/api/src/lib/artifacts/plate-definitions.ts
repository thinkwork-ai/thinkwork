/**
 * Plate registry (THINK-153 KTD1): the code-defined platform plate library.
 *
 * Platform plates ship with the release — every tenant sees them because the
 * code defines them, updates flow with every deploy by construction, and there
 * is no seeder job or per-tenant iteration to fail. The database stores only
 * tenant deltas (document_plates rows); resolution merges the two in
 * plate-registry.ts.
 *
 * Palette values are CSS custom-property overrides relative to the base plate
 * CSS defaults (document-templates.ts). The four core plates carry empty
 * palettes — they ARE the defaults — so an uncustomized core plate compiles
 * byte-identical output to the pre-registry compositor (U2 golden parity).
 */

/** Token name → CSS value, plate token vocabulary only. */
export type PlatePalette = Readonly<Record<string, string>>;

// ---------------------------------------------------------------------------
// Content contract (THINK-183): tiered section manifest + declared analyses.
// ---------------------------------------------------------------------------

export const PLATE_SECTION_TIERS = [
  "required",
  "required-if-material",
  "suggested",
] as const;
export type PlateSectionTier = (typeof PLATE_SECTION_TIERS)[number];

export interface PlateSuggestedDirective {
  /** A DIRECTIVE_KINDS member (validated at save). */
  kind: string;
  /** Chart type suggestion; only meaningful when kind is "chart". */
  chartType?: string;
}

export interface PlateSectionSpec {
  /**
   * Stable slug-shaped id, matched exactly against the compositor's
   * id-anchored heading slugs (KTD6). Must equal the slug of `title`.
   */
  id: string;
  /** Expected heading title — authoring it yields the section id. */
  title: string;
  tier: PlateSectionTier;
  /** What belongs in this section; surfaces in rejection diagnostics. */
  guidance: string;
  suggestedDirectives?: readonly PlateSuggestedDirective[];
}

export interface PlateAnalysisSpec {
  /** Slug-shaped key the model references in a tw:analysis block. */
  key: string;
  /** An ANALYSIS_OPS member (document-analyses.ts; validated at save). */
  op: string;
  /** Plate-declared parameters merged over the model's raw inputs. */
  params?: Readonly<Record<string, unknown>>;
  /** How the computed result renders (chart/stats; kind validated at save). */
  presentation: { directive: string; chartType?: string };
  /** Raw-input provenance; v1 is model-supplied (binding is a future rung). */
  source: "model-supplied";
}

export interface PlateDefinition {
  slug: string;
  displayName: string;
  /** One-line "use this plate for…" shown to agents and in the Plates tab. */
  useFor: string;
  /** Small-caps category label above the title. */
  eyebrow: string;
  /** Suffix appended to the H1/<title> ("[Subject] — Report"). */
  titleSuffix: string;
  paletteLight: PlatePalette;
  paletteDark: PlatePalette;
  /** Directive kinds available in this plate; "all" for no restriction. */
  allowedDirectives: readonly string[] | "all";
  /** Content contract: tiered section manifest (absent = no manifest). */
  sections?: readonly PlateSectionSpec[];
  /** Content contract: declared server-computed analyses (absent = none). */
  analyses?: readonly PlateAnalysisSpec[];
}

/** The four core plates — values ported verbatim from GENRE_TEMPLATES. */
export const CORE_PLATE_SLUGS = [
  "ideation",
  "plan",
  "report",
  "brief",
] as const;

const CORE_PLATES: readonly PlateDefinition[] = [
  {
    slug: "report",
    displayName: "Report",
    useFor:
      "General findings and analysis presented as a narrative with evidence.",
    eyebrow: "REPORT",
    titleSuffix: "Report",
    paletteLight: {},
    paletteDark: {},
    allowedDirectives: "all",
  },
  {
    slug: "plan",
    displayName: "Plan",
    useFor: "A course of action: phases, workstreams, owners, and sequencing.",
    eyebrow: "PLAN",
    titleSuffix: "Plan",
    paletteLight: {},
    paletteDark: {},
    allowedDirectives: "all",
  },
  {
    slug: "brief",
    displayName: "Decision Brief",
    useFor: "A decision brief: options, tradeoffs, and a recommendation.",
    eyebrow: "DECISION BRIEF",
    titleSuffix: "Brief",
    paletteLight: {},
    paletteDark: {},
    allowedDirectives: "all",
  },
  {
    slug: "ideation",
    displayName: "Ideation",
    useFor: "Exploratory thinking: directions, concepts, and open questions.",
    eyebrow: "IDEATION",
    titleSuffix: "Ideation",
    paletteLight: {},
    paletteDark: {},
    allowedDirectives: "all",
  },
];

/**
 * The business library (R14): five plates with designed accents. Each
 * overrides only the accent triad — brand-neutral surfaces stay on the base
 * palette so tenant document palettes (R8) show through everywhere else.
 */
const BUSINESS_PLATES: readonly PlateDefinition[] = [
  {
    slug: "qbr",
    displayName: "QBR",
    useFor:
      "Quarterly business review of goals, results, and account health for a client or business unit.",
    eyebrow: "QUARTERLY BUSINESS REVIEW",
    titleSuffix: "QBR",
    paletteLight: {
      "--accent": "#3d5aa8",
      "--accent-soft": "#e9edf9",
      "--accent-text": "#32498c",
    },
    paletteDark: {
      "--accent": "#8fa7e8",
      "--accent-soft": "#1a2340",
      "--accent-text": "#aebfef",
    },
    allowedDirectives: "all",
  },
  {
    slug: "proposal",
    displayName: "Proposal",
    useFor:
      "A commercial proposal or statement of work: scope, approach, pricing, and terms.",
    eyebrow: "PROPOSAL",
    titleSuffix: "Proposal",
    paletteLight: {
      "--accent": "#6d4fa3",
      "--accent-soft": "#f0eafa",
      "--accent-text": "#5b4189",
    },
    paletteDark: {
      "--accent": "#b49ae0",
      "--accent-soft": "#271c3a",
      "--accent-text": "#c9b6ea",
    },
    // Proposals are prose, pricing tables, and verdicts — charts read as
    // padding in a commercial document (and this gives the library a live
    // example of directive restriction, AE4).
    allowedDirectives: ["stats", "verdict-grid"],
  },
  {
    slug: "weekly-status",
    displayName: "Weekly Status",
    useFor:
      "A weekly status update: progress, metrics, blockers, and next steps.",
    eyebrow: "WEEKLY STATUS",
    titleSuffix: "Weekly Status",
    paletteLight: {
      "--accent": "#2e7d8a",
      "--accent-soft": "#e6f2f4",
      "--accent-text": "#266974",
    },
    paletteDark: {
      "--accent": "#6cc3d1",
      "--accent-soft": "#102c31",
      "--accent-text": "#92d4df",
    },
    allowedDirectives: "all",
  },
  {
    slug: "sales-rep-review",
    displayName: "Sales Rep Review",
    useFor:
      "A sales rep performance review: quota attainment, pipeline health, and coaching points.",
    eyebrow: "SALES REP REVIEW",
    titleSuffix: "Rep Review",
    paletteLight: {
      "--accent": "#a3611c",
      "--accent-soft": "#f9f0e3",
      "--accent-text": "#8a5117",
    },
    paletteDark: {
      "--accent": "#dfa963",
      "--accent-soft": "#33250f",
      "--accent-text": "#ecc08a",
    },
    allowedDirectives: "all",
  },
  {
    slug: "opportunity-review",
    displayName: "Opportunity Review",
    useFor:
      "A single-opportunity deal review: stage, stakeholders, risks, and the close plan.",
    eyebrow: "OPPORTUNITY REVIEW",
    titleSuffix: "Opportunity Review",
    paletteLight: {
      "--accent": "#9b3d63",
      "--accent-soft": "#f9e9f0",
      "--accent-text": "#833453",
    },
    paletteDark: {
      "--accent": "#e08bb0",
      "--accent-soft": "#3a1c2a",
      "--accent-text": "#edaac6",
    },
    allowedDirectives: "all",
  },
];

export const PLATFORM_PLATES: readonly PlateDefinition[] = [
  ...CORE_PLATES,
  ...BUSINESS_PLATES,
];

const BY_SLUG = new Map(PLATFORM_PLATES.map((p) => [p.slug, p]));

export function getPlatformPlate(slug: string): PlateDefinition | null {
  return BY_SLUG.get(slug) ?? null;
}
