import { describe, expect, it } from "vitest";
import { loadWikiKnowledgeGraphSource } from "./wiki-source.js";

describe("loadWikiKnowledgeGraphSource", () => {
  it("renders active wiki pages as ontology-shaped packets with source evidence", async () => {
    const db = fakeDb([
      [
        {
          id: "page-1",
          type: "entity",
          entitySubtype: "company",
          slug: "acme",
          title: "Acme",
          summary: "Customer account",
          bodyMd: "Acme uses Delta.",
          updatedAt: new Date("2026-06-04T12:00:00.000Z"),
        },
      ],
      [{ pageId: "page-1", alias: "acme corp" }],
      [
        {
          id: "section-1",
          pageId: "page-1",
          slug: "overview",
          heading: "Overview",
          bodyMd: "Acme is evaluating Delta.",
          position: 10,
          lastSourceAt: new Date("2026-06-04T12:05:00.000Z"),
        },
      ],
      [],
      [
        {
          sectionId: "section-1",
          sourceKind: "memory_unit",
          sourceRef: "memory-1",
        },
      ],
    ]);

    const bundle = await loadWikiKnowledgeGraphSource({
      db,
      tenantId: "tenant-1",
      ownerUserId: "user-1",
      sourceRef: "owner:user-1:pages:page-1",
      sourceLabel: "Wiki smoke",
      pageIds: ["page-1"],
      ontology: {
        mechanism: "cognee_owl_ontology",
        entityTypes: [
          {
            id: "type-1",
            slug: "company",
            name: "Company",
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
    expect(bundle.document).toContain("ontology_type_slug: company");
    expect(bundle.document).toContain("aliases: acme corp");
    expect(bundle.document).toContain("citations: memory_unit:memory-1");
    expect(bundle.evidence.map((item) => item.evidenceSourceKind)).toEqual([
      "wiki_page",
      "wiki_section",
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
