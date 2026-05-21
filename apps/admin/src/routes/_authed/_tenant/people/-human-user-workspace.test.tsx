import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function readSource(path: string) {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

describe("People detail User Workspace", () => {
  const routeSource = readSource("./$humanId.tsx");
  const sectionSource = readSource(
    "../../../../components/humans/HumanUserWorkspaceSection.tsx",
  );
  const queriesSource = readSource("../../../../lib/graphql-queries.ts");

  it("mounts the user workspace surface on People detail", () => {
    expect(routeSource).toContain("HumanUserWorkspaceSection");
    expect(routeSource).toContain("profile={member.user.profile}");
  });

  it("edits structured user profile fields and raw user workspace files", () => {
    expect(sectionSource).toContain("UpdateUserProfileMutation");
    expect(sectionSource).toContain("WorkspaceEditor");
    expect(sectionSource).toContain("target={{ userId }}");
    expect(sectionSource).toContain('mode="context"');
    expect(sectionSource).toContain("title");
    expect(sectionSource).toContain("timezone");
    expect(sectionSource).toContain("pronouns");
    expect(sectionSource).toContain("callBy");
    expect(sectionSource).toContain("family");
    expect(sectionSource).toContain("context");
  });

  it("loads profile fields used to render user-scoped USER.md", () => {
    const tenantMembersQuery = queriesSource.slice(
      queriesSource.indexOf("query TenantMembersList"),
      queriesSource.indexOf("export const InviteMemberMutation"),
    );
    expect(tenantMembersQuery).toContain("phone");
    expect(tenantMembersQuery).toContain("profile {");
    expect(tenantMembersQuery).toContain("context");
    expect(queriesSource).toContain("mutation UpdateUserProfile");
    expect(queriesSource).toContain("updateUserProfile");
  });
});
