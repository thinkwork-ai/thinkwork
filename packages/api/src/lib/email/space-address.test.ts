import { describe, expect, it } from "vitest";

import { deriveSpaceAddress, parseSpaceRecipient } from "./space-address.js";

describe("deriveSpaceAddress", () => {
  it("derives tenant-scoped Space addresses on the verified agents domain", () => {
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

describe("parseSpaceRecipient", () => {
  it("parses tenant and Space slugs from the full recipient", () => {
    expect(parseSpaceRecipient("acme.finance@agents.thinkwork.ai")).toEqual({
      tenantSlug: "acme",
      spaceSlug: "finance",
    });
    expect(
      parseSpaceRecipient("big-co.q4-finance@agents.thinkwork.ai"),
    ).toEqual({
      tenantSlug: "big-co",
      spaceSlug: "q4-finance",
    });
  });

  it("rejects legacy agent and unverified tenant subdomain address shapes", () => {
    expect(parseSpaceRecipient("marco@agents.thinkwork.ai")).toBeNull();
    expect(parseSpaceRecipient("finance@acme.thinkwork.ai")).toBeNull();
    expect(parseSpaceRecipient("acme.finance.team")).toBeNull();
    expect(parseSpaceRecipient("acme_finance@thinkwork.ai")).toBeNull();
    expect(parseSpaceRecipient("finance@acme.example.com")).toBeNull();
  });
});
