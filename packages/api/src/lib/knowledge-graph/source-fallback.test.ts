import { describe, expect, it } from "vitest";
import { applySourceDeclaredFallback } from "./source-fallback.js";
import type { NormalizedKnowledgeGraphSnapshot } from "./normalizer.js";

const emptySnapshot: NormalizedKnowledgeGraphSnapshot = {
  entities: [],
  relationships: [],
  evidence: [],
  metrics: {
    cogneeNodeCount: 4,
    cogneeEdgeCount: 3,
    droppedNodeCount: 4,
    droppedEdgeCount: 3,
    structuralNodeCount: 4,
    unapprovedNodeCount: 0,
    outOfScopeNodeCount: 0,
    isolatedNodeCount: 0,
    unapprovedRelationshipCount: 0,
    incompatibleRelationshipCount: 0,
    orphanRelationshipCount: 3,
    droppedNodeSamples: [],
    droppedEdgeSamples: [],
  },
};

describe("applySourceDeclaredFallback", () => {
  it("creates grounded entities and relationships from trusted source packets", () => {
    const snapshot = applySourceDeclaredFallback({
      snapshot: emptySnapshot,
      ontology: {
        mechanism: "cognee_owl_ontology",
        customPrompt: "Extract",
        ontologyKey: null,
        ontologyOwlXml: null,
        entityTypes: [
          {
            id: "type-customer",
            slug: "customer",
            name: "Customer",
            description: null,
            aliases: [],
          },
          {
            id: "type-opportunity",
            slug: "opportunity",
            name: "Opportunity",
            description: null,
            aliases: [],
          },
        ],
        relationshipTypes: [
          {
            id: "rel-opportunity",
            slug: "has_opportunity",
            name: "Has opportunity",
            description: null,
            aliases: [],
            sourceTypeSlugs: ["customer"],
            targetTypeSlugs: ["opportunity"],
          },
        ],
      },
      source: {
        sourceKind: "brain",
        sourceRef: "pages:bunkhouse",
        sourceLabel: "Brain",
        document: "doc",
        packetCount: 2,
        skippedCount: 0,
        diagnostics: {},
        packets: [
          {
            id: "customer-1",
            title: "Bunkhouse",
            entityTypeSlug: "customer",
            trustedOntologyType: true,
            text: "Bunkhouse",
            metadata: {
              summary: "Hospitality customer",
              aliases: ["Bunkhouse Hotels"],
            },
          },
          {
            id: "opportunity-1",
            title: "Mexico City expansion",
            entityTypeSlug: "opportunity",
            trustedOntologyType: true,
            text: "Mexico City expansion",
            metadata: {},
          },
        ],
        relationships: [
          {
            id: "customer-1:has_opportunity:opportunity-1",
            fromPacketId: "customer-1",
            toPacketId: "opportunity-1",
            relationshipTypeSlug: "has_opportunity",
            trustedOntologyType: true,
            label: "has_opportunity",
            context: "active",
            metadata: {},
          },
        ],
        evidence: [
          {
            id: "customer-1",
            role: "source",
            senderType: "brain",
            senderId: null,
            speakerLabel: "Brain page: Bunkhouse",
            text: "Bunkhouse is a hospitality customer.",
            createdAt: new Date("2026-06-05T12:00:00.000Z"),
            ordinal: 0,
            evidenceSourceKind: "brain_page",
            evidenceSourceRef: "customer-1",
            evidenceMetadata: { pageId: "customer-1" },
          },
        ],
      },
    });

    expect(snapshot.entities).toHaveLength(2);
    expect(snapshot.entities[0]).toMatchObject({
      label: "Bunkhouse",
      ontologyTypeSlug: "customer",
      provenanceStatus: "strong",
      summary: "Hospitality customer",
      aliases: ["Bunkhouse Hotels"],
    });
    expect(snapshot.relationships).toHaveLength(1);
    expect(snapshot.relationships[0]).toMatchObject({
      label: "Has opportunity",
      ontologyTypeSlug: "has_opportunity",
      sourceTempId: "source-packet:customer-1",
      targetTempId: "source-packet:opportunity-1",
    });
    expect(snapshot.evidence).toHaveLength(2);
    expect(snapshot.metrics).toMatchObject({
      sourceDeclaredFallback: true,
      sourceDeclaredEntityCount: 2,
      sourceDeclaredRelationshipCount: 1,
    });
  });
});
