import { describe, expect, it } from "vitest";
import { filterMappingsForOntologyDefinitions } from "./repository.js";

describe("ontology repository helpers", () => {
  it("keeps mappings for approved definitions and drops mappings for omitted relationship types", () => {
    const mappings = filterMappingsForOntologyDefinitions({
      entityRows: [{ id: "entity-customer" }],
      relationshipRows: [{ id: "rel-owns" }],
      facetRows: [{ id: "facet-summary" }],
      mappingRows: [
        {
          subject_kind: "entity_type",
          subject_id: "entity-customer",
          mapping_kind: "broad",
        },
        {
          subject_kind: "relationship_type",
          subject_id: "rel-owns",
          mapping_kind: "related",
        },
        {
          subject_kind: "relationship_type",
          subject_id: "rel-weak-removed",
          mapping_kind: "related",
        },
      ],
    });

    expect(mappings).toEqual([
      {
        subject_kind: "entity_type",
        subject_id: "entity-customer",
        mapping_kind: "broad",
      },
      {
        subject_kind: "relationship_type",
        subject_id: "rel-owns",
        mapping_kind: "related",
      },
    ]);
  });
});
