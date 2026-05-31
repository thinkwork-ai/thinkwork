import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { updateMemberMock, tenant, queryDocs, members } = vi.hoisted(() => ({
  updateMemberMock: vi.fn(),
  tenant: {
    tenantId: "tenant-1",
    userId: "caller-1",
    role: "owner" as string,
  },
  queryDocs: {
    SettingsTenantMembersQuery: Symbol("members"),
    SettingsUpdateUserMutation: Symbol("updateUser"),
    SettingsUpdateUserProfileMutation: Symbol("updateProfile"),
    SettingsUpdateTenantMemberMutation: Symbol("updateMember"),
  },
  members: [] as unknown[],
}));

vi.mock("@tanstack/react-router", () => ({
  useParams: () => ({ userId: "member-1" }),
}));

vi.mock("urql", () => ({
  useQuery: () => [
    { data: { tenantMembers: members }, fetching: false },
    vi.fn(),
  ],
  useMutation: (doc: unknown) => {
    if (doc === queryDocs.SettingsUpdateTenantMemberMutation)
      return [{ fetching: false }, updateMemberMock];
    return [{ fetching: false }, vi.fn()];
  },
}));

vi.mock("@/context/TenantContext", () => ({ useTenant: () => tenant }));
vi.mock("@/context/PageHeaderContext", () => ({
  usePageHeaderActions: () => {},
}));
vi.mock("@/lib/settings-queries", () => queryDocs);
vi.mock("@/lib/workspace-files-api", () => ({ spacesWorkspaceFilesClient: {} }));
vi.mock("@thinkwork/workspace-editor", () => ({
  WorkspaceFileEditor: () => null,
}));

import { SettingsUserDetail } from "./SettingsUserDetail";

function seedMember(overrides: Record<string, unknown> = {}) {
  members.length = 0;
  members.push({
    id: "member-1",
    principalType: "USER",
    role: "member",
    status: "active",
    user: {
      id: "user-9",
      name: "Dana Member",
      email: "dana@example.com",
      profile: null,
    },
    ...overrides,
  });
}

beforeEach(() => {
  updateMemberMock.mockReset();
  updateMemberMock.mockResolvedValue({ error: null });
  tenant.userId = "caller-1";
  tenant.role = "owner";
});
afterEach(cleanup);

describe("SettingsUserDetail role merge", () => {
  it("renders the status badge beside the title and no Membership section", () => {
    seedMember();
    render(<SettingsUserDetail />);
    expect(screen.getByText("Active")).toBeTruthy();
    expect(screen.queryByText("Membership")).toBeNull();
    expect(screen.queryByText(/can.?t change your own role/i)).toBeNull();
  });

  it("disables the Role select for the caller's own membership", () => {
    seedMember({
      user: { id: "caller-1", name: "Me", email: "me@x.com", profile: null },
    });
    render(<SettingsUserDetail />);
    expect(screen.getByRole("combobox").hasAttribute("disabled")).toBe(true);
  });

  it("enables the Role select for another member", () => {
    seedMember();
    render(<SettingsUserDetail />);
    expect(screen.getByRole("combobox").hasAttribute("disabled")).toBe(false);
  });
});
