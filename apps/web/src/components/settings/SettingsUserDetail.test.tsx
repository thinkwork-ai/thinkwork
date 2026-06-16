import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  deleteBudgetMock,
  inviteMemberMock,
  navigateMock,
  removeMemberMock,
  resendMemberInviteMock,
  setPasswordMock,
  updateMemberMock,
  updateProfileMock,
  updateUserMock,
  upsertBudgetMock,
  tenant,
  queryDocs,
  members,
  userBudgetStatus,
} = vi.hoisted(() => ({
  deleteBudgetMock: vi.fn(),
  inviteMemberMock: vi.fn(),
  navigateMock: vi.fn(),
  removeMemberMock: vi.fn(),
  resendMemberInviteMock: vi.fn(),
  setPasswordMock: vi.fn(),
  updateMemberMock: vi.fn(),
  updateProfileMock: vi.fn(),
  updateUserMock: vi.fn(),
  upsertBudgetMock: vi.fn(),
  tenant: {
    tenantId: "tenant-1",
    userId: "caller-1",
    role: "owner" as string,
  },
  queryDocs: {
    SettingsDeleteBudgetPolicyMutation: Symbol("deleteBudget"),
    SettingsInviteMemberMutation: Symbol("inviteMember"),
    SettingsRemoveTenantMemberMutation: Symbol("removeMember"),
    SettingsResendMemberInviteMutation: Symbol("resendMemberInvite"),
    SettingsSetTenantMemberPasswordMutation: Symbol("setPassword"),
    SettingsTenantMembersQuery: Symbol("members"),
    SettingsUserBudgetStatusQuery: Symbol("userBudgetStatus"),
    SettingsUpsertBudgetPolicyMutation: Symbol("upsertBudget"),
    SettingsUpdateUserMutation: Symbol("updateUser"),
    SettingsUpdateUserProfileMutation: Symbol("updateProfile"),
    SettingsUpdateTenantMemberMutation: Symbol("updateMember"),
  },
  members: [] as unknown[],
  userBudgetStatus: { current: null as unknown },
}));

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => navigateMock,
  useParams: () => ({ userId: "member-1" }),
}));

vi.mock("urql", () => ({
  useQuery: ({ query }: { query: unknown }) => {
    if (query === queryDocs.SettingsUserBudgetStatusQuery) {
      return [
        {
          data: { userBudgetStatus: userBudgetStatus.current },
          fetching: false,
        },
        vi.fn(),
      ];
    }
    return [{ data: { tenantMembers: members }, fetching: false }, vi.fn()];
  },
  useMutation: (doc: unknown) => {
    if (doc === queryDocs.SettingsUpdateTenantMemberMutation)
      return [{ fetching: false }, updateMemberMock];
    if (doc === queryDocs.SettingsUpdateUserMutation)
      return [{ fetching: false }, updateUserMock];
    if (doc === queryDocs.SettingsUpdateUserProfileMutation)
      return [{ fetching: false }, updateProfileMock];
    if (doc === queryDocs.SettingsUpsertBudgetPolicyMutation)
      return [{ fetching: false }, upsertBudgetMock];
    if (doc === queryDocs.SettingsDeleteBudgetPolicyMutation)
      return [{ fetching: false }, deleteBudgetMock];
    if (doc === queryDocs.SettingsInviteMemberMutation)
      return [{ fetching: false }, inviteMemberMock];
    if (doc === queryDocs.SettingsResendMemberInviteMutation)
      return [{ fetching: false }, resendMemberInviteMock];
    if (doc === queryDocs.SettingsSetTenantMemberPasswordMutation)
      return [{ fetching: false }, setPasswordMock];
    if (doc === queryDocs.SettingsRemoveTenantMemberMutation)
      return [{ fetching: false }, removeMemberMock];
    return [{ fetching: false }, vi.fn()];
  },
}));

vi.mock("@/context/TenantContext", () => ({ useTenant: () => tenant }));
vi.mock("@/context/PageHeaderContext", () => ({
  usePageHeaderActions: () => {},
}));
vi.mock("@/lib/settings-queries", () => queryDocs);
vi.mock("@/components/settings/UserModelsSection", () => ({
  UserModelsSection: ({ userId }: { userId: string }) => (
    <section data-testid="user-models-section" data-user-id={userId} />
  ),
}));
vi.mock("@/components/workspace-settings/ScopedWorkspaceEditor", () => ({
  ScopedWorkspaceEditor: (props: {
    target: Record<string, string>;
    targetKey: string;
  }) => (
    <div
      data-testid="user-workspace-editor"
      data-target={JSON.stringify(props.target)}
      data-targetkey={props.targetKey}
    />
  ),
}));

import { SettingsUserDetail } from "./SettingsUserDetail";

function seedMember(overrides: Record<string, unknown> = {}) {
  members.length = 0;
  members.push({
    id: "member-1",
    principalType: "USER",
    role: "member",
    status: "active",
    cognitoStatus: null,
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
  deleteBudgetMock.mockReset();
  inviteMemberMock.mockReset();
  navigateMock.mockReset();
  removeMemberMock.mockReset();
  resendMemberInviteMock.mockReset();
  setPasswordMock.mockReset();
  updateMemberMock.mockReset();
  updateProfileMock.mockReset();
  updateUserMock.mockReset();
  upsertBudgetMock.mockReset();
  deleteBudgetMock.mockResolvedValue({ error: null });
  inviteMemberMock.mockResolvedValue({ error: null });
  removeMemberMock.mockResolvedValue({ error: null });
  resendMemberInviteMock.mockResolvedValue({
    error: null,
    data: {
      resendMemberInvite: {
        status: "RESENT",
        message: "Invite resent.",
      },
    },
  });
  setPasswordMock.mockResolvedValue({
    error: null,
    data: {
      setTenantMemberPassword: {
        status: "PASSWORD_SET",
        message: "Password set.",
      },
    },
  });
  updateMemberMock.mockResolvedValue({ error: null });
  updateProfileMock.mockResolvedValue({ error: null });
  updateUserMock.mockResolvedValue({ error: null });
  upsertBudgetMock.mockResolvedValue({ error: null });
  userBudgetStatus.current = null;
  tenant.userId = "caller-1";
  tenant.role = "owner";
});
afterEach(() => {
  vi.restoreAllMocks();
  cleanup();
});

describe("SettingsUserDetail role merge", () => {
  it("renders the status badge beside the title and no Membership section", () => {
    seedMember();
    render(<SettingsUserDetail />);
    expect(screen.getByText("Active")).toBeTruthy();
    expect(screen.queryByText("Membership")).toBeNull();
    expect(screen.queryByText(/can.?t change your own role/i)).toBeNull();
  });

  it("renders model approvals on the Spaces user detail page", () => {
    seedMember();
    render(<SettingsUserDetail />);

    const section = screen.getByTestId("user-models-section");
    expect(section.getAttribute("data-user-id")).toBe("user-9");
  });

  it("embeds the workspace editor scoped to this user's own source (AE6)", () => {
    seedMember();
    render(<SettingsUserDetail />);

    const editor = screen.getByTestId("user-workspace-editor");
    // Single userId target — not the consolidated multi-source client — so
    // edits land under this user's source tree.
    expect(JSON.parse(editor.getAttribute("data-target")!)).toEqual({
      userId: "user-9",
    });
    expect(editor.getAttribute("data-targetkey")).toBe("user:user-9");
    expect(screen.getByText("Workspace files")).toBeTruthy();
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

  it("sets a permanent password for another member from the profile page", async () => {
    seedMember();
    render(<SettingsUserDetail />);

    fireEvent.click(screen.getByRole("button", { name: /^set password$/i }));
    fireEvent.change(screen.getByLabelText("New password"), {
      target: { value: "StrongPass123!" },
    });
    fireEvent.change(screen.getByLabelText("Confirm password"), {
      target: { value: "StrongPass123!" },
    });
    fireEvent.click(
      screen.getAllByRole("button", { name: /^set password$/i }).at(-1)!,
    );

    await waitFor(() => expect(setPasswordMock).toHaveBeenCalled());
    expect(setPasswordMock).toHaveBeenCalledWith({
      tenantId: "tenant-1",
      input: {
        memberId: "member-1",
        password: "StrongPass123!",
        permanent: true,
      },
    });
    expect(screen.getByText("Password set.")).toBeTruthy();
  });

  it("can require the user to change a temporary password on next sign-in", async () => {
    setPasswordMock.mockResolvedValueOnce({
      error: null,
      data: {
        setTenantMemberPassword: {
          status: "TEMPORARY_PASSWORD_SET",
          message:
            "Temporary password set. The user must choose a new password at next sign-in.",
        },
      },
    });
    seedMember();
    render(<SettingsUserDetail />);

    fireEvent.click(screen.getByRole("button", { name: /^set password$/i }));
    fireEvent.change(screen.getByLabelText("New password"), {
      target: { value: "StrongPass123!" },
    });
    fireEvent.change(screen.getByLabelText("Confirm password"), {
      target: { value: "StrongPass123!" },
    });
    fireEvent.click(
      screen.getByRole("switch", { name: /require change on next sign-in/i }),
    );
    fireEvent.click(
      screen.getAllByRole("button", { name: /^set password$/i }).at(-1)!,
    );

    await waitFor(() => expect(setPasswordMock).toHaveBeenCalled());
    expect(setPasswordMock).toHaveBeenCalledWith({
      tenantId: "tenant-1",
      input: {
        memberId: "member-1",
        password: "StrongPass123!",
        permanent: false,
      },
    });
    expect(
      screen.getByText(
        "Temporary password set. The user must choose a new password at next sign-in.",
      ),
    ).toBeTruthy();
  });

  it("validates password confirmation before calling GraphQL", () => {
    seedMember();
    render(<SettingsUserDetail />);

    fireEvent.click(screen.getByRole("button", { name: /^set password$/i }));
    fireEvent.change(screen.getByLabelText("New password"), {
      target: { value: "StrongPass123!" },
    });
    fireEvent.change(screen.getByLabelText("Confirm password"), {
      target: { value: "DifferentPass123!" },
    });
    fireEvent.click(
      screen.getAllByRole("button", { name: /^set password$/i }).at(-1)!,
    );

    expect(screen.getByText("Passwords do not match.")).toBeTruthy();
    expect(setPasswordMock).not.toHaveBeenCalled();
  });

  it("hides the set password action for the caller's own membership", () => {
    seedMember({
      user: { id: "caller-1", name: "Me", email: "me@x.com", profile: null },
    });
    render(<SettingsUserDetail />);

    expect(screen.queryByRole("button", { name: /^set password$/i })).toBeNull();
  });

  it("requires a positive numeric budget before saving", () => {
    seedMember();
    render(<SettingsUserDetail />);

    fireEvent.click(
      screen.getByRole("switch", { name: /enable user budget/i }),
    );
    fireEvent.change(screen.getByPlaceholderText("0.00"), {
      target: { value: "not money" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(screen.getByText("Budget must be a positive number.")).toBeTruthy();
    expect(upsertBudgetMock).not.toHaveBeenCalled();
    expect(updateUserMock).not.toHaveBeenCalled();
  });

  it("upserts a monthly user budget from the profile form", async () => {
    seedMember();
    render(<SettingsUserDetail />);

    fireEvent.click(
      screen.getByRole("switch", { name: /enable user budget/i }),
    );
    fireEvent.change(screen.getByPlaceholderText("0.00"), {
      target: { value: "42.50" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(upsertBudgetMock).toHaveBeenCalled());
    expect(upsertBudgetMock).toHaveBeenCalledWith({
      tenantId: "tenant-1",
      input: {
        scope: "user",
        userId: "user-9",
        agentId: null,
        limitUsd: 42.5,
        period: "monthly",
        actionOnExceed: "PAUSE",
      },
    });
  });

  it("uses Unlimited by deleting the existing user budget policy", async () => {
    userBudgetStatus.current = {
      policy: { id: "budget-1", limitUsd: 25 },
      spentUsd: 5,
      remainingUsd: 20,
      percentUsed: 20,
      status: "ok",
    };
    seedMember();
    render(<SettingsUserDetail />);

    expect(screen.getByDisplayValue("25")).toBeTruthy();
    fireEvent.click(
      screen.getByRole("switch", { name: /enable user budget/i }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(deleteBudgetMock).toHaveBeenCalled());
    expect(deleteBudgetMock).toHaveBeenCalledWith({ id: "budget-1" });
    expect(upsertBudgetMock).not.toHaveBeenCalled();
  });

  it("resends the invite for the current user with the dedicated mutation", async () => {
    const randomUUID = vi
      .spyOn(crypto, "randomUUID")
      .mockReturnValueOnce(
        "first-click" as `${string}-${string}-${string}-${string}-${string}`,
      )
      .mockReturnValueOnce(
        "second-click" as `${string}-${string}-${string}-${string}-${string}`,
      );
    seedMember({
      role: "admin",
      cognitoStatus: "FORCE_CHANGE_PASSWORD",
      user: {
        id: "user-9",
        name: "Dana Member",
        email: "dana@example.com",
        profile: null,
      },
    });
    render(<SettingsUserDetail />);

    fireEvent.click(screen.getByRole("button", { name: /resend invite/i }));
    await waitFor(() => expect(screen.getByText("Invite resent")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: /resend invite/i }));

    await waitFor(() =>
      expect(resendMemberInviteMock).toHaveBeenCalledTimes(2),
    );
    expect(resendMemberInviteMock).toHaveBeenNthCalledWith(1, {
      tenantId: "tenant-1",
      input: {
        memberId: "member-1",
        idempotencyKey: "resend-member-invite:member-1:first-click",
      },
    });
    expect(resendMemberInviteMock).toHaveBeenNthCalledWith(2, {
      tenantId: "tenant-1",
      input: {
        memberId: "member-1",
        idempotencyKey: "resend-member-invite:member-1:second-click",
      },
    });
    expect(randomUUID).toHaveBeenCalledTimes(2);
    expect(inviteMemberMock).not.toHaveBeenCalled();
    expect(screen.getByText("Invite resent")).toBeTruthy();
  });

  it("ignores duplicate resend clicks while the first resend is in flight", async () => {
    const randomUUID = vi
      .spyOn(crypto, "randomUUID")
      .mockReturnValue(
        "first-click" as `${string}-${string}-${string}-${string}-${string}`,
      );
    let resolveResend!: (value: unknown) => void;
    resendMemberInviteMock.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveResend = resolve;
      }),
    );
    seedMember({
      cognitoStatus: "FORCE_CHANGE_PASSWORD",
    });
    render(<SettingsUserDetail />);

    const button = screen.getByRole("button", { name: /resend invite/i });
    fireEvent.click(button);
    fireEvent.click(button);

    expect(resendMemberInviteMock).toHaveBeenCalledTimes(1);
    expect(resendMemberInviteMock).toHaveBeenCalledWith({
      tenantId: "tenant-1",
      input: {
        memberId: "member-1",
        idempotencyKey: "resend-member-invite:member-1:first-click",
      },
    });
    expect(randomUUID).toHaveBeenCalledOnce();

    resolveResend({
      error: null,
      data: {
        resendMemberInvite: {
          status: "RESENT",
          message: "Invite resent.",
        },
      },
    });

    await waitFor(() => expect(screen.getByText("Invite resent")).toBeTruthy());
  });

  it("shows Cognito delivery failures instead of success", async () => {
    resendMemberInviteMock.mockResolvedValueOnce({
      error: null,
      data: {
        resendMemberInvite: {
          status: "DELIVERY_FAILED",
          message:
            "Invite delivery failed because the email provider rejected the send. Check SES recipient/domain verification.",
        },
      },
    });
    seedMember({
      cognitoStatus: "FORCE_CHANGE_PASSWORD",
    });
    render(<SettingsUserDetail />);

    fireEvent.click(screen.getByRole("button", { name: /resend invite/i }));

    await waitFor(() =>
      expect(
        screen.getByText(
          "Invite delivery failed because the email provider rejected the send. Check SES recipient/domain verification.",
        ),
      ).toBeTruthy(),
    );
    expect(screen.queryByText("Invite resent")).toBeNull();
  });

  it("shows not-pending resend results instead of success", async () => {
    resendMemberInviteMock.mockResolvedValueOnce({
      error: null,
      data: {
        resendMemberInvite: {
          status: "NOT_PENDING",
          message:
            "Invite not resent because Cognito user status is CONFIRMED.",
        },
      },
    });
    seedMember({
      cognitoStatus: "FORCE_CHANGE_PASSWORD",
    });
    render(<SettingsUserDetail />);

    fireEvent.click(screen.getByRole("button", { name: /resend invite/i }));

    await waitFor(() =>
      expect(
        screen.getByText(
          "Invite not resent because Cognito user status is CONFIRMED.",
        ),
      ).toBeTruthy(),
    );
    expect(
      screen.getByRole("button", { name: /resend invite/i }),
    ).toHaveProperty("disabled", true);
    expect(screen.queryByText("Invite resent")).toBeNull();
  });

  it("shows GraphQL resend errors instead of success", async () => {
    resendMemberInviteMock.mockResolvedValueOnce({
      error: { message: "GraphQL resend failed." },
    });
    seedMember({
      cognitoStatus: "FORCE_CHANGE_PASSWORD",
    });
    render(<SettingsUserDetail />);

    fireEvent.click(screen.getByRole("button", { name: /resend invite/i }));

    await waitFor(() =>
      expect(screen.getByText("GraphQL resend failed.")).toBeTruthy(),
    );
    expect(screen.queryByText("Invite resent")).toBeNull();
  });

  it("hides resend invite after the Cognito user is confirmed", () => {
    seedMember({ cognitoStatus: "CONFIRMED" });
    render(<SettingsUserDetail />);

    expect(screen.queryByRole("button", { name: /resend invite/i })).toBeNull();
  });

  it("deletes the tenant member and returns to the users list", async () => {
    seedMember();
    render(<SettingsUserDetail />);

    fireEvent.click(screen.getByRole("button", { name: /^delete user$/i }));
    fireEvent.click(
      screen.getAllByRole("button", { name: /^delete user$/i }).at(-1)!,
    );

    await waitFor(() => expect(removeMemberMock).toHaveBeenCalled());
    expect(removeMemberMock).toHaveBeenCalledWith({ id: "member-1" });
    expect(navigateMock).toHaveBeenCalledWith({ to: "/settings/users" });
  });
});
