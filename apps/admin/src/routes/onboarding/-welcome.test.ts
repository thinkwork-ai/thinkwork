import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("./welcome.tsx", import.meta.url), "utf8");

describe("onboarding welcome route", () => {
  it("returns OAuth users to the welcome flow before choosing a tenant identifier", () => {
    expect(source).toContain("rememberPostAuthRedirect");
    expect(source).toContain("startGoogleSignIn");
    expect(source).toContain("window.location.pathname");
    expect(source).toContain("window.location.search");
  });

  it("prefills and submits the tenant slug picker from the claimed tenant", () => {
    expect(source).toContain("TenantSlugPicker");
    expect(source).toContain("suggestTenantSlug(tenant.name, tenant.slug)");
    expect(source).toContain("RenameTenantSlugMutation");
    expect(source).toContain("tenantId: tenant.id");
    expect(source).toContain("newSlug: nextSlug");
    expect(source).toContain('to: "/dashboard"');
  });
});
