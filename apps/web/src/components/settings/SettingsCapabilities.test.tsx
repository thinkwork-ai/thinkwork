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

const {
  queryState,
  refetchMock,
  grantMock,
  detachMock,
  toastMock,
  queryDocs,
  previewRefetchMock,
  navigateMock,
} = vi.hoisted(() => ({
  queryState: {
    inspector: {
      data: undefined as unknown,
      fetching: false,
      error: undefined as { message: string } | undefined,
    },
    preview: {
      data: undefined as unknown,
      fetching: false,
      error: undefined as { message: string } | undefined,
    },
    previewFile: {
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
    SettingsWorkspacePreviewQuery: Symbol("workspacePreview"),
    SettingsWorkspacePreviewFileQuery: Symbol("workspacePreviewFile"),
  },
  previewRefetchMock: vi.fn(),
  navigateMock: vi.fn(),
}));

vi.mock("urql", () => ({
  useQuery: ({ query }: { query: unknown }) => {
    if (query === queryDocs.SettingsCapabilityInspectorQuery) {
      return [queryState.inspector, refetchMock];
    }
    if (query === queryDocs.SettingsWorkspacePreviewQuery) {
      return [queryState.preview, previewRefetchMock];
    }
    if (query === queryDocs.SettingsWorkspacePreviewFileQuery) {
      return [queryState.previewFile, vi.fn()];
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

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => navigateMock,
}));

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

const PREVIEW_FILES = [
  { path: "AGENTS.md", owner: "agent", generated: true, size: 2048 },
  {
    path: "skills/approve-receipt/SKILL.md",
    owner: "agent",
    generated: false,
    size: 300,
  },
  {
    path: "skills/stale-skill/SKILL.md",
    owner: "agent",
    generated: false,
    size: 120,
  },
  {
    path: "Spaces/customer/CONTEXT.md",
    owner: "space",
    generated: true,
    size: 800,
  },
];

function previewData(overrides: Record<string, unknown> = {}) {
  return {
    workspacePreview: {
      state: "ok",
      stateDetail: null,
      agentId: "agent-1",
      spaceId: "space-1",
      perspectiveUserId: null,
      noUserBaseline: true,
      files: PREVIEW_FILES,
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
  queryState.preview = {
    data: previewData(),
    fetching: false,
    error: undefined,
  };
  queryState.previewFile = {
    data: undefined,
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

/** The view defaults to State=Active — clear tokens to see the pool. */
function clearDefaultFilters() {
  fireEvent.click(screen.getByText("Clear"));
}

function expandSearch() {
  fireEvent.click(screen.getByTestId("capability-search-toggle"));
}

describe("SettingsCapabilities (read surface)", () => {
  it("renders one tab per capability class with active counts; reasons render verbatim", () => {
    render(<SettingsCapabilities />);
    clearDefaultFilters();
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

  it("quick search is collapsed by default and filters rows when expanded", () => {
    render(<SettingsCapabilities />);
    clearDefaultFilters();
    expect(screen.queryByTestId("capability-search")).toBeNull();
    expandSearch();
    fireEvent.change(screen.getByTestId("capability-search"), {
      target: { value: "expenses" },
    });
    // Skills tab keeps the matching row; the non-matching active row drops.
    // (Scoped to capability rows — the result tree also names skill folders.)
    const rowText = screen
      .queryAllByTestId("capability-row")
      .map((row) => row.textContent)
      .join(" ");
    expect(rowText).toContain("Expenses");
    expect(rowText).not.toContain("approve-receipt");
  });

  it("explains the no-user baseline in the view-info dialog", () => {
    render(<SettingsCapabilities />);
    fireEvent.click(screen.getByTestId("view-info-trigger"));
    expect(screen.getByTestId("baseline-note").textContent).toContain(
      "no-user baseline",
    );
    // The dialog also states the current selection and filters.
    expect(screen.getByTestId("view-info-body").textContent).toContain(
      "no Space (agent baseline)",
    );
    expect(screen.getByTestId("view-info-body").textContent).toContain(
      "state active",
    );
  });

  it("defaults to active-only rows; clearing filters reveals the pool", () => {
    render(<SettingsCapabilities />);
    // trust_gate rows are inactive → hidden by the default State token.
    expect(screen.queryByText("trust_gate")).toBeNull();
    clearDefaultFilters();
    expect(screen.getByText("trust_gate")).toBeTruthy();
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
    clearDefaultFilters();
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
    clearDefaultFilters();
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
    clearDefaultFilters();
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

describe("divergence surface (U13)", () => {
  it("renders per-row deltas and the divergent summary only on fingerprint match", () => {
    queryState.inspector = {
      data: inspection({
        divergence: {
          state: "divergent",
          manifestId: "m-1",
          manifestCreatedAt: "2026-07-02T13:37:00.000Z",
          manifestFingerprint: "abcdef1234567890",
          deltas: [
            {
              capabilityClass: "skill",
              capabilityId: "approve-receipt",
              kind: "missing_in_observed",
            },
            {
              capabilityClass: "mcp_server",
              capabilityId: "shadow-server",
              kind: "extra_in_observed",
            },
          ],
        },
      }),
      fetching: false,
      error: undefined,
    };
    render(<SettingsCapabilities />);
    expect(screen.getByTestId("divergence-chip").textContent).toContain(
      "divergent",
    );
    // Predicted-active row the runtime never loaded → red row badge.
    expect(
      screen.getByTestId("delta-skill:approve-receipt").textContent,
    ).toContain("not loaded last turn");
    // Runtime-only extras summarize in the footer.
    expect(screen.getByTestId("extra-in-observed").textContent).toContain(
      "shadow-server",
    );
  });

  it("renders config-changed as its own state, never divergent (KTD-3)", () => {
    queryState.inspector = {
      data: inspection({
        divergence: {
          state: "config_changed_since_turn",
          manifestId: "m-1",
          manifestCreatedAt: "2026-07-02T13:37:00.000Z",
          manifestFingerprint: "other-fingerprint",
          deltas: null,
        },
      }),
      fetching: false,
      error: undefined,
    };
    render(<SettingsCapabilities />);
    expect(screen.getByTestId("divergence-chip").textContent).toContain(
      "config changed",
    );
    expect(screen.queryByTestId("delta-skill:approve-receipt")).toBeNull();
  });

  it("renders in-sync and no-manifest states", () => {
    queryState.inspector = {
      data: inspection({
        divergence: { state: "in_sync", deltas: null },
      }),
      fetching: false,
      error: undefined,
    };
    const view = render(<SettingsCapabilities />);
    expect(screen.getByTestId("divergence-chip").textContent).toContain(
      "in sync",
    );
    view.unmount();
    queryState.inspector = {
      data: inspection({
        divergence: { state: "no_manifest_yet", deltas: null },
      }),
      fetching: false,
      error: undefined,
    };
    render(<SettingsCapabilities />);
    expect(screen.getByTestId("divergence-chip").textContent).toContain(
      "no turn observed",
    );
  });
});

describe("Composer result tree (U2)", () => {
  it("renders the rendered-workspace tree beside the controls pane", () => {
    render(<SettingsCapabilities />);
    expect(screen.getByTestId("composer-tree")).toBeTruthy();
    expect(screen.getByTestId("tree-node-skills/approve-receipt")).toBeTruthy();
    expect(screen.getByTestId("tree-generated-AGENTS.md")).toBeTruthy();
    // Controls pane still renders its tabs next to the tree.
    expect(screen.getByTestId("capability-tab-skill")).toBeTruthy();
  });

  it("a settled grant confirmation refetches the preview and the new skill folder appears", async () => {
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
    const view = render(<SettingsCapabilities />);
    clearDefaultFilters();
    expect(previewRefetchMock).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId("attach-skill:expenses"));

    await waitFor(() =>
      expect(screen.getByTestId("mutation-confirmation")).toBeTruthy(),
    );
    // Settled write (no sync window) → immediate full preview refetch.
    expect(previewRefetchMock).toHaveBeenCalledWith({
      requestPolicy: "network-only",
    });

    // The refetch lands: the new skill folder is in the tree.
    queryState.preview = {
      data: previewData({
        files: [
          ...PREVIEW_FILES,
          {
            path: "skills/expenses/SKILL.md",
            owner: "agent",
            generated: false,
            size: 90,
          },
        ],
      }),
      fetching: false,
      error: undefined,
    };
    view.rerender(<SettingsCapabilities />);
    expect(
      screen.getByTestId("tree-file-skills/expenses/SKILL.md"),
    ).toBeTruthy();
  });

  it("shows the pending affordance on the affected node during the sync window, then refetches on completion", async () => {
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
    clearDefaultFilters();
    fireEvent.click(screen.getByTestId("attach-skill:expenses"));

    await waitFor(() =>
      expect(screen.getByTestId("sync-pending")).toBeTruthy(),
    );
    // The affected tree node is an explicit ghost — not a frozen view —
    // and the full refetch intentionally waits for sync completion.
    expect(
      screen.getByTestId("tree-pending-skills/expenses").textContent,
    ).toContain("syncing");
    expect(previewRefetchMock).not.toHaveBeenCalled();

    // Materialization lands in the inspector → the sync phase resolves and
    // the preview refetch fires; the ghost is gone.
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
    expect(previewRefetchMock).toHaveBeenCalledWith({
      requestPolicy: "network-only",
    });
    expect(screen.queryByTestId("tree-pending-skills/expenses")).toBeNull();
  });

  it("skill jump-to-cause resets the State/Search tokens and tab so the hidden row lands focused (F2)", () => {
    render(<SettingsCapabilities />);
    // Default toolbar state hides the diagnose target twice over: the
    // Active-only State token drops the trust_gate row, and the current
    // tab is a different capability class.
    fireEvent.mouseDown(screen.getByTestId("capability-tab-mcp_server"), {
      button: 0,
    });
    expect(screen.queryByText("trust_gate")).toBeNull();

    fireEvent.click(screen.getByTestId("tree-jump-skills/stale-skill"));

    // Filters/tab reset in-page: the row is visible and highlighted.
    expect(screen.getByText("trust_gate")).toBeTruthy();
    const focused = screen.getByTestId("capability-row-focused");
    expect(focused.textContent).toContain("stale-skill");
    // No route navigation for in-page focus.
    expect(navigateMock).not.toHaveBeenCalled();
  });

  it("keeps the selection tokens (the query) while resetting only State/Search on jump", () => {
    render(<SettingsCapabilities />);
    expandSearch();
    fireEvent.change(screen.getByTestId("capability-search"), {
      target: { value: "zzz-no-match" },
    });
    // Scoped to capability rows — the tree still names the skill folder.
    expect(
      screen
        .queryAllByTestId("capability-row")
        .map((row) => row.textContent)
        .join(" "),
    ).not.toContain("approve-receipt");

    fireEvent.click(screen.getByTestId("tree-jump-skills/approve-receipt"));

    // Search token cleared → the row is back and focused.
    expect(screen.getByTestId("capability-row-focused").textContent).toContain(
      "approve-receipt",
    );
  });

  it("preview error states degrade consistently with the controls pane copy", () => {
    queryState.preview = {
      data: previewData({
        state: "invalid_selection",
        stateDetail: "space not found in tenant",
        files: null,
      }),
      fetching: false,
      error: undefined,
    };
    render(<SettingsCapabilities />);
    expect(
      screen.getByTestId("preview-invalid-selection").textContent,
    ).toContain("space not found in tenant");
    // The controls pane keeps rendering its own state independently.
    expect(screen.getByTestId("capability-tab-skill")).toBeTruthy();
  });
});
