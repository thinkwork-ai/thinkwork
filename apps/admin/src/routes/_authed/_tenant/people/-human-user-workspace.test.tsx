import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function readSource(path: string) {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

describe("People detail User Workspace", () => {
  const routeSource = readSource("./$humanId.tsx");
  const profileSource = readSource(
    "../../../../components/humans/HumanProfileSection.tsx",
  );
  const queriesSource = readSource("../../../../lib/graphql-queries.ts");

  it("uses top-level Configuration and Workspace tabs", () => {
    expect(routeSource).toContain('type HumanDetailTab = "configuration" | "workspace"');
    expect(routeSource).toContain("Configuration");
    expect(routeSource).toContain("Workspace");
    expect(routeSource).toContain("WorkspaceEditor");
    expect(routeSource).toContain("target={{ userId: member.user.id }}");
    expect(routeSource).toContain('mode="context"');
  });

  it("keeps configuration focused on profile and role", () => {
    expect(routeSource).toContain("HumanProfileSection");
    expect(routeSource).toContain("currentRole={member.role}");
    expect(routeSource).not.toContain("HumanComputerAssignmentsSection");
    expect(routeSource).not.toContain("HumanMembershipSection");
    expect(routeSource).not.toContain("HumanUserWorkspaceSection");
    expect(profileSource).toContain("UpdateTenantMemberMutation");
    expect(profileSource).toContain("Role");
  });

  it("loads profile fields used by the backend to render user-scoped USER.md", () => {
    const tenantMembersQuery = queriesSource.slice(
      queriesSource.indexOf("query TenantMembersList"),
      queriesSource.indexOf("export const InviteMemberMutation"),
    );
    expect(tenantMembersQuery).toContain("phone");
    expect(tenantMembersQuery).toContain("profile {");
    expect(tenantMembersQuery).toContain("context");
  });
});
