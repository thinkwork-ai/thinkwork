import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("./settings.tsx", import.meta.url), "utf8");

describe("tenant settings route", () => {
  it("exposes the tenant identifier rename surface", () => {
    expect(source).toContain("Tenant identifier");
    expect(source).toContain("TenantSlugPicker");
    expect(source).toContain("RenameTenantSlugMutation");
    expect(source).toContain("submitTenantSlug");
    expect(source).toContain("setSlugDraft(tenant.slug)");
  });

  it("shows the tenant-scoped subdomain and refreshes tenant context after rename", () => {
    expect(source).toContain("`${tenant.slug}.thinkwork.ai`");
    expect(source).toContain('label="Subdomain"');
    expect(source).toContain("refetchTenantContext()");
    expect(source).toContain('toast.success("Tenant identifier updated.")');
  });

  it("adds a Knowledge Graph deployment control with disable confirmation", () => {
    expect(source).toContain("Knowledge Graph");
    expect(source).toContain("SetKnowledgeGraphDeploymentMutation");
    expect(source).toContain("Toggle Knowledge Graph infrastructure");
    expect(source).toContain("Disable Knowledge Graph?");
    expect(source).toContain("deployment queued");
    expect(source).toContain("cogneeEndpoint");
    expect(source).toContain("cogneeLogGroupName");
  });
});
