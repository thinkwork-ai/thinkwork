import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  queryDocs,
  updateSpaceMock,
  upsertPolicyMock,
  emailPolicyState,
  refetchMock,
  pageHeaderMock,
  spaceRecord,
  searchState,
} = vi.hoisted(() => ({
  queryDocs: {
    SettingsSpaceQuery: Symbol("space"),
    SettingsUpdateSpaceMutation: Symbol("updateSpace"),
    SettingsDeleteSpaceMutation: Symbol("deleteSpace"),
    SettingsSpaceEmailPolicyQuery: Symbol("spaceEmailPolicy"),
    SettingsUpsertEmailSpacePolicyMutation: Symbol("upsertEmailSpacePolicy"),
  },
  updateSpaceMock: vi.fn(),
  upsertPolicyMock: vi.fn(),
  emailPolicyState: {
    record: null as Record<string, unknown> | null,
  },
  refetchMock: vi.fn(),
  pageHeaderMock: vi.fn(),
  searchState: {
    file: undefined as string | undefined,
    view: undefined as string | undefined,
  },
  spaceRecord: {
    id: "space-1",
    tenantId: "tenant-1",
    name: "Customer Onboarding",
    description: "Coordinates enterprise onboarding work.",
    status: "ACTIVE",
    accessMode: "PUBLIC",
    slug: "customer-onboarding",
    config: {
      spaceManifest: {
        title: "Customer Onboarding",
        description: "Coordinates enterprise onboarding work.",
        workflows: [
          {
            key: "handoff",
            name: "Handoff",
            description: "Move work to launch.",
            source: "frontmatter",
          },
        ],
        tools: { builtIn: ["web-search"], mcp: ["slack"] },
        skills: ["finance-audit-xls"],
        runtimePolicy: { bash: "restricted" },
        reviewPolicy: { mode: "required" },
        pendingFields: ["tools", "runtime"],
      },
    },
    renderDiagnostics: {
      spaceManifest: {
        status: "warning",
        pendingFields: ["tools", "runtime"],
        diagnostics: [
          {
            severity: "warning",
            code: "SpaceManifestPendingApply",
            path: "tools",
            message:
              "tools is parsed for review, but does not automatically change runtime policy in v1.",
          },
        ],
      },
    },
    toolPolicy: null,
    mcpPolicy: null,
    builtInTools: [],
  } as Record<string, unknown>,
}));

vi.mock("@tanstack/react-router", () => ({
  Link: ({
    children,
    to,
    params,
    search,
  }: {
    children: React.ReactNode;
    to: string;
    params?: Record<string, string>;
    search?: Record<string, string>;
  }) => (
    <a
      href={`${params?.spaceId ? to.replace("$spaceId", params.spaceId) : to}${
        search && Object.keys(search).length
          ? `?${new URLSearchParams(search).toString()}`
          : ""
      }`}
    >
      {children}
    </a>
  ),
  useNavigate: () => vi.fn(),
  useParams: () => ({ spaceId: "space-1" }),
  useSearch: () => searchState,
}));

vi.mock("urql", () => ({
  useQuery: ({ query }: { query: unknown }) =>
    query === queryDocs.SettingsSpaceEmailPolicyQuery
      ? [
          {
            data: { emailSpaceEmailPolicy: emailPolicyState.record },
            fetching: false,
          },
          refetchMock,
        ]
      : [{ data: { space: spaceRecord }, fetching: false }, refetchMock],
  useMutation: (doc: unknown) =>
    doc === queryDocs.SettingsUpsertEmailSpacePolicyMutation
      ? [{ fetching: false }, upsertPolicyMock]
      : [{ fetching: false }, updateSpaceMock],
}));

vi.mock("@/context/PageHeaderContext", () => ({
  usePageHeaderActions: (args: unknown) => pageHeaderMock(args),
}));

vi.mock("@/lib/settings-queries", () => queryDocs);

vi.mock("@/components/workspace-settings/ScopedWorkspaceEditor", () => ({
  ScopedWorkspaceEditor: (props: {
    target: Record<string, string>;
    targetKey: string;
    defaultOpenFile?: string;
    bordered?: boolean;
  }) => (
    <div
      data-testid="space-workspace-editor"
      data-target={JSON.stringify(props.target)}
      data-targetkey={props.targetKey}
      data-default-open={props.defaultOpenFile}
      data-bordered={String(props.bordered)}
    />
  ),
}));

import { SettingsSpaceConfig } from "./SettingsSpaceConfig";

beforeEach(() => {
  updateSpaceMock.mockReset();
  upsertPolicyMock.mockReset();
  upsertPolicyMock.mockResolvedValue({ error: undefined });
  emailPolicyState.record = null;
  refetchMock.mockReset();
  pageHeaderMock.mockReset();
  searchState.view = undefined;
  searchState.file = undefined;
});

afterEach(cleanup);

describe("SettingsSpaceConfig", () => {
  it("renders information without the old SPACE.md overview panel", () => {
    render(<SettingsSpaceConfig />);

    expect(screen.getAllByText("Customer Onboarding").length).toBeGreaterThan(
      0,
    );
    expect(screen.getByText("Information")).toBeTruthy();
    expect(screen.queryByText("SPACE.md overview")).toBeNull();
    expect(screen.queryByText("Sync SPACE.md")).toBeNull();
  });

  it("does not embed the workspace editor on the config view", () => {
    render(<SettingsSpaceConfig />);

    expect(screen.queryByTestId("space-workspace-editor")).toBeNull();
    expect(screen.queryByText("Workspace files")).toBeNull();
  });

  it("publishes the Space files shortcut as a page-header action", () => {
    render(<SettingsSpaceConfig />);

    const lastCall = pageHeaderMock.mock.calls.at(-1)?.[0] as
      | { action?: unknown; actionKey?: string }
      | undefined;
    expect(lastCall?.action).toBeTruthy();
    expect(lastCall?.actionKey).toBe("space-detail:space-1:config");
  });

  it("shows the full Space file editor in the workspace view", () => {
    searchState.view = "workspace";

    render(<SettingsSpaceConfig />);

    const editor = screen.getByTestId("space-workspace-editor");
    expect(JSON.parse(editor.getAttribute("data-target")!)).toEqual({
      spaceId: "space-1",
    });
    expect(editor.getAttribute("data-targetkey")).toBe("space:space-1");
    expect(editor.getAttribute("data-default-open")).toBeNull();
    expect(editor.getAttribute("data-bordered")).toBe("false");
  });

  it("renders the Email section with built-in defaults when no policy row exists", () => {
    render(<SettingsSpaceConfig />);

    expect(screen.getByText("Email")).toBeTruthy();
    const outbound = screen.getByRole("switch", { name: "Outbound email" });
    const review = screen.getByRole("switch", { name: "First-send review" });
    expect(outbound.getAttribute("aria-checked")).toBe("true");
    expect(review.getAttribute("aria-checked")).toBe("true");
  });

  it("saves a waived first-send review through upsertEmailSpacePolicy", async () => {
    render(<SettingsSpaceConfig />);

    fireEvent.click(screen.getByRole("switch", { name: "First-send review" }));
    const saveButtons = screen.getAllByRole("button", { name: "Save" });
    fireEvent.click(saveButtons[saveButtons.length - 1]);

    await vi.waitFor(() => {
      expect(upsertPolicyMock).toHaveBeenCalledWith({
        input: expect.objectContaining({
          spaceId: "space-1",
          enabled: true,
          firstSendReviewRequired: false,
        }),
      });
    });
  });

  it("reflects an existing policy row's flags in the Email section", () => {
    emailPolicyState.record = {
      id: "policy-1",
      spaceId: "space-1",
      providerInstallId: null,
      enabled: false,
      registeredUsersAllowed: true,
      privateSpaceMembershipRequired: true,
      outsideSenderDefault: "deny",
      firstSendReviewRequired: false,
      updatedAt: "2026-07-10T00:00:00Z",
    };

    render(<SettingsSpaceConfig />);

    const outbound = screen.getByRole("switch", { name: "Outbound email" });
    const review = screen.getByRole("switch", { name: "First-send review" });
    expect(outbound.getAttribute("aria-checked")).toBe("false");
    expect(review.getAttribute("aria-checked")).toBe("false");
  });

  it("opens a requested file inside the full Space file editor", () => {
    searchState.view = "workspace";
    searchState.file = "SPACE.md";

    render(<SettingsSpaceConfig />);

    const editor = screen.getByTestId("space-workspace-editor");
    expect(JSON.parse(editor.getAttribute("data-target")!)).toEqual({
      spaceId: "space-1",
    });
    expect(editor.getAttribute("data-default-open")).toBe("SPACE.md");
  });
});
