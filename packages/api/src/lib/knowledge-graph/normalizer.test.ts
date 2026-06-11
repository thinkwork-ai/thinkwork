import { describe, expect, it } from "vitest";
import { normalizeCogneeGraph } from "./normalizer.js";

const transcript = [
  {
    id: "message-1",
    role: "user",
    senderType: "user",
    senderId: "user-1",
    speakerLabel: "User",
    text: "Acme uses Delta for fulfillment. Acme acquired Beta.",
    createdAt: new Date("2026-06-04T12:00:00.000Z"),
    ordinal: 0,
  },
];

const ontology = {
  mechanism: "cognee_owl_ontology" as const,
  entityTypes: [
    {
      id: "entity-type-company",
      slug: "company",
      name: "Company",
      description: null,
      aliases: ["Organization"],
    },
  ],
  relationshipTypes: [
    {
      id: "relationship-type-uses",
      slug: "uses",
      name: "Uses",
      description: null,
      aliases: [],
      sourceTypeSlugs: ["company"],
      targetTypeSlugs: ["company"],
    },
  ],
  customPrompt: "Extract the approved graph.",
  ontologyKey: "thinkwork_tenant_abc123",
  ontologyOwlXml: "<rdf:RDF></rdf:RDF>",
};

describe("normalizeCogneeGraph", () => {
  it("keeps approved ontology entities and triples from Cognee graph output", () => {
    const snapshot = normalizeCogneeGraph({
      transcript,
      ontology,
      graph: {
        nodes: [
          {
            id: "acme",
            label: "Acme",
            type: "Company",
            properties: { aliases: ["Acme Inc."], summary: "Customer" },
          },
          {
            id: "delta",
            label: "Delta",
            type: "Entity",
            properties: { is_a: { name: "Company" }, ontology_valid: true },
          },
          {
            id: "chunk-1",
            label: "DocumentChunk_c12056",
            type: "DocumentChunk",
            properties: {},
          },
          {
            id: "beta",
            label: "Beta",
            type: "Partner",
            properties: { ontology_valid: false },
          },
          {
            id: "solo",
            label: "Solo",
            type: "Company",
            properties: { ontology_valid: true },
          },
        ],
        edges: [
          {
            id: "edge-1",
            source: "acme",
            target: "delta",
            label: "Uses",
            properties: { confidence: 0.8 },
          },
          {
            id: "edge-structural",
            source: "chunk-1",
            target: "acme",
            label: "contains",
            properties: {},
          },
          {
            id: "edge-unapproved-type",
            source: "acme",
            target: "beta",
            label: "Uses",
            properties: {},
          },
          {
            id: "edge-unapproved-relationship",
            source: "acme",
            target: "delta",
            label: "Acquired",
            properties: {},
          },
          {
            id: "edge-orphan",
            source: "acme",
            target: "missing",
            label: "Uses",
            properties: {},
          },
        ],
      },
    });

    expect(snapshot.entities).toHaveLength(3);
    expect(snapshot.entities).toEqual([
      expect.objectContaining({
        label: "Acme",
        groundingStatus: "grounded",
        provenanceStatus: "strong",
        ontologyEntityTypeId: "entity-type-company",
      }),
      expect.objectContaining({
        label: "Delta",
        groundingStatus: "grounded",
        provenanceStatus: "strong",
        ontologyEntityTypeId: "entity-type-company",
      }),
      expect.objectContaining({
        label: "Solo",
        groundingStatus: "grounded",
        provenanceStatus: "missing",
        ontologyEntityTypeId: "entity-type-company",
      }),
    ]);
    expect(snapshot.relationships).toEqual([
      expect.objectContaining({
        groundingStatus: "grounded",
        provenanceStatus: "strong",
        ontologyRelationshipTypeId: "relationship-type-uses",
        confidence: 0.8,
      }),
    ]);
    expect(snapshot.evidence).toHaveLength(3);
    expect(snapshot.metrics).toEqual({
      cogneeNodeCount: 5,
      cogneeEdgeCount: 5,
      droppedNodeCount: 2,
      droppedEdgeCount: 4,
      structuralNodeCount: 1,
      unapprovedNodeCount: 1,
      outOfScopeNodeCount: 0,
      isolatedNodeCount: 1,
      unapprovedRelationshipCount: 1,
      incompatibleRelationshipCount: 0,
      orphanRelationshipCount: 3,
      droppedNodeSamples: [
        {
          id: "chunk-1",
          label: "DocumentChunk_c12056",
          rawType: "DocumentChunk",
          dropReason: "structural_node",
          propertyKeys: [],
        },
        {
          id: "beta",
          label: "Beta",
          rawType: "Partner",
          dropReason: "unapproved_entity_type",
          propertyKeys: ["ontology_valid"],
        },
      ],
      droppedEdgeSamples: [
        {
          id: "edge-structural",
          label: "contains",
          rawType: null,
          sourceId: "chunk-1",
          sourceLabel: "DocumentChunk_c12056",
          targetId: "acme",
          targetLabel: "Acme",
          dropReason: "orphan_endpoint",
          propertyKeys: [],
        },
        {
          id: "edge-unapproved-type",
          label: "Uses",
          rawType: null,
          sourceId: "acme",
          sourceLabel: "Acme",
          targetId: "beta",
          targetLabel: "Beta",
          dropReason: "orphan_endpoint",
          propertyKeys: [],
        },
        {
          id: "edge-unapproved-relationship",
          label: "Acquired",
          rawType: null,
          sourceId: "acme",
          sourceLabel: "Acme",
          targetId: "delta",
          targetLabel: "Delta",
          dropReason: "unapproved_relationship_type",
          propertyKeys: [],
        },
        {
          id: "edge-orphan",
          label: "Uses",
          rawType: null,
          sourceId: "acme",
          sourceLabel: "Acme",
          targetId: "missing",
          targetLabel: null,
          dropReason: "orphan_endpoint",
          propertyKeys: [],
        },
      ],
    });
  });

  it("resolves entity type from an is_a EDGE to an EntityType node (not a property)", () => {
    // Cognee real shape: generic Entity nodes + an EntityType node + an is_a
    // edge linking them. No is_a property anywhere.
    const snapshot = normalizeCogneeGraph({
      transcript,
      ontology,
      graph: {
        nodes: [
          { id: "acme", label: "Acme", type: "Entity", properties: {} },
          {
            id: "et-company",
            label: "Company",
            type: "EntityType",
            properties: {},
          },
        ],
        edges: [
          {
            id: null,
            source: "acme",
            target: "et-company",
            label: "is_a",
            properties: {},
          },
        ],
      },
    });
    // Acme is typed via the edge → kept; the EntityType node is structural.
    expect(snapshot.entities.map((e) => e.label)).toEqual(["Acme"]);
    expect(snapshot.entities[0].ontologyTypeSlug).toBe("company");
    expect(snapshot.metrics.unapprovedNodeCount).toBe(0);
  });

  it("scopes entities to the requested NodeSet via belongs_to_set edges", () => {
    const graph = {
      nodes: [
        { id: "obs-ent", label: "Acme", type: "Entity", properties: {} },
        { id: "thr-ent", label: "Beta", type: "Entity", properties: {} },
        {
          id: "et-company",
          label: "Company",
          type: "EntityType",
          properties: {},
        },
        {
          id: "ns-obs",
          label: "thinkwork_observations",
          type: "NodeSet",
          properties: {},
        },
        {
          id: "ns-thread",
          label: "thread_abc",
          type: "NodeSet",
          properties: {},
        },
      ],
      edges: [
        {
          id: null,
          source: "obs-ent",
          target: "et-company",
          label: "is_a",
          properties: {},
        },
        {
          id: null,
          source: "thr-ent",
          target: "et-company",
          label: "is_a",
          properties: {},
        },
        {
          id: null,
          source: "obs-ent",
          target: "ns-obs",
          label: "belongs_to_set",
          properties: {},
        },
        {
          id: null,
          source: "thr-ent",
          target: "ns-thread",
          label: "belongs_to_set",
          properties: {},
        },
      ],
    };
    // Scoped to observations: only the observation entity survives.
    const scoped = normalizeCogneeGraph({
      transcript,
      ontology,
      graph,
      scopeNodeSetSubstrings: ["observations"],
    });
    expect(scoped.entities.map((e) => e.label)).toEqual(["Acme"]);
    expect(scoped.metrics.outOfScopeNodeCount).toBe(1);
    // No scope: both typed entities survive.
    const unscoped = normalizeCogneeGraph({ transcript, ontology, graph });
    expect(unscoped.entities.map((e) => e.label).sort()).toEqual([
      "Acme",
      "Beta",
    ]);
    expect(unscoped.metrics.outOfScopeNodeCount).toBe(0);
  });
});
