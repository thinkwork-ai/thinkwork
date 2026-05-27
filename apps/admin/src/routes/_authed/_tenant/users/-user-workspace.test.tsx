import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function readSource(path: string) {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

describe("Users detail Workspace", () => {
  const routeSource = readSource("./$userId.tsx");
  const profileSource = readSource(
    "../../../../components/humans/HumanProfileSection.tsx",
  );
  const queriesSource = readSource("../../../../lib/graphql-queries.ts");

  it("uses top-level Workspace and Configuration tabs with Workspace first and default", () => {
    expect(routeSource).toContain(
      'type UserDetailTab = "workspace" | "configuration"',
    );
    expect(routeSource).toContain(
      'useState<UserDetailTab>("workspace")',
    );
    expect(routeSource).toContain("Configuration");
    expect(routeSource).toContain("Workspace");
    expect(routeSource).toContain("WorkspaceEditor");
    expect(routeSource).toContain("target={{ userId: member.user.id }}");
    expect(routeSource).toContain('mode="context"');

    // Workspace tab trigger appears before Configuration in source order.
    const workspaceTriggerIdx = routeSource.indexOf(
      'TabsTrigger value="workspace"',
    );
    const configTriggerIdx = routeSource.indexOf(
      'TabsTrigger value="configuration"',
    );
    expect(workspaceTriggerIdx).toBeGreaterThan(-1);
    expect(configTriggerIdx).toBeGreaterThan(-1);
    expect(workspaceTriggerIdx).toBeLessThan(configTriggerIdx);
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
