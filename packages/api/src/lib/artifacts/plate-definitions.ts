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
  /** Operator-authored instructions for authoring this analysis (optional). */
  guidance?: string;
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
  /** Plate-wide authoring instructions shown to the agent (absent = none). */
  authoringInstructions?: string;
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
 *
 * THINK-183 (R12): each business plate carries a content contract — a tiered
 * section manifest plus declared server-computed analyses — so the plates are
 * distinguishable by substance, not just palette. Section ids MUST equal the
 * heading slug of their titles (KTD6; pinned by the platform-definitions
 * tests), and analysis presentations must respect the plate's
 * allowedDirectives (gate 1b).
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
    sections: [
      {
        id: "business-outcomes",
        title: "Business Outcomes",
        tier: "required",
        guidance:
          "The quarter's goals against results — what was committed, what landed, and the delta, stated in the client's terms.",
        suggestedDirectives: [{ kind: "stats" }],
      },
      {
        id: "usage-trend",
        title: "Usage Trend",
        tier: "required-if-material",
        guidance:
          "Adoption or usage over the quarter as an ordered series (monthly or weekly). Waive if no usage telemetry exists for this account.",
        suggestedDirectives: [{ kind: "chart", chartType: "line" }],
      },
      {
        id: "account-health",
        title: "Account Health",
        tier: "required",
        guidance:
          "Relationship, risk, and renewal posture — a verdict per dimension with a one-line justification.",
        suggestedDirectives: [{ kind: "verdict-grid" }],
      },
      {
        id: "next-quarter-plan",
        title: "Next Quarter Plan",
        tier: "required",
        guidance:
          "Commitments for the coming quarter: owners, milestones, and the success measure for each.",
        suggestedDirectives: [{ kind: "timeline" }],
      },
    ],
    analyses: [
      {
        key: "usage-trend",
        op: "trend",
        presentation: { directive: "chart", chartType: "line" },
        source: "model-supplied",
      },
      {
        key: "outcome-variance",
        op: "variance_vs_prior",
        presentation: { directive: "stats" },
        source: "model-supplied",
      },
    ],
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
    // Proposals are prose, pricing tables, timelines, and verdicts — charts
    // read as padding in a commercial document (and this gives the library a
    // live example of directive restriction, AE4).
    allowedDirectives: ["stats", "verdict-grid", "timeline"],
    sections: [
      {
        id: "scope-of-work",
        title: "Scope of Work",
        tier: "required",
        guidance:
          "What is being delivered, phase by phase, with what is explicitly out of scope.",
        suggestedDirectives: [{ kind: "timeline" }],
      },
      {
        id: "pricing",
        title: "Pricing",
        tier: "required",
        guidance:
          "The commercial terms as a table: line items, quantities, and totals. Headline figures work well as stat tiles.",
        suggestedDirectives: [{ kind: "stats" }],
      },
      {
        id: "terms-and-assumptions",
        title: "Terms and Assumptions",
        tier: "required-if-material",
        guidance:
          "Assumptions the pricing depends on, payment terms, and validity window. Waive only when the engagement letter carries them.",
      },
    ],
    // No chart presentations: the plate's directive restriction is a plate
    // identity, and gate 1b enforces that analyses respect it.
    analyses: [
      {
        key: "discount-rate",
        op: "ratio_pct",
        presentation: { directive: "stats" },
        source: "model-supplied",
      },
    ],
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
    sections: [
      {
        id: "progress",
        title: "Progress",
        tier: "required",
        guidance:
          "What moved this week against the plan — shipped, advanced, or decided.",
      },
      {
        id: "metrics",
        title: "Metrics",
        tier: "required-if-material",
        guidance:
          "The week's numbers against the prior period. Waive when no metrics source is connected for this workstream.",
        suggestedDirectives: [{ kind: "stats" }],
      },
      {
        id: "blockers",
        title: "Blockers",
        tier: "required",
        guidance:
          "What is stuck, who can unstick it, and what was already tried. 'None' is a valid entry — say it explicitly.",
      },
      {
        id: "next-steps",
        title: "Next Steps",
        tier: "required",
        guidance: "Concrete commitments for next week with owners.",
      },
    ],
    analyses: [
      {
        key: "metrics-vs-prior",
        op: "variance_vs_prior",
        presentation: { directive: "stats" },
        source: "model-supplied",
      },
    ],
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
    // The plate whose miss started THINK-183: a rep review shipped without a
    // funnel because nothing said one belonged there. pipeline-health is
    // required-if-material deliberately — thin-data reps must waive, not
    // fabricate stage counts.
    sections: [
      {
        id: "quota-attainment",
        title: "Quota Attainment",
        tier: "required-if-material",
        guidance:
          "Attainment against target for the period, computed — not narrated from memory. Waive when no quota target is set for this rep.",
        suggestedDirectives: [{ kind: "stats" }],
      },
      {
        id: "pipeline-health",
        title: "Pipeline Health",
        tier: "required-if-material",
        guidance:
          "The rep's pipeline as an ordered funnel with stage-to-stage conversion. Waive when stage-level pipeline data is unavailable.",
        suggestedDirectives: [{ kind: "chart", chartType: "funnel" }],
      },
      {
        id: "coaching-notes",
        title: "Coaching Notes",
        tier: "required",
        guidance:
          "Specific, observable behaviors to keep or change, each tied to evidence from the period.",
      },
    ],
    analyses: [
      {
        key: "pipeline-conversion",
        op: "funnel_conversion",
        presentation: { directive: "chart", chartType: "funnel" },
        source: "model-supplied",
      },
      {
        key: "quota-attainment",
        op: "ratio_pct",
        presentation: { directive: "stats" },
        source: "model-supplied",
      },
    ],
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
    sections: [
      {
        id: "deal-snapshot",
        title: "Deal Snapshot",
        tier: "required",
        guidance:
          "Stage, value, close date, and how each has moved since the last review.",
        suggestedDirectives: [{ kind: "stats" }],
      },
      {
        id: "stakeholders",
        title: "Stakeholders",
        tier: "required",
        guidance:
          "Who decides, who champions, who blocks — and the engagement state of each.",
      },
      {
        id: "risks",
        title: "Risks",
        tier: "required",
        guidance:
          "What could kill the deal, with a verdict per risk and the mitigation in play.",
        suggestedDirectives: [{ kind: "verdict-grid" }],
      },
      {
        id: "close-plan",
        title: "Close Plan",
        tier: "required",
        guidance:
          "The path to signature: remaining steps, owners on both sides, and dates.",
      },
    ],
    analyses: [
      {
        key: "value-vs-initial",
        op: "variance_vs_prior",
        presentation: { directive: "stats" },
        source: "model-supplied",
      },
    ],
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

// ---------------------------------------------------------------------------
// Wiki plates (THINK-272, parent THINK-270 U1 / KTD4).
//
// A SEPARATE list, deliberately not part of PLATFORM_PLATES: every composer
// surface (emit_document dispatch, listPlates, plate preview) reaches
// platform definitions only through getPlatformPlate/PLATFORM_PLATES, so
// keeping wiki plates out of that list excludes them from all of it by
// construction — no hidden-flag machinery. Resolution goes through the
// dedicated resolveWikiPlate in plate-registry.ts, which layers tenant
// document palettes and platform_override rows exactly like composer plates.
//
// Section specs are ADVISORY (`suggested` tier, never enforced) because the
// wiki graph-materializer emits a different section vocabulary than the
// planner templates; ids follow the KTD6 invariant (id = headingSlug(title))
// with titles taken from the wiki template headings
// (packages/api/src/lib/wiki/templates.ts). Palettes override only the
// accent triad — same discipline as BUSINESS_PLATES — with three distinct
// hues so entity/topic/decision pages read differently at a glance.
// ---------------------------------------------------------------------------

/** Wiki page types with a plate; mirrors WikiPageType (lib/wiki). */
export const WIKI_PLATE_SLUG_BY_PAGE_TYPE = {
  entity: "wiki-entity",
  topic: "wiki-topic",
  decision: "wiki-decision",
} as const;

export type WikiPlatePageType = keyof typeof WIKI_PLATE_SLUG_BY_PAGE_TYPE;

/** Page type → wiki plate slug; null for anything unknown. */
export function wikiPlateSlugForPageType(pageType: string): string | null {
  return Object.prototype.hasOwnProperty.call(
    WIKI_PLATE_SLUG_BY_PAGE_TYPE,
    pageType,
  )
    ? WIKI_PLATE_SLUG_BY_PAGE_TYPE[pageType as WikiPlatePageType]
    : null;
}

export const WIKI_PLATES: readonly PlateDefinition[] = [
  {
    slug: "wiki-entity",
    displayName: "Wiki Entity",
    useFor:
      "A wiki entity page: a person, place, organization, product, or team with a stable identity.",
    eyebrow: "WIKI · ENTITY",
    titleSuffix: "Entity",
    // Green accent: entity pages are the wiki's "things".
    paletteLight: {
      "--accent": "#2f7d52",
      "--accent-soft": "#e7f3ec",
      "--accent-text": "#276745",
    },
    paletteDark: {
      "--accent": "#7fc9a2",
      "--accent-soft": "#12301e",
      "--accent-text": "#9cd8b8",
    },
    // Wiki section markdown carries no tw: directive fences; a stray fence
    // rejects the compile and the page falls back to markdown rendering.
    allowedDirectives: [],
    sections: [
      {
        id: "overview",
        title: "Overview",
        tier: "suggested",
        guidance:
          "Two–four sentence summary of what this entity is, grounded in the cited records.",
      },
      {
        id: "notes",
        title: "Notes",
        tier: "suggested",
        guidance:
          "Notable impressions, opinions, or qualitative observations about this entity, drawn from record quotes.",
      },
      {
        id: "visits-interactions",
        title: "Visits & Interactions",
        tier: "suggested",
        guidance:
          "A chronological-ish list (newest first) of meaningful interactions or visits, with dates when available.",
      },
      {
        id: "related",
        title: "Related",
        tier: "suggested",
        guidance:
          "Other wiki pages this entity is meaningfully linked to; prose only when relationships need explanation.",
      },
    ],
  },
  {
    slug: "wiki-topic",
    displayName: "Wiki Topic",
    useFor:
      "A wiki topic page: a recurring subject or theme that spans multiple records.",
    eyebrow: "WIKI · TOPIC",
    titleSuffix: "Topic",
    // Blue accent: topics are the wiki's threads of thought.
    paletteLight: {
      "--accent": "#3865ae",
      "--accent-soft": "#e9f0f9",
      "--accent-text": "#2e5391",
    },
    paletteDark: {
      "--accent": "#8fb4e8",
      "--accent-soft": "#14243a",
      "--accent-text": "#adc8ef",
    },
    allowedDirectives: [],
    sections: [
      {
        id: "summary",
        title: "Summary",
        tier: "suggested",
        guidance: "Two–four sentence description of what this topic covers.",
      },
      {
        id: "highlights",
        title: "Highlights",
        tier: "suggested",
        guidance:
          "Short bulleted highlights — standout moments, patterns, or takeaways.",
      },
      {
        id: "related-entities",
        title: "Related Entities",
        tier: "suggested",
        guidance:
          "Named entities that show up repeatedly in this topic, linked to their wiki pages where they exist.",
      },
      {
        id: "recent",
        title: "Recent",
        tier: "suggested",
        guidance: "A few of the newest records contributing to this topic.",
      },
    ],
  },
  {
    slug: "wiki-decision",
    displayName: "Wiki Decision",
    useFor:
      "A wiki decision page: a recorded choice or stance, with its context and consequences.",
    eyebrow: "WIKI · DECISION",
    titleSuffix: "Decision",
    // Warm amber accent: decisions are the wiki's commitments.
    paletteLight: {
      "--accent": "#a85a24",
      "--accent-soft": "#f8ede2",
      "--accent-text": "#8c4a1d",
    },
    paletteDark: {
      "--accent": "#e0a370",
      "--accent-soft": "#33200f",
      "--accent-text": "#ecbd93",
    },
    allowedDirectives: [],
    sections: [
      {
        id: "context",
        title: "Context",
        tier: "suggested",
        guidance:
          "What was going on that prompted this decision, kept to what the records show.",
      },
      {
        id: "decision",
        title: "Decision",
        tier: "suggested",
        guidance: "The decision itself in one or two plain-language sentences.",
      },
      {
        id: "rationale",
        title: "Rationale",
        tier: "suggested",
        guidance: "The reasons given or evident in the source records.",
      },
      {
        id: "consequences",
        title: "Consequences",
        tier: "suggested",
        guidance:
          "Observed follow-on effects: what changed, what got revisited, what to revisit next.",
      },
    ],
  },
];

const WIKI_BY_SLUG = new Map(WIKI_PLATES.map((p) => [p.slug, p]));

export function getWikiPlate(slug: string): PlateDefinition | null {
  return WIKI_BY_SLUG.get(slug) ?? null;
}
