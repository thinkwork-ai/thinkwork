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
      isolatedNodeCount: 1,
      unapprovedRelationshipCount: 1,
      incompatibleRelationshipCount: 0,
      orphanRelationshipCount: 3,
    });
  });
});
