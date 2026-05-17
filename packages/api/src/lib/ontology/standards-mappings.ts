export interface StandardsMappingCandidate {
  subjectKind: "entity_type" | "relationship_type" | "facet_template";
  subjectSlug: string;
  mappingKind: "exact" | "close" | "broad" | "narrow" | "related";
  vocabulary: string;
  externalUri: string;
  externalLabel: string;
  notes: string;
}

const BUSINESS_TYPE_MAPPINGS: Record<string, StandardsMappingCandidate[]> = {
  customer: [
    {
      subjectKind: "entity_type",
      subjectSlug: "customer",
      mappingKind: "broad",
      vocabulary: "schema.org",
      externalUri: "https://schema.org/Organization",
      externalLabel: "Organization",
      notes:
        "Schema.org remains metadata for interoperability; ThinkWork keeps customer as the product-native canonical type.",
    },
  ],
  person: [
    {
      subjectKind: "entity_type",
      subjectSlug: "person",
      mappingKind: "close",
      vocabulary: "schema.org",
      externalUri: "https://schema.org/Person",
      externalLabel: "Person",
      notes: "Close external mapping for people referenced in business memory.",
    },
  ],
  commitment: [
    {
      subjectKind: "entity_type",
      subjectSlug: "commitment",
      mappingKind: "related",
      vocabulary: "schema.org",
      externalUri: "https://schema.org/Action",
      externalLabel: "Action",
      notes:
        "A business commitment can be represented as an actionable obligation, but the canonical ThinkWork type remains commitment.",
    },
  ],
  support_case: [
    {
      subjectKind: "entity_type",
      subjectSlug: "support_case",
      mappingKind: "close",
      vocabulary: "schema.org",
      externalUri: "https://schema.org/Service",
      externalLabel: "Service",
      notes:
        "Support cases are service-adjacent business records, not a direct imported schema type.",
    },
  ],
};

export function standardsMappingsForTypeSlug(
  slug: string,
): StandardsMappingCandidate[] {
  return BUSINESS_TYPE_MAPPINGS[slug] ?? [];
}
