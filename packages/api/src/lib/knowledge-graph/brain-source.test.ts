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
      [],
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
        ],
        relationshipTypes: [],
        customPrompt: "Extract",
        ontologyKey: null,
        ontologyOwlXml: null,
      },
    });

    expect(bundle.packetCount).toBe(1);
    expect(bundle.document).toContain("ontology_type_slug: customer");
    expect(bundle.document).toContain("facet_type: operational");
    expect(bundle.document).toContain("citations: crm_opportunity:opp-1");
    expect(bundle.evidence.map((item) => item.evidenceSourceKind)).toEqual([
      "brain_page",
      "brain_section",
    ]);
    expect(bundle.diagnostics).toMatchObject({ untrustedPacketCount: 0 });
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
      if ([2, 4, 5].includes(index)) return Promise.resolve(result);
      return query;
    },
    orderBy: () => {
      if (index === 3) return Promise.resolve(result);
      return query;
    },
    limit: () => Promise.resolve(result),
  };
  return query;
}
