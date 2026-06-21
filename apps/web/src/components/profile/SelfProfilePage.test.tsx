import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const queryDocs = vi.hoisted(() => ({
  SettingsDeleteBudgetPolicyMutation: Symbol(
    "SettingsDeleteBudgetPolicyMutation",
  ),
  SettingsInviteMemberMutation: Symbol("SettingsInviteMemberMutation"),
  SettingsMeQuery: Symbol("SettingsMeQuery"),
  SettingsRemoveTenantMemberMutation: Symbol(
    "SettingsRemoveTenantMemberMutation",
  ),
  SettingsTenantMembersQuery: Symbol("SettingsTenantMembersQuery"),
  SettingsUpdateTenantMemberMutation: Symbol(
    "SettingsUpdateTenantMemberMutation",
  ),
  SettingsUpdateUserMutation: Symbol("SettingsUpdateUserMutation"),
  SettingsUpdateUserProfileMutation: Symbol(
    "SettingsUpdateUserProfileMutation",
  ),
  SettingsUpsertBudgetPolicyMutation: Symbol(
    "SettingsUpsertBudgetPolicyMutation",
  ),
  SettingsUserBudgetStatusQuery: Symbol("SettingsUserBudgetStatusQuery"),
}));
const urqlMocks = vi.hoisted(() => ({
  deleteBudget: vi.fn(),
  refetchBudget: vi.fn(),
  refetchMe: vi.fn(),
  updateMember: vi.fn(),
  updateProfile: vi.fn(),
  updateUser: vi.fn(),
  upsertBudget: vi.fn(),
}));
const tenantMocks = vi.hoisted(() => ({
  role: "member" as string | null,
  tenantId: "tenant-1" as string | null,
}));
const headerMocks = vi.hoisted(() => ({
  usePageHeaderActions: vi.fn(),
}));
const userModelsMocks = vi.hoisted(() => ({
  props: [] as Array<{ readOnly?: boolean; userId: string }>,
}));
const accountUsageMocks = vi.hoisted(() => ({
  props: [] as Array<{ tenantId?: string | null; userId?: string | null }>,
}));
const meMock = vi.hoisted(() => ({
  current: {
    email: "eric@example.com",
    id: "user-1",
    name: "Eric Odom",
    profile: {
      callBy: null,
      id: "profile-1",
      notes: "Likes focused work.",
      pronouns: null,
      timezone: "America/Chicago",
      title: "Founder",
    },
    tenantId: "tenant-1",
  } as {
    email: string;
    id: string;
    name: string | null;
    profile: {
      callBy: string | null;
      id: string;
      notes: string | null;
      pronouns: string | null;
      timezone: string | null;
      title: string | null;
    } | null;
    tenantId: string;
  } | null,
}));

vi.mock("@/lib/settings-queries", () => queryDocs);
vi.mock("@/context/TenantContext", () => ({
  useTenant: () => tenantMocks,
}));
vi.mock("@/context/PageHeaderContext", () => headerMocks);
vi.mock("@/components/profile/AccountUsageSection", () => ({
  AccountUsageSection: (props: {
    tenantId?: string | null;
    userId?: string | null;
  }) => {
    accountUsageMocks.props.push(props);
    return (
      <section
        data-tenant-id={props.tenantId ?? ""}
        data-testid="account-usage-section"
        data-user-id={props.userId ?? ""}
      >
        Account Usage
      </section>
    );
  },
}));
vi.mock("@/components/settings/UserModelsSection", () => ({
  UserModelsSection: (props: { readOnly?: boolean; userId: string }) => {
    userModelsMocks.props.push(props);
    return (
      <section data-readonly={String(props.readOnly)} data-testid="models">
        Models
      </section>
    );
  },
}));
vi.mock("urql", () => ({
  useMutation: (document: symbol) => {
    if (document === queryDocs.SettingsUpdateUserMutation) {
      return [{ fetching: false }, urqlMocks.updateUser];
    }
    if (document === queryDocs.SettingsUpdateUserProfileMutation) {
      return [{ fetching: false }, urqlMocks.updateProfile];
    }
    if (document === queryDocs.SettingsUpsertBudgetPolicyMutation) {
      return [{ fetching: false }, urqlMocks.upsertBudget];
    }
    if (document === queryDocs.SettingsDeleteBudgetPolicyMutation) {
      return [{ fetching: false }, urqlMocks.deleteBudget];
    }
    if (document === queryDocs.SettingsUpdateTenantMemberMutation) {
      return [{ fetching: false }, urqlMocks.updateMember];
    }
    return [{ fetching: false }, vi.fn(async () => ({ data: {} }))];
  },
  useQuery: ({ query }: { query: symbol }) => {
    if (query === queryDocs.SettingsMeQuery) {
      return [
        {
          data: { me: meMock.current },
          fetching: false,
        },
        urqlMocks.refetchMe,
      ];
    }

    if (query === queryDocs.SettingsUserBudgetStatusQuery) {
      return [
        {
          data: { userBudgetStatus: null },
          fetching: false,
        },
        urqlMocks.refetchBudget,
      ];
    }

    return [{ data: undefined, fetching: false }];
  },
}));
vi.mock("@thinkwork/ui", () => ({
  AlertDialog: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  AlertDialogAction: ({
    children,
    ...props
  }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button type="button" {...props}>
      {children}
    </button>
  ),
  AlertDialogCancel: ({ children }: { children: React.ReactNode }) => (
    <button type="button">{children}</button>
  ),
  AlertDialogContent: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  AlertDialogDescription: ({ children }: { children: React.ReactNode }) => (
    <p>{children}</p>
  ),
  AlertDialogFooter: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  AlertDialogHeader: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  AlertDialogTitle: ({ children }: { children: React.ReactNode }) => (
    <h2>{children}</h2>
  ),
  AlertDialogTrigger: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
  Badge: ({ children }: { children: React.ReactNode }) => (
    <span>{children}</span>
  ),
  Button: ({
    children,
    ...props
  }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button type="button" {...props}>
      {children}
    </button>
  ),
  Input: (props: React.InputHTMLAttributes<HTMLInputElement>) => (
    <input {...props} />
  ),
  Select: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  SelectContent: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  SelectItem: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  SelectTrigger: ({ children }: { children: React.ReactNode }) => (
    <button type="button">{children}</button>
  ),
  SelectValue: () => null,
  Switch: ({
    checked,
    disabled,
    onCheckedChange,
    ...props
  }: {
    checked?: boolean;
    disabled?: boolean;
    onCheckedChange?: (checked: boolean) => void;
  } & React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button
      aria-checked={checked}
      disabled={disabled}
      role="switch"
      type="button"
      onClick={() => onCheckedChange?.(!checked)}
      {...props}
    />
  ),
  Textarea: (props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) => (
    <textarea {...props} />
  ),
  cn: (...classes: Array<string | undefined>) =>
    classes.filter(Boolean).join(" "),
}));

import { SelfProfilePage } from "./SelfProfilePage";

beforeEach(() => {
  meMock.current = {
    email: "eric@example.com",
    id: "user-1",
    name: "Eric Odom",
    profile: {
      callBy: null,
      id: "profile-1",
      notes: "Likes focused work.",
      pronouns: null,
      timezone: "America/Chicago",
      title: "Founder",
    },
    tenantId: "tenant-1",
  };
  urqlMocks.updateUser.mockResolvedValue({ data: {} });
  urqlMocks.updateProfile.mockResolvedValue({ data: {} });
  urqlMocks.upsertBudget.mockResolvedValue({ data: {} });
  urqlMocks.deleteBudget.mockResolvedValue({ data: {} });
});

afterEach(() => {
  cleanup();
  headerMocks.usePageHeaderActions.mockReset();
  tenantMocks.role = "member";
  tenantMocks.tenantId = "tenant-1";
  accountUsageMocks.props = [];
  userModelsMocks.props = [];
  for (const mock of Object.values(urqlMocks)) {
    mock.mockReset();
  }
});

describe("SelfProfilePage", () => {
  it("renders only self-service profile and read-only model settings", () => {
    render(<SelfProfilePage />);

    expect(screen.getByText("Eric Odom")).toBeTruthy();
    expect(screen.getByText("eric@example.com")).toBeTruthy();
    expect(screen.getAllByText("Member").length).toBeGreaterThan(0);
    expect(screen.getByText("Unlimited")).toBeTruthy();
    expect(screen.queryByText("Workspace files")).toBeNull();
    expect(screen.queryByText("Danger zone")).toBeNull();
    expect(screen.getByTestId("profile-scroll-pane").className).toContain(
      "overflow-y-auto",
    );
    expect(screen.getByTestId("models").dataset.readonly).toBe("true");
    expect(accountUsageMocks.props).toContainEqual({
      tenantId: "tenant-1",
      userId: "user-1",
    });
    expect(
      screen
        .getByTestId("account-usage-section")
        .compareDocumentPosition(screen.getByDisplayValue("Eric Odom")) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(userModelsMocks.props).toContainEqual({
      readOnly: true,
      userId: "user-1",
    });
  });

  it("allows owners to manage their own budget and model approvals", () => {
    tenantMocks.role = "owner";

    render(<SelfProfilePage />);

    expect(screen.getAllByText("Owner").length).toBeGreaterThan(0);
    expect(screen.getByLabelText("Enable user budget")).toBeTruthy();
    expect(screen.getByTestId("models").dataset.readonly).toBe("false");
    expect(userModelsMocks.props).toContainEqual({
      readOnly: false,
      userId: "user-1",
    });
  });

  it("saves profile edits without role or budget mutations", async () => {
    render(<SelfProfilePage />);

    fireEvent.change(screen.getByDisplayValue("Eric Odom"), {
      target: { value: "Eric O." },
    });
    fireEvent.click(screen.getByText("Save"));

    await waitFor(() => expect(urqlMocks.updateUser).toHaveBeenCalledTimes(1));
    expect(urqlMocks.updateUser).toHaveBeenCalledWith({
      id: "user-1",
      input: { name: "Eric O." },
    });
    expect(urqlMocks.updateProfile).toHaveBeenCalledWith({
      userId: "user-1",
      input: {
        notes: "Likes focused work.",
        timezone: "America/Chicago",
        title: "Founder",
      },
    });
    expect(urqlMocks.updateMember).not.toHaveBeenCalled();
    expect(urqlMocks.upsertBudget).not.toHaveBeenCalled();
    expect(urqlMocks.deleteBudget).not.toHaveBeenCalled();
  });

  it("does not mount account usage before the profile user is loaded", () => {
    meMock.current = null;

    render(<SelfProfilePage />);

    expect(screen.getByText("Your profile could not be loaded.")).toBeTruthy();
    expect(accountUsageMocks.props).toEqual([]);
  });
});
