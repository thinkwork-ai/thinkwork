import { describe, expect, it } from "vitest";
import {
  assembleOntologySchemaGraph,
  filterMappingsForOntologyDefinitions,
} from "./repository.js";

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

describe("assembleOntologySchemaGraph", () => {
  const baselineEntityRows = [
    { slug: "customer", name: "Customer", lifecycle_status: "approved" },
    { slug: "person", name: "Person", lifecycle_status: "approved" },
    { slug: "product", name: "Product", lifecycle_status: "approved" },
    { slug: "project", name: "Project", lifecycle_status: "approved" },
  ];

  it("returns baseline types with zero instance counts and no candidates on a fresh tenant", () => {
    const graph = assembleOntologySchemaGraph({
      tenantId: "tenant-1",
      entityRows: baselineEntityRows,
      relationshipRows: [],
      instanceCountRows: [],
      changeSetRows: [],
      candidateItemRows: [],
      evidenceCountRows: [],
    });

    expect(graph.tenantId).toBe("tenant-1");
    expect(graph.types).toHaveLength(4);
    expect(graph.types.every((type) => type.instanceCount === 0)).toBe(true);
    expect(graph.types[0]).toEqual({
      slug: "customer",
      name: "Customer",
      instanceCount: 0,
      lifecycleStatus: "APPROVED",
    });
    expect(graph.relationships).toEqual([]);
    expect(graph.candidates).toEqual([]);
  });

  it("merges typed kg entity counts onto their types and projects relationship endpoints", () => {
    const graph = assembleOntologySchemaGraph({
      tenantId: "tenant-1",
      entityRows: baselineEntityRows,
      relationshipRows: [
        {
          slug: "works_for",
          name: "Works for",
          source_type_slugs: ["person"],
          target_type_slugs: ["customer"],
        },
      ],
      instanceCountRows: [
        { slug: "customer", count: 7 },
        { slug: "person", count: 3 },
        // Typed entities whose slug has no approved definition don't crash
        // the map — the type row simply isn't there to receive the count.
        { slug: "orphaned_type", count: 9 },
        { slug: null, count: 4 },
      ],
      changeSetRows: [],
      candidateItemRows: [],
      evidenceCountRows: [],
    });

    expect(graph.types.map((type) => [type.slug, type.instanceCount])).toEqual([
      ["customer", 7],
      ["person", 3],
      ["product", 0],
      ["project", 0],
    ]);
    expect(graph.relationships).toEqual([
      {
        slug: "works_for",
        name: "Works for",
        sourceTypeSlugs: ["person"],
        targetTypeSlugs: ["customer"],
      },
    ]);
  });

  it("surfaces pending change-set items as candidates with evidence counts and origin", () => {
    const graph = assembleOntologySchemaGraph({
      tenantId: "tenant-1",
      entityRows: [],
      relationshipRows: [],
      instanceCountRows: [],
      changeSetRows: [
        {
          id: "change-set-1",
          status: "pending_review",
          proposed_by: "suggestion_engine",
        },
        { id: "change-set-2", status: "draft", proposed_by: "user" },
      ],
      candidateItemRows: [
        {
          id: "item-1",
          change_set_id: "change-set-1",
          item_type: "entity_type",
          status: "pending_review",
          target_slug: "work_order",
          proposed_value: { slug: "work_order", name: "Work Order" },
          edited_value: null,
        },
        {
          id: "item-2",
          change_set_id: "change-set-2",
          item_type: "relationship_type",
          status: "pending_review",
          // No target_slug — the candidate slug falls back to the proposal.
          target_slug: null,
          proposed_value: { slug: "assigned_to" },
          edited_value: { slug: "assigned_to", name: "Assigned to" },
        },
      ],
      evidenceCountRows: [
        { itemId: "item-1", count: 12 },
        { itemId: null, count: 5 },
      ],
    });

    expect(graph.candidates).toEqual([
      {
        itemId: "item-1",
        changeSetId: "change-set-1",
        itemType: "ENTITY_TYPE",
        slug: "work_order",
        proposedValue: { slug: "work_order", name: "Work Order" },
        editedValue: null,
        evidenceCount: 12,
        origin: "suggestion_engine",
        status: "PENDING_REVIEW",
      },
      {
        itemId: "item-2",
        changeSetId: "change-set-2",
        itemType: "RELATIONSHIP_TYPE",
        slug: "assigned_to",
        proposedValue: { slug: "assigned_to" },
        editedValue: { slug: "assigned_to", name: "Assigned to" },
        evidenceCount: 0,
        origin: "user",
        status: "PENDING_REVIEW",
      },
    ]);
  });

  it("excludes rejected/approved items and items whose change set is already settled", () => {
    const graph = assembleOntologySchemaGraph({
      tenantId: "tenant-1",
      entityRows: [],
      relationshipRows: [],
      instanceCountRows: [],
      // Settled change sets never reach the assembly (the query filters to
      // draft/pending_review), so their items have no owning row here.
      changeSetRows: [
        {
          id: "change-set-open",
          status: "pending_review",
          proposed_by: "user",
        },
      ],
      candidateItemRows: [
        {
          id: "item-rejected",
          change_set_id: "change-set-open",
          item_type: "entity_type",
          status: "rejected",
          target_slug: "invoice",
          proposed_value: {},
          edited_value: null,
        },
        {
          id: "item-approved",
          change_set_id: "change-set-open",
          item_type: "entity_type",
          status: "approved",
          target_slug: "order",
          proposed_value: {},
          edited_value: null,
        },
        {
          id: "item-orphan",
          change_set_id: "change-set-applied",
          item_type: "entity_type",
          status: "pending_review",
          target_slug: "shipment",
          proposed_value: {},
          edited_value: null,
        },
      ],
      evidenceCountRows: [],
    });

    expect(graph.candidates).toEqual([]);
  });
});
