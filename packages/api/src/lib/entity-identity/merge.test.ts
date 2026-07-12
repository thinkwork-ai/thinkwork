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
  loserWikiPageId: "page-l",
  loserWikiPageSlug: "acme-corp",
  survivorWikiPageId: "page-s",
};

describe("impactMatches", () => {
  it("matches identical previews", () => {
    expect(impactMatches(impact, { ...impact })).toBe(true);
  });

  it("rejects any drifted count or page id (stale preview guard)", () => {
    expect(impactMatches(impact, { ...impact, memoryClaimCount: 5 })).toBe(
      false,
    );
    expect(impactMatches(impact, { ...impact, loserWikiPageId: null })).toBe(
      false,
    );
    expect(
      impactMatches(impact, { ...impact, survivorWikiPageId: "other" }),
    ).toBe(false);
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
