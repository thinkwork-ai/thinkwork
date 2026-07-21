/**
 * Twin declaration shapes + tolerant parsers (Company Brain U3 / KTD-3).
 *
 * Three operator-declared, change-set-governed jsonb surfaces feed the twin:
 *
 * - `entity_types.twin_facets` — which facets of a type deep-clone into the
 *   graph, on what cadence, with which source-field → attribute mappings
 *   (the cohort-filter grammar's typing source).
 * - `entity_types.page_sections` — which sections an entity page renders,
 *   each facet-backed / live-routed / knowledge, with a visibility scope.
 * - `relationship_types.source_binding` — which source dataset's foreign
 *   keys deterministically populate edge instances (never LLM-inferred).
 *
 * Parsers follow the `parseIdentityRules` convention (entity-identity
 * normalizers): tolerant — malformed entries are dropped, never thrown —
 * so a bad row can't take down apply, export compile, or page render.
 */

export const TWIN_CLONE_POLICIES = ["deep_clone", "limited"] as const;
export type TwinClonePolicy = (typeof TWIN_CLONE_POLICIES)[number];

export const PAGE_SECTION_KINDS = [
  "facet_backed",
  "live_routed",
  "knowledge",
] as const;
export type PageSectionKind = (typeof PAGE_SECTION_KINDS)[number];

export const SECTION_VISIBILITIES = ["all_members", "operators_only"] as const;
export type SectionVisibility = (typeof SECTION_VISIBILITIES)[number];

export interface TwinFacetAttribute {
  /** Source field name in the lake dataset. */
  sourceField: string;
  /** Canonical facet attribute name it maps to. */
  attribute: string;
  /** Cohort-filter typing for this attribute (KTD-5 grammar source). */
  filterType?: "string" | "number" | "boolean" | "date";
}

export interface TwinFacetDeclaration {
  slug: string;
  clonePolicy: TwinClonePolicy;
  /** Operator-tunable sync cadence hint, e.g. "6h" (R4). Ingestion-owned
   *  interpretation; free-form here. */
  cadence: string | null;
  /** Connector/source-system slug holding this facet (e.g. "twenty"). */
  sourceSystem: string;
  /** Lake dataset the facet clones from (defaults to the facet slug). */
  sourceDataset: string | null;
  attributes: TwinFacetAttribute[];
  note: string | null;
}

export interface PageSectionDeclaration {
  slug: string;
  heading: string;
  kind: PageSectionKind;
  /** For facet_backed sections: the twin facet rendered. */
  facetSlug: string | null;
  /** For live_routed sections: the system fetched on view. */
  sourceSystem: string | null;
  visibility: SectionVisibility;
  position: number;
}

export interface RelationshipSourceBinding {
  sourceSystem: string;
  sourceDataset: string;
  /** Source-row fields carrying the FROM entity's external id. */
  sourceKeyFields: string[];
  /** Source-row fields carrying the TO entity's external id. */
  targetKeyFields: string[];
  note: string | null;
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

function strArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((v): v is string => typeof v === "string" && v.trim() !== "")
    : [];
}

const FILTER_TYPES = new Set(["string", "number", "boolean", "date"]);

export function parseTwinFacetDeclarations(
  raw: unknown,
): TwinFacetDeclaration[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const facets: TwinFacetDeclaration[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const candidate = entry as Record<string, unknown>;
    const slug = str(candidate.slug);
    const sourceSystem = str(candidate.sourceSystem);
    if (!slug || !sourceSystem || seen.has(slug)) continue;
    const clonePolicy = (TWIN_CLONE_POLICIES as readonly string[]).includes(
      candidate.clonePolicy as string,
    )
      ? (candidate.clonePolicy as TwinClonePolicy)
      : "deep_clone";
    const attributes: TwinFacetAttribute[] = Array.isArray(candidate.attributes)
      ? (candidate.attributes as unknown[]).flatMap((attr) => {
          if (!attr || typeof attr !== "object") return [];
          const a = attr as Record<string, unknown>;
          const sourceField = str(a.sourceField);
          const attribute = str(a.attribute);
          if (!sourceField || !attribute) return [];
          const filterType = FILTER_TYPES.has(a.filterType as string)
            ? (a.filterType as TwinFacetAttribute["filterType"])
            : undefined;
          return [
            filterType
              ? { sourceField, attribute, filterType }
              : { sourceField, attribute },
          ];
        })
      : [];
    seen.add(slug);
    facets.push({
      slug,
      clonePolicy,
      cadence: str(candidate.cadence),
      sourceSystem,
      sourceDataset: str(candidate.sourceDataset),
      attributes,
      note: str(candidate.note),
    });
  }
  return facets;
}

export function parsePageSectionDeclarations(
  raw: unknown,
): PageSectionDeclaration[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const sections: PageSectionDeclaration[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const candidate = entry as Record<string, unknown>;
    const slug = str(candidate.slug);
    const kind = (PAGE_SECTION_KINDS as readonly string[]).includes(
      candidate.kind as string,
    )
      ? (candidate.kind as PageSectionKind)
      : null;
    if (!slug || !kind || seen.has(slug)) continue;
    // A facet-backed section without a facet reference renders nothing —
    // drop it here so downstream consumers never special-case it.
    const facetSlug = str(candidate.facetSlug);
    if (kind === "facet_backed" && !facetSlug) continue;
    const sourceSystem = str(candidate.sourceSystem);
    if (kind === "live_routed" && !sourceSystem) continue;
    seen.add(slug);
    sections.push({
      slug,
      heading: str(candidate.heading) ?? slug,
      kind,
      facetSlug,
      sourceSystem,
      visibility:
        candidate.visibility === "operators_only"
          ? "operators_only"
          : "all_members",
      position:
        typeof candidate.position === "number" &&
        Number.isInteger(candidate.position)
          ? candidate.position
          : sections.length,
    });
  }
  return sections.sort((a, b) => a.position - b.position);
}

export function parseRelationshipSourceBinding(
  raw: unknown,
): RelationshipSourceBinding | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const candidate = raw as Record<string, unknown>;
  const sourceSystem = str(candidate.sourceSystem);
  const sourceDataset = str(candidate.sourceDataset);
  const sourceKeyFields = strArray(candidate.sourceKeyFields);
  const targetKeyFields = strArray(candidate.targetKeyFields);
  if (
    !sourceSystem ||
    !sourceDataset ||
    sourceKeyFields.length === 0 ||
    targetKeyFields.length === 0
  ) {
    return null;
  }
  return {
    sourceSystem,
    sourceDataset,
    sourceKeyFields,
    targetKeyFields,
    note: str(candidate.note),
  };
}
