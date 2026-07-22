import { describe, expect, it } from "vitest";
import { renderTwinOntology } from "./describe-ontology.js";
import type { TwinMappingExport } from "../ontology/twin-export.js";

const FIXTURE: TwinMappingExport = {
  format: "twin-mapping/v1",
  tenantId: "tenant-1",
  ontologyVersion: 7,
  sequence: 12,
  contentHash: "abc",
  compiledAt: "2026-07-22T00:00:00.000Z",
  entities: [
    {
      slug: "customer",
      name: "Customer",
      facets: [
        {
          slug: "profile",
          clonePolicy: "clone",
          cadence: null,
          sourceSystem: "twenty",
          sourceDataset: null,
          attributes: [
            { sourceField: "name", attribute: "name", filterType: "string" },
          ],
          note: null,
        },
        {
          slug: "aging",
          clonePolicy: "clone",
          cadence: "6h",
          sourceSystem: "p21",
          sourceDataset: "ar_aging",
          attributes: [
            {
              sourceField: "days_past_due",
              attribute: "days_past_due",
              filterType: "number",
            },
          ],
          note: null,
        },
      ],
      pageSections: [],
    },
    {
      slug: "tank_monitor",
      name: "Tank Monitor",
      facets: [],
      pageSections: [],
    },
  ],
  relationships: [
    {
      slug: "has_invoice",
      name: "Has invoice",
      sourceTypeSlugs: ["customer"],
      targetTypeSlugs: ["invoice"],
      binding: null,
    },
  ],
} as TwinMappingExport;

describe("renderTwinOntology (AE6 fitness)", () => {
  it("names every entity type, facet property in f_<facet>__<attr> form, and relationship endpoints", () => {
    const text = renderTwinOntology(FIXTURE);
    expect(text).toContain("customer — Customer");
    expect(text).toContain("tank_monitor — Tank Monitor");
    expect(text).toContain("f_profile__name (string)");
    expect(text).toContain("f_aging__days_past_due (number)");
    expect(text).toContain("`has_invoice` (Has invoice): customer -> invoice");
  });

  it("states the addressing contract a cold model needs", () => {
    const text = renderTwinOntology(FIXTURE);
    expect(text).toContain("Node label = the entity type slug");
    expect(text).toContain("f_<facet>__state");
    expect(text).toContain("displayName");
    expect(text).toContain("opaque");
    expect(text).toContain("LIMIT");
  });

  it("includes worked query examples", () => {
    const text = renderTwinOntology(FIXTURE);
    expect((text.match(/```/g) ?? []).length).toBeGreaterThanOrEqual(6);
    expect(text).toContain("MATCH (c:customer)");
  });
});
