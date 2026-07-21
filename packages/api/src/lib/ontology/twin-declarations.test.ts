import { describe, expect, it } from "vitest";
import {
  parsePageSectionDeclarations,
  parseRelationshipSourceBinding,
  parseTwinFacetDeclarations,
} from "./twin-declarations.js";

describe("parseTwinFacetDeclarations", () => {
  it("parses valid declarations and defaults clonePolicy to deep_clone", () => {
    const facets = parseTwinFacetDeclarations([
      {
        slug: "aging",
        sourceSystem: "lastmile",
        cadence: "6h",
        attributes: [
          { sourceField: "amt", attribute: "amount", filterType: "number" },
          { sourceField: "bad" }, // no attribute — dropped
        ],
      },
    ]);
    expect(facets).toHaveLength(1);
    expect(facets[0]).toMatchObject({
      slug: "aging",
      clonePolicy: "deep_clone",
      cadence: "6h",
      sourceSystem: "lastmile",
    });
    expect(facets[0].attributes).toEqual([
      { sourceField: "amt", attribute: "amount", filterType: "number" },
    ]);
  });

  it("drops malformed entries, duplicates, and non-arrays without throwing", () => {
    expect(parseTwinFacetDeclarations(null)).toEqual([]);
    expect(parseTwinFacetDeclarations("nope")).toEqual([]);
    const facets = parseTwinFacetDeclarations([
      { slug: "a", sourceSystem: "s" },
      { slug: "a", sourceSystem: "other" }, // duplicate slug — dropped
      { slug: "", sourceSystem: "s" },
      { sourceSystem: "s" },
      42,
    ]);
    expect(facets).toHaveLength(1);
    expect(facets[0].sourceSystem).toBe("s");
  });

  it("coerces an unknown clonePolicy to deep_clone and keeps 'limited'", () => {
    const facets = parseTwinFacetDeclarations([
      { slug: "a", sourceSystem: "s", clonePolicy: "limited" },
      { slug: "b", sourceSystem: "s", clonePolicy: "yolo" },
    ]);
    expect(facets[0].clonePolicy).toBe("limited");
    expect(facets[1].clonePolicy).toBe("deep_clone");
  });
});

describe("parsePageSectionDeclarations", () => {
  it("sorts by position and applies visibility default", () => {
    const sections = parsePageSectionDeclarations([
      { slug: "b", kind: "knowledge", position: 2 },
      {
        slug: "a",
        heading: "Aging",
        kind: "facet_backed",
        facetSlug: "aging",
        position: 1,
        visibility: "operators_only",
      },
    ]);
    expect(sections.map((s) => s.slug)).toEqual(["a", "b"]);
    expect(sections[0].visibility).toBe("operators_only");
    expect(sections[1].visibility).toBe("all_members");
    expect(sections[1].heading).toBe("b"); // heading falls back to slug
  });

  it("drops facet_backed without facetSlug and live_routed without sourceSystem", () => {
    const sections = parsePageSectionDeclarations([
      { slug: "ghost", kind: "facet_backed" },
      { slug: "live", kind: "live_routed" },
      { slug: "ok", kind: "live_routed", sourceSystem: "twenty" },
    ]);
    expect(sections.map((s) => s.slug)).toEqual(["ok"]);
  });
});

describe("parseRelationshipSourceBinding", () => {
  it("parses a complete binding", () => {
    expect(
      parseRelationshipSourceBinding({
        sourceSystem: "lastmile",
        sourceDataset: "ship_tos",
        sourceKeyFields: ["customer_id"],
        targetKeyFields: ["ship_to_id"],
        note: "ERP FK",
      }),
    ).toEqual({
      sourceSystem: "lastmile",
      sourceDataset: "ship_tos",
      sourceKeyFields: ["customer_id"],
      targetKeyFields: ["ship_to_id"],
      note: "ERP FK",
    });
  });

  it("returns null for incomplete or non-object values", () => {
    expect(parseRelationshipSourceBinding(null)).toBeNull();
    expect(parseRelationshipSourceBinding([])).toBeNull();
    expect(parseRelationshipSourceBinding({ sourceSystem: "x" })).toBeNull();
    expect(
      parseRelationshipSourceBinding({
        sourceSystem: "x",
        sourceDataset: "d",
        sourceKeyFields: [],
        targetKeyFields: ["y"],
      }),
    ).toBeNull();
  });
});
