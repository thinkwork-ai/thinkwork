import { describe, expect, it } from "vitest";
import {
  isPlatformTemplate,
  mergeTemplates,
  suggestedCloneName,
  suggestedCloneSlug,
} from "./-merge-templates";

describe("mergeTemplates", () => {
  const tenantAgent = { id: "a1", tenantId: "T" };
  const tenantComputer = { id: "c1", tenantId: "T" };
  const platformComputer = { id: "c0", tenantId: null };

  it("returns the union deduped by id, primary order preserved", () => {
    const merged = mergeTemplates(
      [tenantAgent, tenantComputer],
      [tenantComputer, platformComputer],
    );
    expect(merged.map((t) => t.id)).toEqual(["a1", "c1", "c0"]);
  });

  it("returns empty when both inputs are empty or nullish", () => {
    expect(mergeTemplates([], [])).toEqual([]);
    expect(mergeTemplates(null, undefined)).toEqual([]);
  });

  it("keeps the primary instance on id conflict", () => {
    type Row = { id: string; tenantId: string | null; name: string };
    const a: Row = { id: "x", tenantId: "T", name: "primary" };
    const b: Row = { id: "x", tenantId: null, name: "secondary" };
    const merged = mergeTemplates<Row>([a], [b]);
    expect(merged).toHaveLength(1);
    expect(merged[0]).toBe(a);
  });

  it("returns only the secondary's unique ids when primary is empty", () => {
    const merged = mergeTemplates([], [platformComputer]);
    expect(merged.map((t) => t.id)).toEqual(["c0"]);
  });
});

describe("isPlatformTemplate", () => {
  it("treats null or undefined tenantId as platform", () => {
    expect(isPlatformTemplate({ tenantId: null })).toBe(true);
    expect(isPlatformTemplate({})).toBe(true);
  });

  it("treats a string tenantId as tenant-owned", () => {
    expect(isPlatformTemplate({ tenantId: "abc" })).toBe(false);
  });
});

describe("suggestedClone helpers", () => {
  it("appends -copy to the slug", () => {
    expect(suggestedCloneSlug("thinkwork-computer-default")).toBe(
      "thinkwork-computer-default-copy",
    );
  });

  it("appends (Custom) to the name", () => {
    expect(suggestedCloneName("Thinkwork Computer")).toBe(
      "Thinkwork Computer (Custom)",
    );
  });
});
