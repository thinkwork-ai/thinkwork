import { describe, expect, it } from "vitest";

import { deriveSpaceAddress, parseSpaceAddress } from "./space-address.js";

describe("deriveSpaceAddress", () => {
  it("derives globally unique tenant-space local parts", () => {
    expect(
      deriveSpaceAddress({ tenantSlug: "acme", spaceSlug: "finance" }),
    ).toBe("acme.finance@agents.thinkwork.ai");
  });

  it("preserves hyphenated slugs", () => {
    expect(
      deriveSpaceAddress({
        tenantSlug: "big-co",
        spaceSlug: "q4-finance",
      }),
    ).toBe("big-co.q4-finance@agents.thinkwork.ai");
  });

  it("rejects values outside the slug invariant", () => {
    expect(() =>
      deriveSpaceAddress({ tenantSlug: "acme.inc", spaceSlug: "finance" }),
    ).toThrow("Invalid tenant slug");
    expect(() =>
      deriveSpaceAddress({ tenantSlug: "acme", spaceSlug: "finance.team" }),
    ).toThrow("Invalid Space slug");
  });
});

describe("parseSpaceAddress", () => {
  it("parses tenant and Space slugs from the local part", () => {
    expect(parseSpaceAddress("acme.finance")).toEqual({
      tenantSlug: "acme",
      spaceSlug: "finance",
    });
    expect(parseSpaceAddress("big-co.q4-finance")).toEqual({
      tenantSlug: "big-co",
      spaceSlug: "q4-finance",
    });
  });

  it("rejects legacy agent local parts and ambiguous dotted local parts", () => {
    expect(parseSpaceAddress("marco")).toBeNull();
    expect(parseSpaceAddress("acme.finance.team")).toBeNull();
    expect(parseSpaceAddress("acme_finance")).toBeNull();
  });
});
