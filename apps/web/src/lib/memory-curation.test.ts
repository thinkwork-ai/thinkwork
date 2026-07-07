import { describe, expect, it } from "vitest";
import { isCuratedMemory } from "./memory-curation";

describe("isCuratedMemory", () => {
  it("keeps consolidated observations", () => {
    expect(isCuratedMemory({ factType: "observation" })).toBe(true);
  });

  it("keeps corroborated units (proofCount > 1)", () => {
    expect(isCuratedMemory({ factType: "world", proofCount: 3 })).toBe(true);
    expect(isCuratedMemory({ factType: "world", proofCount: 1 })).toBe(false);
  });

  it("keeps deliberate sources by tag", () => {
    expect(
      isCuratedMemory({
        factType: "world",
        tags: ["source:high-confidence-fact", "scope:thread"],
      }),
    ).toBe(true);
    expect(
      isCuratedMemory({ factType: "world", tags: ["scope:document"] }),
    ).toBe(true);
    expect(
      isCuratedMemory({ factType: "world", tags: ["scope:explicit-memory"] }),
    ).toBe(true);
  });

  it("hides raw uncorroborated chat fragments", () => {
    expect(
      isCuratedMemory({
        factType: "world",
        proofCount: 1,
        tags: ["source:thread", "scope:personal", "scope:thread"],
      }),
    ).toBe(false);
    expect(isCuratedMemory({})).toBe(false);
  });
});
