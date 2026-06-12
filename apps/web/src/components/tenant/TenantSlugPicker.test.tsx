import { describe, expect, it } from "vitest";
import {
  slugifyTenantName,
  suggestTenantSlug,
  tenantSlugServerError,
  tenantSlugValidationError,
} from "./TenantSlugPicker";

describe("tenant slug helpers", () => {
  it("slugifies tenant names into valid identifiers", () => {
    expect(slugifyTenantName("Acme & Sons, Inc.")).toBe("acme-and-sons-inc");
    expect(slugifyTenantName("  ThinkWork Labs  ")).toBe("thinkwork-labs");
    expect(slugifyTenantName("Northwind International Holdings")).toBe(
      "northwind-international-holdin",
    );
  });

  it("falls back when a suggested tenant name is invalid or reserved", () => {
    expect(suggestTenantSlug("Acme Inc.", "sleek-squirrel-230")).toBe(
      "acme-inc",
    );
    expect(suggestTenantSlug("API", "sleek-squirrel-230")).toBe(
      "sleek-squirrel-230",
    );
    expect(suggestTenantSlug("!!", "sleek-squirrel-230")).toBe(
      "sleek-squirrel-230",
    );
  });

  it("validates the shared tenant slug rules before submit", () => {
    expect(tenantSlugValidationError("acme-inc")).toBeNull();
    expect(tenantSlugValidationError("Acme")).toContain("lowercase");
    expect(tenantSlugValidationError("-acme")).toContain("lowercase");
    expect(tenantSlugValidationError("ac")).toContain("lowercase");
    expect(tenantSlugValidationError("admin")).toBe(
      "That identifier is reserved.",
    );
  });

  it("maps server-side rename failures to operator-facing copy", () => {
    expect(tenantSlugServerError("SLUG_UNAVAILABLE", "fallback")).toBe(
      "That identifier is already taken.",
    );
    expect(tenantSlugServerError("RESERVED_SLUG", "fallback")).toBe(
      "That identifier is reserved.",
    );
    expect(tenantSlugServerError("INVALID_SLUG", "fallback")).toBe(
      "That identifier is not valid.",
    );
    expect(tenantSlugServerError("FORBIDDEN", "fallback")).toBe(
      "You do not have permission to rename this tenant.",
    );
    expect(
      tenantSlugServerError("SLUG_VALIDATION_UNAVAILABLE", "fallback"),
    ).toBe("Slug availability could not be confirmed — please try again.");
    expect(tenantSlugServerError("UNKNOWN", "fallback")).toBe("fallback");
  });
});
