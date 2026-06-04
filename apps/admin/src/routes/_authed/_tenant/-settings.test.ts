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

  it("does not expose the Knowledge Graph deployment control in admin", () => {
    expect(source).not.toContain("Knowledge Graph");
    expect(source).not.toContain("SetKnowledgeGraphDeploymentMutation");
    expect(source).not.toContain("Toggle Knowledge Graph infrastructure");
    expect(source).not.toContain("Disable Knowledge Graph?");
    expect(source).not.toContain("cogneeEndpoint");
    expect(source).not.toContain("cogneeLogGroupName");
  });
});
