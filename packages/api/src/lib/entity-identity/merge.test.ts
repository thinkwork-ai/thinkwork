import { describe, expect, it } from "vitest";
import {
  impactMatches,
  validateMergePreconditions,
  type MergeImpactPreview,
} from "./merge.js";

const impact: MergeImpactPreview = {
  sourceMappingCount: 2,
  identityClaimCount: 3,
  memoryClaimCount: 4,
  graphEntityCount: 5,
};

describe("impactMatches", () => {
  it("matches identical previews", () => {
    expect(impactMatches(impact, { ...impact })).toBe(true);
  });

  it("rejects any drifted count (stale preview guard)", () => {
    expect(impactMatches(impact, { ...impact, memoryClaimCount: 5 })).toBe(
      false,
    );
    expect(impactMatches(impact, { ...impact, sourceMappingCount: 9 })).toBe(
      false,
    );
    expect(impactMatches(impact, { ...impact, graphEntityCount: 0 })).toBe(
      false,
    );
  });

  it("carries no wiki page fields (wiki removal U5)", () => {
    // Merge used to archive the loser's compiled Entity page and carry its
    // slug forward as a survivor alias. The twin re-projects from canonical
    // entities, so a merged loser simply stops being projected — there is no
    // page convergence left to preview or confirm.
    expect(Object.keys(impact).sort()).toEqual([
      "graphEntityCount",
      "identityClaimCount",
      "memoryClaimCount",
      "sourceMappingCount",
    ]);
  });
});

describe("validateMergePreconditions", () => {
  const active = { status: "active", entity_type_slug: "company" };

  it("accepts two distinct active entities of the same type", () => {
    expect(() =>
      validateMergePreconditions({
        survivorId: "a",
        loserId: "b",
        survivor: active,
        loser: { ...active },
      }),
    ).not.toThrow();
  });

  it("rejects self-merge", () => {
    expect(() =>
      validateMergePreconditions({
        survivorId: "a",
        loserId: "a",
        survivor: active,
        loser: active,
      }),
    ).toThrow(/distinct/);
  });

  it("rejects missing or non-active entities", () => {
    expect(() =>
      validateMergePreconditions({
        survivorId: "a",
        loserId: "b",
        survivor: null,
        loser: active,
      }),
    ).toThrow(/Survivor/);
    expect(() =>
      validateMergePreconditions({
        survivorId: "a",
        loserId: "b",
        survivor: active,
        loser: { status: "merged", entity_type_slug: "company" },
      }),
    ).toThrow(/merged/);
  });

  it("rejects cross-type merges", () => {
    expect(() =>
      validateMergePreconditions({
        survivorId: "a",
        loserId: "b",
        survivor: active,
        loser: { status: "active", entity_type_slug: "person" },
      }),
    ).toThrow(/different ontology types/);
  });
});
