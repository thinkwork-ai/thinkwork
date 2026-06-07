import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  join(process.cwd(), "src/routes/onboarding/welcome.tsx"),
  "utf8",
);

describe("onboarding welcome route", () => {
  it("returns OAuth users to the welcome flow before choosing a tenant identifier", () => {
    expect(source).toContain("rememberPostAuthRedirect");
    expect(source).toContain("startGoogleSignIn");
    expect(source).toContain("window.location.pathname");
    expect(source).toContain("window.location.search");
  });

  it("prefills and submits the tenant slug picker from the claimed tenant", () => {
    expect(source).toContain("TenantSlugPicker");
    expect(source).toContain("OnboardingBootstrapUser");
    expect(source).toContain("bootstrapUser");
    expect(source).toContain("await refetch()");
    expect(source).toContain("suggestTenantSlug(tenant.name, tenant.slug)");
    expect(source).toContain("SettingsRenameTenantSlugMutation");
    expect(source).toContain("tenantId: tenant.id");
    expect(source).toContain("newSlug: nextSlug");
    expect(source).toContain('to: "/new"');
  });
});
