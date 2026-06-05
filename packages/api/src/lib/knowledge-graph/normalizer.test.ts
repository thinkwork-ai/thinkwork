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
  it("grounds approved ontology types and preserves diagnostic unknowns", () => {
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
          { id: "delta", label: "Delta", type: "Partner", properties: {} },
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
            id: "edge-orphan",
            source: "acme",
            target: "missing",
            label: "Uses",
            properties: {},
          },
        ],
      },
    });

    expect(snapshot.entities).toHaveLength(2);
    expect(snapshot.entities[0]).toEqual(
      expect.objectContaining({
        groundingStatus: "grounded",
        provenanceStatus: "strong",
        ontologyEntityTypeId: "entity-type-company",
      }),
    );
    expect(snapshot.entities[1]).toEqual(
      expect.objectContaining({
        groundingStatus: "unapproved_type",
        provenanceStatus: "strong",
      }),
    );
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
      cogneeNodeCount: 2,
      cogneeEdgeCount: 2,
      droppedEdgeCount: 1,
    });
  });
});
