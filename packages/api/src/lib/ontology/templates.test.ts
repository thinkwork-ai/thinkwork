import { describe, expect, it } from "vitest";
import {
  describeOntologyTemplate,
  resolveOntologyTemplates,
  SEED_ONTOLOGY_TEMPLATES,
} from "./templates.js";

class FakeTemplateDb {
  constructor(private readonly results: unknown[][]) {}

  select() {
    const rows = this.results.shift() ?? [];
    return {
      from: () => ({
        where: () => ({
          orderBy: () => Promise.resolve(rows),
        }),
      }),
    };
  }
}

describe("ontology templates", () => {
  it("uses seed templates when no tenant-approved template exists", async () => {
    const templates = await resolveOntologyTemplates({
      tenantId: "tenant-1",
      db: new FakeTemplateDb([[], []]) as any,
    });

    expect(templates.customer).toMatchObject({
      source: "seed",
      entityTypeSlug: "customer",
    });
    expect(
      templates.customer.sections.map((section) => section.slug),
    ).toContain("open_commitments");
    expect(
      templates.customer.sections.map((section) => section.slug),
    ).toContain("risks_and_landmines");
  });

  it("lets approved tenant facets define authoritative section order", async () => {
    const templates = await resolveOntologyTemplates({
      tenantId: "tenant-1",
      db: new FakeTemplateDb([
        [
          {
            id: "entity-customer",
            slug: "customer",
            name: "Customer",
            broad_type: "entity",
            description: null,
            guidance_notes: "Tenant-specific customer page guidance.",
          },
        ],
        [
          {
            entity_type_id: "entity-customer",
            slug: "risks_and_landmines",
            heading: "Risks & Landmines",
            facet_type: "compiled",
            position: 20,
            source_priority: ["support_case"],
            prompt: null,
            guidance_notes: null,
            lifecycle_status: "approved",
          },
          {
            entity_type_id: "entity-customer",
            slug: "open_commitments",
            heading: "Open Commitments",
            facet_type: "activity",
            position: 10,
            source_priority: ["hindsight_memory_unit"],
            prompt: null,
            guidance_notes: null,
            lifecycle_status: "approved",
          },
        ],
      ]) as any,
    });

    expect(templates.customer.source).toBe("tenant");
    expect(templates.customer.sections.map((section) => section.slug)).toEqual([
      "open_commitments",
      "risks_and_landmines",
    ]);
    expect(describeOntologyTemplate(templates.customer)).toContain(
      "open_commitments",
    );
  });

  it("keeps meeting-context customer facets in the seed contract", () => {
    const slugs = SEED_ONTOLOGY_TEMPLATES.customer.sections.map(
      (section) => section.slug,
    );

    expect(slugs).toEqual(
      expect.arrayContaining([
        "key_people",
        "opportunities",
        "open_commitments",
        "risks_and_landmines",
        "recent_activity",
      ]),
    );
  });
});
