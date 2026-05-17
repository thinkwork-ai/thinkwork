import { describe, expect, it } from "vitest";
import { analyzeOntologyReprocessImpact } from "./impact.js";
import { buildOntologyReprocessDedupeKey } from "./reprocess.js";

class FakeImpactDb {
  constructor(private rows: unknown[][]) {}

  select() {
    const rows = this.rows.shift() ?? [];
    return {
      from: () => ({
        where: () => ({
          orderBy: () => Promise.resolve(rows),
          limit: () => Promise.resolve(rows),
        }),
      }),
    };
  }
}

describe("ontology reprocess", () => {
  it("builds stable dedupe keys with explicit continuation suffixes", () => {
    expect(
      buildOntologyReprocessDedupeKey({
        tenantId: "tenant-1",
        changeSetId: "change-set-1",
        ontologyVersionId: "version-1",
      }),
    ).toBe("ontology:tenant-1:change-set-1:version-1");
    expect(
      buildOntologyReprocessDedupeKey({
        tenantId: "tenant-1",
        changeSetId: "change-set-1",
        ontologyVersionId: "version-1",
        continuation: 2,
      }),
    ).toBe("ontology:tenant-1:change-set-1:version-1:continuation:2");
  });

  it("reports affected Brain pages, external refs, and visible cap continuation", async () => {
    const db = new FakeImpactDb([
      [{ id: "page-1" }, { id: "page-2" }, { id: "page-3" }],
      [{ id: "external-1" }],
    ]);

    const impact = await analyzeOntologyReprocessImpact({
      tenantId: "tenant-1",
      pageCap: 2,
      db: db as any,
      items: [
        {
          item_type: "relationship_type",
          action: "create",
          target_slug: "customer_has_risk",
          proposed_value: {
            slug: "customer_has_risk",
            sourceTypeSlugs: ["customer"],
            targetTypeSlugs: ["risk"],
          },
        },
        {
          item_type: "facet_template",
          action: "create",
          target_slug: "risk_register",
          proposed_value: {
            entityTypeSlug: "customer",
            slug: "risk_register",
            sourcePriority: ["support_case"],
          },
        },
      ],
    });

    expect(impact).toMatchObject({
      affectedEntityTypeSlugs: ["customer", "risk"],
      affectedPageIds: ["page-1", "page-2"],
      affectedPageCount: 3,
      affectedExternalRefCount: 1,
      impactedFacetSlugs: ["risk_register"],
      impactedRelationshipSlugs: ["customer_has_risk"],
      capHit: true,
      continuation: {
        pageOffset: 2,
        remainingPageCount: 1,
      },
    });
  });
});
