import { describe, expect, it } from "vitest";
import { normalizeTenantSubtype } from "./repository.js";

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
