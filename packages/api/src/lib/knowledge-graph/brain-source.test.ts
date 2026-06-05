import { describe, expect, it } from "vitest";
import { loadBrainKnowledgeGraphSource } from "./brain-source.js";

describe("loadBrainKnowledgeGraphSource", () => {
  it("renders tenant brain pages as ontology-shaped packets with facet evidence", async () => {
    const db = fakeDb([
      [
        {
          id: "brain-1",
          type: "entity",
          entitySubtype: "customer",
          slug: "bunkhouse",
          title: "Bunkhouse",
          summary: "Hospitality customer",
          bodyMd: "Bunkhouse has a Mexico City hotel opportunity.",
          updatedAt: new Date("2026-06-04T12:00:00.000Z"),
        },
      ],
      [
        {
          fromPageId: "brain-1",
          toPageId: "brain-2",
          kind: "located_in",
          context: "Expansion market",
        },
      ],
      [
        {
          id: "brain-2",
          type: "entity",
          entitySubtype: "place",
          slug: "mexico-city",
          title: "Mexico City",
          summary: "Expansion market",
          bodyMd: "Mexico City is the expansion market.",
          updatedAt: new Date("2026-06-04T11:00:00.000Z"),
        },
      ],
      [{ pageId: "brain-1", alias: "bunkhouse hotels" }],
      [
        {
          id: "facet-1",
          pageId: "brain-1",
          slug: "opportunities",
          heading: "Opportunities",
          bodyMd: "Mexico City expansion is active.",
          position: 20,
          lastSourceAt: new Date("2026-06-04T12:05:00.000Z"),
          aggregation: { facet_type: "operational" },
        },
      ],
      [
        {
          fromPageId: "brain-1",
          toPageId: "brain-2",
          kind: "located_in",
          context: "Expansion market",
        },
      ],
      [
        {
          sectionId: "facet-1",
          sourceKind: "crm_opportunity",
          sourceRef: "opp-1",
        },
      ],
    ]);

    const bundle = await loadBrainKnowledgeGraphSource({
      db,
      tenantId: "tenant-1",
      sourceRef: "pages:brain-1",
      sourceLabel: "Brain smoke",
      pageIds: ["brain-1"],
      ontology: {
        mechanism: "cognee_owl_ontology",
        entityTypes: [
          {
            id: "type-1",
            slug: "customer",
            name: "Customer",
            description: null,
            aliases: [],
          },
          {
            id: "type-2",
            slug: "place",
            name: "Place",
            description: null,
            aliases: [],
          },
        ],
        relationshipTypes: [
          {
            id: "rel-1",
            slug: "located_in",
            name: "Located in",
            description: null,
            aliases: [],
            sourceTypeSlugs: ["customer"],
            targetTypeSlugs: ["place"],
          },
        ],
        customPrompt: "Extract",
        ontologyKey: null,
        ontologyOwlXml: null,
      },
    });

    expect(bundle.packetCount).toBe(2);
    expect(bundle.packets).toMatchObject([
      {
        id: "brain-1",
        title: "Bunkhouse",
        entityTypeSlug: "customer",
        trustedOntologyType: true,
        metadata: {
          summary: "Hospitality customer",
          aliases: ["bunkhouse hotels"],
        },
      },
      {
        id: "brain-2",
        title: "Mexico City",
        entityTypeSlug: "place",
        trustedOntologyType: true,
      },
    ]);
    expect(bundle.relationships).toMatchObject([
      {
        fromPacketId: "brain-1",
        toPacketId: "brain-2",
        relationshipTypeSlug: "located_in",
        trustedOntologyType: true,
      },
    ]);
    expect(bundle.document).toContain("ontology_type_slug: customer");
    expect(bundle.document).toContain("ontology_type_slug: place");
    expect(bundle.document).toContain("facet_type: operational");
    expect(bundle.document).toContain("citations: crm_opportunity:opp-1");
    expect(bundle.evidence.map((item) => item.evidenceSourceKind)).toEqual([
      "brain_page",
      "brain_section",
      "brain_page",
    ]);
    expect(bundle.diagnostics).toMatchObject({
      untrustedPacketCount: 0,
      expandedLinkedPageCount: 1,
      expandedLinkedPageIds: ["brain-2"],
    });
  });
});

function fakeDb(results: unknown[][]): any {
  let index = 0;
  return {
    select() {
      const result = results[index++] ?? [];
      return fakeQuery(result, index);
    },
  };
}

function fakeQuery(result: unknown[], index: number): any {
  const query: any = {
    from: () => query,
    innerJoin: () => query,
    where: () => {
      if ([2, 4, 6, 7].includes(index)) return Promise.resolve(result);
      return query;
    },
    orderBy: () => {
      if (index === 5) return Promise.resolve(result);
      return query;
    },
    limit: () => Promise.resolve(result),
  };
  return query;
}
