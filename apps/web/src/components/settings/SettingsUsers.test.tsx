import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  addManualUserMock,
  inviteMemberMock,
  navigateMock,
  refetchMock,
  tenant,
  queryDocs,
  members,
} = vi.hoisted(() => ({
  addManualUserMock: vi.fn(),
  inviteMemberMock: vi.fn(),
  navigateMock: vi.fn(),
  refetchMock: vi.fn(),
  tenant: {
    tenantId: "tenant-1",
    role: "owner" as string,
  },
  queryDocs: {
    SettingsAddManualUserMutation: Symbol("addManualUser"),
    SettingsInviteMemberMutation: Symbol("inviteMember"),
    SettingsTenantMembersQuery: Symbol("tenantMembers"),
  },
  members: [] as unknown[],
}));

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => navigateMock,
}));

vi.mock("urql", () => ({
  useQuery: () => [
    {
      data: { tenantMembers: members },
      fetching: false,
    },
    refetchMock,
  ],
  useMutation: (doc: unknown) => {
    if (doc === queryDocs.SettingsAddManualUserMutation)
      return [{ fetching: false }, addManualUserMock];
    if (doc === queryDocs.SettingsInviteMemberMutation)
      return [{ fetching: false }, inviteMemberMock];
    return [{ fetching: false }, vi.fn()];
  },
}));

vi.mock("@/context/TenantContext", () => ({ useTenant: () => tenant }));
vi.mock("@/context/PageHeaderContext", () => ({
  usePageHeaderActions: () => {},
}));
vi.mock("@/lib/settings-queries", () => queryDocs);
vi.mock("@/components/settings/SettingsContent", () => ({
  SettingsHeader: ({
    title,
    description,
  }: {
    title: string;
    description?: string;
  }) => (
    <header>
      <h1>{title}</h1>
      <p>{description}</p>
    </header>
  ),
  SettingsPane: ({ children }: { children: React.ReactNode }) => (
    <section>{children}</section>
  ),
  SettingsTablePane: ({
    actions,
    children,
    toolbar,
    title,
  }: {
    actions?: React.ReactNode;
    children: React.ReactNode;
    toolbar?: React.ReactNode;
    title: string;
  }) => (
    <section>
      <h1>{title}</h1>
      <div data-testid="settings-users-toolbar">{toolbar}</div>
      <div data-testid="settings-users-actions">{actions}</div>
      {children}
    </section>
  ),
}));

vi.mock("@thinkwork/ui", () => ({
  Avatar: ({ children }: { children: React.ReactNode }) => (
    <span>{children}</span>
  ),
  AvatarFallback: ({ children }: { children: React.ReactNode }) => (
    <span>{children}</span>
  ),
  Badge: ({ children }: { children: React.ReactNode }) => (
    <span>{children}</span>
  ),
  Button: ({
    children,
    ...props
  }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button {...props}>{children}</button>
  ),
  DataTable: ({
    data,
    emptyState,
    filterValue,
    onRowClick,
  }: {
    data: Array<{ id: string; name: string; email: string }>;
    emptyState?: React.ReactNode;
    filterValue?: string;
    onRowClick?: (row: { id: string; name: string; email: string }) => void;
  }) => {
    const filter = filterValue?.toLowerCase() ?? "";
    const rows = filter
      ? data.filter(
          (row) =>
            row.name.toLowerCase().includes(filter) ||
            row.email.toLowerCase().includes(filter),
        )
      : data;
    return (
      <div data-testid="users-table">
        {rows.length
          ? rows.map((row) => (
              <button
                key={row.id}
                type="button"
                onClick={() => onRowClick?.(row)}
              >
                {row.name} {row.email}
              </button>
            ))
          : emptyState}
      </div>
    );
  },
  Dialog: ({ children, open }: { children: React.ReactNode; open: boolean }) =>
    open ? <div role="dialog">{children}</div> : null,
  DialogContent: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  DialogFooter: ({ children }: { children: React.ReactNode }) => (
    <footer>{children}</footer>
  ),
  DialogHeader: ({ children }: { children: React.ReactNode }) => (
    <header>{children}</header>
  ),
  DialogTitle: ({ children }: { children: React.ReactNode }) => (
    <h2>{children}</h2>
  ),
  Input: (props: React.InputHTMLAttributes<HTMLInputElement>) => (
    <input {...props} />
  ),
  Select: ({
    children,
    onValueChange,
    value,
  }: {
    children: React.ReactNode;
    onValueChange: (value: string) => void;
    value: string;
  }) => (
    <select
      aria-label="Role"
      value={value}
      onChange={(event) => onValueChange(event.target.value)}
    >
      {children}
    </select>
  ),
  SelectContent: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
  SelectItem: ({
    children,
    value,
  }: {
    children: React.ReactNode;
    value: string;
  }) => <option value={value}>{children}</option>,
  SelectTrigger: () => null,
  SelectValue: () => null,
}));

import { SettingsUsers } from "./SettingsUsers";

function seedMembers() {
  members.length = 0;
  members.push(
    {
      id: "member-1",
      principalType: "USER",
      principalId: "user-1",
      role: "owner",
      status: "active",
      createdAt: "2026-04-10T12:00:00.000Z",
      user: {
        id: "user-1",
        name: "Amy Odom",
        email: "amy@example.com",
      },
    },
    {
      id: "member-2",
      principalType: "USER",
      principalId: "user-2",
      role: "member",
      status: "active",
      createdAt: "2026-04-11T12:00:00.000Z",
      user: {
        id: "user-2",
        name: "Brett Odom",
        email: "brett@example.com",
      },
    },
  );
}

beforeEach(() => {
  addManualUserMock.mockReset();
  inviteMemberMock.mockReset();
  navigateMock.mockReset();
  refetchMock.mockReset();
  addManualUserMock.mockResolvedValue({ error: null });
  inviteMemberMock.mockResolvedValue({ error: null });
  tenant.tenantId = "tenant-1";
  tenant.role = "owner";
  seedMembers();
});

afterEach(() => {
  vi.restoreAllMocks();
  cleanup();
});

function fillSetupDialog(email: string, name = "New User") {
  const dialog = screen.getByRole("dialog");
  const textboxes = within(dialog).getAllByRole("textbox");
  fireEvent.change(textboxes[0], { target: { value: email } });
  fireEvent.change(textboxes[1], { target: { value: name } });
}

describe("SettingsUsers", () => {
  it("shows distinct Add user and Send invite actions while preserving search", () => {
    render(<SettingsUsers />);

    expect(screen.getByRole("button", { name: /add user/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /send invite/i })).toBeTruthy();
    expect(screen.getByText(/Amy Odom/)).toBeTruthy();
    expect(screen.getByText(/Brett Odom/)).toBeTruthy();

    fireEvent.change(screen.getByPlaceholderText("Search by name or email…"), {
      target: { value: "brett" },
    });

    expect(screen.queryByText(/Amy Odom/)).toBeNull();
    expect(screen.getByText(/Brett Odom/)).toBeTruthy();
  });

  it("adds a manual user without calling the invite mutation or showing invite copy", async () => {
    const randomUUID = vi
      .spyOn(crypto, "randomUUID")
      .mockReturnValueOnce(
        "manual-click" as `${string}-${string}-${string}-${string}-${string}`,
      );
    render(<SettingsUsers />);

    fireEvent.click(screen.getByRole("button", { name: /^add user$/i }));
    expect(
      screen.getByText(
        "Create tenant access without sending an invitation email.",
      ),
    ).toBeTruthy();
    fillSetupDialog("Manual.User@Example.com");
    fireEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: /^add user$/i,
      }),
    );

    await waitFor(() => expect(addManualUserMock).toHaveBeenCalledOnce());
    expect(addManualUserMock).toHaveBeenCalledWith({
      tenantId: "tenant-1",
      input: {
        email: "Manual.User@Example.com",
        name: "New User",
        role: "member",
        idempotencyKey: "add-user:manual.user@example.com:manual-click",
      },
    });
    expect(inviteMemberMock).not.toHaveBeenCalled();
    expect(screen.queryByText(/invite sent/i)).toBeNull();
    expect(refetchMock).toHaveBeenCalledWith({ requestPolicy: "network-only" });
    expect(randomUUID).toHaveBeenCalledOnce();
  });

  it("sends an invite with a fresh per-submit idempotency key", async () => {
    vi.spyOn(crypto, "randomUUID").mockReturnValueOnce(
      "invite-click" as `${string}-${string}-${string}-${string}-${string}`,
    );
    render(<SettingsUsers />);

    fireEvent.click(screen.getByRole("button", { name: /^send invite$/i }));
    expect(
      screen.getByText("Send a ThinkWork invitation email for this tenant."),
    ).toBeTruthy();
    fillSetupDialog("invitee@example.com", "Invitee User");
    fireEvent.change(
      within(screen.getByRole("dialog")).getByLabelText("Role"),
      {
        target: { value: "admin" },
      },
    );
    fireEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: /^send invite$/i,
      }),
    );

    await waitFor(() => expect(inviteMemberMock).toHaveBeenCalledOnce());
    expect(inviteMemberMock).toHaveBeenCalledWith({
      tenantId: "tenant-1",
      input: {
        email: "invitee@example.com",
        name: "Invitee User",
        role: "admin",
        idempotencyKey: "invite-user:invitee@example.com:invite-click",
      },
    });
    expect(addManualUserMock).not.toHaveBeenCalled();
  });

  it("keeps duplicate manual-add errors visible for correction", async () => {
    addManualUserMock.mockResolvedValueOnce({
      error: {
        message: "User is already an active member of this tenant",
      },
    });
    render(<SettingsUsers />);

    fireEvent.click(screen.getByRole("button", { name: /^add user$/i }));
    fillSetupDialog("amy@example.com", "Amy Odom");
    fireEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: /^add user$/i,
      }),
    );

    await waitFor(() =>
      expect(
        screen.getByText("User is already an active member of this tenant"),
      ).toBeTruthy(),
    );
    expect(screen.getByRole("dialog")).toBeTruthy();
  });

  it("hides owner as a create option for admin callers", () => {
    tenant.role = "admin";
    render(<SettingsUsers />);

    fireEvent.click(screen.getByRole("button", { name: /^add user$/i }));

    const roleSelect = within(screen.getByRole("dialog")).getByLabelText(
      "Role",
    );
    expect(
      within(roleSelect).getByRole("option", { name: "Member" }),
    ).toBeTruthy();
    expect(
      within(roleSelect).getByRole("option", { name: "Admin" }),
    ).toBeTruthy();
    expect(
      within(roleSelect).queryByRole("option", { name: "Owner" }),
    ).toBeNull();
  });
});
