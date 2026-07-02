/**
 * Capabilities area tests (capability-mapping plan U4 read surface +
 * U8 write actions).
 */

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { queryState, refetchMock, grantMock, detachMock, toastMock, queryDocs } =
  vi.hoisted(() => ({
    queryState: {
      inspector: {
        data: undefined as unknown,
        fetching: false,
        error: undefined as { message: string } | undefined,
      },
    },
    refetchMock: vi.fn(),
    grantMock: vi.fn(),
    detachMock: vi.fn(),
    toastMock: { success: vi.fn(), error: vi.fn() },
    queryDocs: {
      SettingsCapabilityInspectorQuery: Symbol("capabilityInspector"),
      SettingsSpacesListQuery: Symbol("spacesList"),
      SettingsAgentProfilesQuery: Symbol("agentProfiles"),
      SettingsTenantMembersQuery: Symbol("tenantMembers"),
      SettingsGrantCapabilityMutation: Symbol("grantCapability"),
      SettingsDetachCapabilityMutation: Symbol("detachCapability"),
    },
  }));

vi.mock("urql", () => ({
  useQuery: ({ query }: { query: unknown }) => {
    if (query === queryDocs.SettingsCapabilityInspectorQuery) {
      return [queryState.inspector, refetchMock];
    }
    if (query === queryDocs.SettingsSpacesListQuery) {
      return [
        { data: { spaces: [{ id: "space-1", name: "Customer" }] } },
        vi.fn(),
      ];
    }
    if (query === queryDocs.SettingsAgentProfilesQuery) {
      return [
        { data: { agentProfiles: [{ id: "prof-1", name: "Coding" }] } },
        vi.fn(),
      ];
    }
    return [
      {
        data: {
          tenantMembers: [
            {
              principalType: "USER",
              principalId: "u-1",
              user: { id: "user-1", name: "Eric", email: "eric@acme.test" },
            },
          ],
        },
      },
      vi.fn(),
    ];
  },
  useMutation: (doc: unknown) => {
    if (doc === queryDocs.SettingsGrantCapabilityMutation) {
      return [{ fetching: false }, grantMock];
    }
    return [{ fetching: false }, detachMock];
  },
}));

vi.mock("sonner", () => ({ toast: toastMock }));

// The destructive-confirm dialog renders pass-through so its action button
// is directly clickable (same approach as AgentLoopDetail.test.tsx).
vi.mock("@thinkwork/ui", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  const passthrough = ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  );
  return {
    ...actual,
    AlertDialog: passthrough,
    AlertDialogTrigger: passthrough,
    AlertDialogContent: passthrough,
    AlertDialogHeader: passthrough,
    AlertDialogFooter: passthrough,
    AlertDialogTitle: passthrough,
    AlertDialogDescription: passthrough,
    AlertDialogCancel: passthrough,
    AlertDialogAction: ({
      children,
      onClick,
      ...props
    }: React.ComponentProps<"button">) => (
      <button type="button" onClick={onClick} {...props}>
        {children}
      </button>
    ),
  };
});

vi.mock("@/context/TenantContext", () => ({
  useTenant: () => ({ tenantId: "tenant-1" }),
}));
vi.mock("@/context/PageHeaderContext", () => ({
  usePageHeaderActions: () => {},
}));
vi.mock("@/lib/settings-queries", () => queryDocs);

import { SettingsCapabilities } from "./SettingsCapabilities";

const BASE_ITEMS = [
  {
    capabilityClass: "skill",
    capabilityId: "approve-receipt",
    displayName: null,
    active: true,
    provenance: "agent: workspace folder",
    reason: null,
    detail: null,
    tokenStatus: null,
  },
  {
    capabilityClass: "skill",
    capabilityId: "stale-skill",
    displayName: null,
    active: false,
    provenance: null,
    reason: "trust_gate",
    detail: "no current passed trust report for this catalog skill",
    tokenStatus: null,
  },
  {
    capabilityClass: "skill",
    capabilityId: "expenses",
    displayName: "Expenses",
    active: false,
    provenance: "tenant catalog",
    reason: "not_installed",
    detail: "in the tenant skill catalog but not installed to this agent",
    tokenStatus: null,
  },
  {
    capabilityClass: "mcp_server",
    capabilityId: "github",
    displayName: "GitHub",
    active: true,
    provenance: "tenant MCP registry",
    reason: null,
    detail: null,
    tokenStatus: "expired",
  },
  {
    capabilityClass: "pi_extension",
    capabilityId: "assignment-9",
    displayName: "Broken Ext",
    active: false,
    provenance: null,
    reason: "extension_validation_failed",
    detail: "verification artifact hash is stale",
    tokenStatus: null,
  },
  {
    capabilityClass: "pi_extension",
    capabilityId: "assignment-3",
    displayName: "Live Ext",
    active: true,
    provenance: "agent: extension assignment",
    reason: null,
    detail: null,
    tokenStatus: null,
  },
  {
    capabilityClass: "agent_profile",
    capabilityId: "coding",
    displayName: "Coding",
    active: true,
    provenance: "tenant-global profile",
    reason: null,
    detail: null,
    tokenStatus: null,
  },
];

function inspection(overrides: Record<string, unknown> = {}) {
  return {
    capabilityInspector: {
      state: "ok",
      stateDetail: null,
      agentId: "agent-1",
      spaceId: null,
      agentProfileId: null,
      perspectiveUserId: null,
      noUserBaseline: true,
      predicted: {
        variant: "PREDICTED",
        computedAt: "2026-07-02T12:00:00.000Z",
        configFingerprint: "abcdef1234567890",
        items: BASE_ITEMS,
      },
      ...overrides,
    },
  };
}

function grantResult(
  item: Record<string, unknown> | null,
  outcome = "applied",
) {
  return {
    data: {
      grantCapability: {
        outcome,
        inspectionState: "ok",
        computedAt: "2026-07-02T12:01:00.000Z",
        configFingerprint: "fp-after",
        item,
      },
    },
    error: undefined,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  queryState.inspector = {
    data: inspection(),
    fetching: false,
    error: undefined,
  };
  grantMock.mockResolvedValue(grantResult(null));
  detachMock.mockResolvedValue({
    data: {
      detachCapability: {
        outcome: "applied",
        inspectionState: "ok",
        computedAt: "2026-07-02T12:01:00.000Z",
        configFingerprint: "fp-after",
        item: null,
      },
    },
    error: undefined,
  });
});

afterEach(() => cleanup());

describe("SettingsCapabilities (read surface)", () => {
  it("renders one tab per capability class with active counts; reasons render verbatim", () => {
    render(<SettingsCapabilities />);
    // Tabs carry the class label + count of ACTIVE items in the class.
    expect(screen.getByTestId("capability-tab-skill").textContent).toContain(
      "Skills",
    );
    expect(screen.getByTestId("capability-tab-skill").textContent).toContain(
      "1",
    ); // approve-receipt is the only active skill
    expect(
      screen.getByTestId("capability-tab-mcp_server").textContent,
    ).toContain("MCP servers");
    // Default tab = Skills: verbatim reason chips (R6).
    expect(screen.getByText("trust_gate")).toBeTruthy();
    expect(screen.getAllByText("active").length).toBeGreaterThan(0);
    // Switch to Pi extensions: its rows + verbatim reasons render.
    fireEvent.mouseDown(screen.getByTestId("capability-tab-pi_extension"), {
      button: 0,
    });
    expect(screen.getByText("extension_validation_failed")).toBeTruthy();
    expect(
      screen.getByText("verification artifact hash is stale"),
    ).toBeTruthy();
    // Switch to MCP servers: token status badge renders.
    fireEvent.mouseDown(screen.getByTestId("capability-tab-mcp_server"), {
      button: 0,
    });
    expect(screen.getByText("token: expired")).toBeTruthy();
  });

  it("quick search filters rows across the view", () => {
    render(<SettingsCapabilities />);
    fireEvent.change(screen.getByTestId("capability-search"), {
      target: { value: "expenses" },
    });
    // Skills tab keeps the matching row; the non-matching active row drops.
    expect(screen.getByText("Expenses")).toBeTruthy();
    expect(screen.queryByText("approve-receipt")).toBeNull();
  });

  it("labels the no-user baseline", () => {
    render(<SettingsCapabilities />);
    expect(screen.getByTestId("baseline-note").textContent).toContain(
      "no-user baseline",
    );
  });

  it("shows the loading state while a refetch is in flight", () => {
    queryState.inspector = {
      data: undefined,
      fetching: true,
      error: undefined,
    };
    render(<SettingsCapabilities />);
    expect(screen.getByTestId("capability-loading")).toBeTruthy();
  });

  it("renders the fault state distinctly from empty", () => {
    queryState.inspector = {
      data: inspection({
        state: "resolution_fault",
        stateDetail: "db unavailable",
        predicted: null,
      }),
      fetching: false,
      error: undefined,
    };
    render(<SettingsCapabilities />);
    expect(screen.getByTestId("resolution-fault").textContent).toContain(
      "db unavailable",
    );
  });

  it("renders invalid selections with the backend detail", () => {
    queryState.inspector = {
      data: inspection({
        state: "invalid_selection",
        stateDetail: "space not found in tenant",
        predicted: null,
      }),
      fetching: false,
      error: undefined,
    };
    render(<SettingsCapabilities />);
    expect(screen.getByTestId("invalid-selection").textContent).toContain(
      "space not found in tenant",
    );
  });
});

describe("SettingsCapabilities write actions (U8)", () => {
  it("attach on a not-installed pool row invokes grantCapability and ends on the fresh item state (AE1)", async () => {
    grantMock.mockResolvedValue(
      grantResult({
        capabilityClass: "skill",
        capabilityId: "expenses",
        displayName: "Expenses",
        active: true,
        provenance: "agent: workspace folder",
        reason: null,
        detail: null,
        tokenStatus: null,
      }),
    );
    render(<SettingsCapabilities />);
    fireEvent.click(screen.getByTestId("attach-skill:expenses"));

    await waitFor(() =>
      expect(screen.getByTestId("mutation-confirmation")).toBeTruthy(),
    );
    expect(grantMock).toHaveBeenCalledWith({
      input: {
        tenantId: "tenant-1",
        capabilityClass: "SKILL",
        scope: "AGENT",
        agentId: null,
        agentProfileId: null,
        capabilityRef: "expenses",
      },
    });
    const banner = screen.getByTestId("mutation-confirmation");
    expect(banner.textContent).toContain("Expenses");
    expect(banner.textContent).toContain("active");
    // The view refetches so the pool row flips without a manual refresh.
    expect(refetchMock).toHaveBeenCalled();
  });

  it("a held gate shows the true gate state, not success", async () => {
    grantMock.mockResolvedValue(
      grantResult({
        capabilityClass: "skill",
        capabilityId: "expenses",
        displayName: "Expenses",
        active: false,
        provenance: "tenant catalog",
        reason: "eval_gate",
        detail: "held: candidate scored below the tenant eval gate",
        tokenStatus: null,
      }),
    );
    render(<SettingsCapabilities />);
    fireEvent.click(screen.getByTestId("attach-skill:expenses"));

    await waitFor(() =>
      expect(screen.getByTestId("mutation-confirmation")).toBeTruthy(),
    );
    const banner = screen.getByTestId("mutation-confirmation");
    expect(banner.textContent).toContain("eval_gate");
    expect(banner.textContent).not.toContain("sync pending");
  });

  it("post-attach S3 lag renders sync pending, resolving to active when the row lands", async () => {
    grantMock.mockResolvedValue(
      grantResult({
        capabilityClass: "skill",
        capabilityId: "expenses",
        displayName: "Expenses",
        active: false,
        provenance: "tenant catalog",
        reason: "not_installed",
        detail: null,
        tokenStatus: null,
      }),
    );
    const view = render(<SettingsCapabilities />);
    fireEvent.click(screen.getByTestId("attach-skill:expenses"));

    await waitFor(() =>
      expect(screen.getByTestId("sync-pending")).toBeTruthy(),
    );

    // The materialization lands: the inspector now reports the row active.
    queryState.inspector = {
      data: inspection({
        predicted: {
          variant: "PREDICTED",
          computedAt: "2026-07-02T12:02:00.000Z",
          configFingerprint: "fp-final",
          items: BASE_ITEMS.map((item) =>
            item.capabilityId === "expenses"
              ? {
                  ...item,
                  active: true,
                  reason: null,
                  provenance: "agent: workspace folder",
                }
              : item,
          ),
        },
      }),
      fetching: false,
      error: undefined,
    };
    view.rerender(<SettingsCapabilities />);

    await waitFor(() =>
      expect(screen.queryByTestId("sync-pending")).toBeNull(),
    );
    expect(screen.getByTestId("mutation-confirmation").textContent).toContain(
      "active",
    );
  });

  it("detach flows through the destructive confirm and shows the post-detach state", async () => {
    detachMock.mockResolvedValue({
      data: {
        detachCapability: {
          outcome: "applied",
          inspectionState: "ok",
          computedAt: "2026-07-02T12:01:00.000Z",
          configFingerprint: "fp-after",
          item: {
            capabilityClass: "skill",
            capabilityId: "approve-receipt",
            displayName: null,
            active: false,
            provenance: "tenant catalog",
            reason: "not_installed",
            detail: null,
            tokenStatus: null,
          },
        },
      },
      error: undefined,
    });
    render(<SettingsCapabilities />);
    // Pass-through dialog: the confirm action is directly clickable.
    fireEvent.click(screen.getByTestId("detach-confirm-skill:approve-receipt"));

    await waitFor(() =>
      expect(screen.getByTestId("mutation-confirmation")).toBeTruthy(),
    );
    expect(detachMock).toHaveBeenCalledWith({
      input: {
        tenantId: "tenant-1",
        capabilityClass: "SKILL",
        scope: "AGENT",
        agentId: null,
        agentProfileId: null,
        capabilityRef: "approve-receipt",
      },
    });
    expect(screen.getByTestId("mutation-confirmation").textContent).toContain(
      "not_installed",
    );
  });

  it("grant actions are absent on a space selection (R11)", () => {
    queryState.inspector = {
      data: inspection({ spaceId: "space-1" }),
      fetching: false,
      error: undefined,
    };
    render(<SettingsCapabilities />);
    expect(screen.queryByTestId("attach-skill:expenses")).toBeNull();
    expect(screen.queryByTestId("detach-skill:approve-receipt")).toBeNull();
  });

  it("grant actions are absent on a perspective-user selection (R11)", () => {
    queryState.inspector = {
      data: inspection({ perspectiveUserId: "user-1", noUserBaseline: false }),
      fetching: false,
      error: undefined,
    };
    render(<SettingsCapabilities />);
    expect(screen.queryByTestId("attach-skill:expenses")).toBeNull();
    expect(screen.queryByTestId("detach-skill:approve-receipt")).toBeNull();
  });

  it("extension rows carry no row actions here (assignment lives on the extensions surface)", () => {
    render(<SettingsCapabilities />);
    fireEvent.mouseDown(screen.getByTestId("capability-tab-pi_extension"), {
      button: 0,
    });
    // The active extension row renders — but with no detach action.
    expect(screen.getByText("Live Ext")).toBeTruthy();
    expect(screen.queryByTestId("detach-pi_extension:assignment-3")).toBeNull();
  });
});
