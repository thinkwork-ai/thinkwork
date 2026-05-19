import { describe, expect, it } from "vitest";

import {
  normalizeTenantEntitySectionBody,
  normalizeTenantSubtype,
} from "./repository.js";

describe("normalizeTenantSubtype", () => {
  it("allows approved ontology-style dynamic entity type slugs", () => {
    expect(normalizeTenantSubtype("support_case")).toBe("support_case");
    expect(normalizeTenantSubtype("Customer")).toBe("customer");
  });

  it("rejects unsafe subtype strings", () => {
    expect(() => normalizeTenantSubtype("not safe")).toThrow(/unsupported/);
    expect(() => normalizeTenantSubtype("1_customer")).toThrow(/unsupported/);
  });
});

describe("normalizeTenantEntitySectionBody", () => {
  it("returns an empty body for nullish or malformed facet content", () => {
    expect(normalizeTenantEntitySectionBody(null)).toBe("");
    expect(normalizeTenantEntitySectionBody(undefined)).toBe("");
    expect(normalizeTenantEntitySectionBody({ body: "not markdown" })).toBe("");
  });

  it("keeps string facet content unchanged", () => {
    expect(normalizeTenantEntitySectionBody("Known preference.")).toBe(
      "Known preference.",
    );
  });
});
