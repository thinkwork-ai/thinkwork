import type { WikiSectionSourceKind } from "../wiki/repository.js";

export const KNOWN_ENTITY_SUBTYPES = [
  "customer",
  "opportunity",
  "order",
  "person",
  "concept",
  "reflection",
] as const;

export type EntitySubtype = (typeof KNOWN_ENTITY_SUBTYPES)[number];
export type TenantEntitySubtype = Extract<
  EntitySubtype,
  "customer" | "opportunity" | "order" | "person"
>;
export type PersonalEntitySubtype = Extract<
  EntitySubtype,
  "concept" | "reflection"
>;

export const TENANT_ENTITY_SUBTYPES: TenantEntitySubtype[] = [
  "customer",
  "opportunity",
  "order",
  "person",
];

export const PERSONAL_ENTITY_SUBTYPES: PersonalEntitySubtype[] = [
  "concept",
  "reflection",
];

export const FACET_TYPES = [
  "operational",
  "relationship",
  "activity",
  "compiled",
  "kb_sourced",
  "external",
] as const;

export type FacetType = (typeof FACET_TYPES)[number];

export const TRUST_RANK: Record<FacetType, number> = {
  operational: 5,
  relationship: 4,
  compiled: 3,
  kb_sourced: 2,
  activity: 2,
  external: 1,
};

export const KNOWN_SECTION_SOURCE_KINDS = [
  "memory_unit",
  "artifact",
  "journal_idea",
  "hindsight_memory_unit",
  "erp_customer",
  "crm_opportunity",
  "erp_order",
  "crm_person",
  "support_case",
  "bedrock_kb",
  "web_url",
  "mcp_url",
] as const;

export type BrainSectionSourceKind =
  | WikiSectionSourceKind
  | (typeof KNOWN_SECTION_SOURCE_KINDS)[number];

export interface FactCitation {
  kind: BrainSectionSourceKind;
  ref: string;
  label?: string;
  asOf?: string;
  metadata?: Record<string, unknown>;
}

export function isKnownEntitySubtype(value: string): value is EntitySubtype {
  return (KNOWN_ENTITY_SUBTYPES as readonly string[]).includes(value);
}

export function isTenantEntitySubtype(
  value: string,
): value is TenantEntitySubtype {
  return (TENANT_ENTITY_SUBTYPES as readonly string[]).includes(value);
}

export function isKnownSectionSourceKind(
  value: string,
): value is BrainSectionSourceKind {
  return (KNOWN_SECTION_SOURCE_KINDS as readonly string[]).includes(value);
}

export function canPromote(fromFacet: FacetType, toFacet: FacetType): boolean {
  return TRUST_RANK[fromFacet] >= TRUST_RANK[toFacet];
}

export function isKnownFacetType(value: string): value is FacetType {
  return (FACET_TYPES as readonly string[]).includes(value);
}

export function normalizeFacetType(
  value: string | null | undefined,
  fallback: FacetType = "compiled",
): FacetType {
  return value && isKnownFacetType(value) ? value : fallback;
}

export function isHigherTrustFacet(
  existingFacet: FacetType,
  incomingFacet: FacetType,
): boolean {
  return TRUST_RANK[existingFacet] > TRUST_RANK[incomingFacet];
}

export function deriveSourceFacetType(sources: FactCitation[]): FacetType {
  if (sources.length === 0) return "external";
  const tiers = sources.map((source) => facetTypeForSourceKind(source.kind));
  return tiers.reduce((lowest, next) =>
    TRUST_RANK[next] < TRUST_RANK[lowest] ? next : lowest,
  );
}

export function facetTypeForSourceKind(
  kind: BrainSectionSourceKind,
): FacetType {
  switch (kind) {
    case "erp_customer":
    case "crm_opportunity":
    case "erp_order":
    case "crm_person":
    case "support_case":
      return "operational";
    case "memory_unit":
    case "hindsight_memory_unit":
    case "journal_idea":
      return "activity";
    case "bedrock_kb":
      return "kb_sourced";
    case "artifact":
    case "web_url":
    case "mcp_url":
    default:
      return "external";
  }
}
