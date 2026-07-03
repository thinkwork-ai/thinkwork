/**
 * Composer host tests (capability-mapping plan U4/U8; Composer v1.1).
 *
 * v1.1 moves the capability list into a right Side Sheet and turns the main
 * area into the `ComposerWorkspaceEditor` shell. The editor is stubbed here so
 * these tests exercise host WIRING — the sheet, the tab active/total counts,
 * attach/detach through the sheet rows, and the tree context-menu callbacks
 * (jump-to-cause, add-skill picker, detach confirm) that route back into the
 * SAME grant/detach machinery.
 */

import {
  act,
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
  editorPropsSpy,
} = vi.hoisted(() => ({
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
  editorPropsSpy: vi.fn(),
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

// The Side Sheet is a controlled passthrough that mounts its content only when
// open; AlertDialog is a passthrough so confirm buttons are directly clickable.
vi.mock("@thinkwork/ui", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  const pass = ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  );
  return {
    ...actual,
    Sheet: ({
      open,
      children,
    }: {
      open?: boolean;
      children?: React.ReactNode;
    }) =>
      open ? <div data-testid="capability-sheet-open">{children}</div> : null,
    SheetContent: pass,
    SheetHeader: pass,
    SheetTitle: pass,
    SheetDescription: pass,
    AlertDialog: pass,
    AlertDialogTrigger: pass,
    AlertDialogContent: pass,
    AlertDialogHeader: pass,
    AlertDialogFooter: pass,
    AlertDialogTitle: pass,
    AlertDialogDescription: pass,
    AlertDialogCancel: pass,
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

// The editor shell is exercised in its own suite — stub it and capture props.
vi.mock("@/components/settings/ComposerWorkspaceEditor", () => ({
  ComposerWorkspaceEditor: (props: Record<string, unknown>) => {
    editorPropsSpy(props);
    return <div data-testid="composer-editor-stub" />;
  },
}));

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

function openSheet() {
  fireEvent.click(screen.getByTestId("open-capability-sheet"));
}

function clearDefaultFilters() {
  fireEvent.click(screen.getByText("Clear"));
}

function expandSearch() {
  fireEvent.click(screen.getByTestId("capability-search-toggle"));
}

/** Latest props the host passed into the (stubbed) editor. */
function editorProps() {
  return editorPropsSpy.mock.calls.at(-1)?.[0] as
    | Record<string, unknown>
    | undefined;
}

describe("Composer shell wiring", () => {
  it("renders the editor beside the toolbar and the computed footer", () => {
    render(<SettingsCapabilities />);
    expect(screen.getByTestId("composer-editor-stub")).toBeTruthy();
    expect(screen.getByTestId("capability-toolbar")).toBeTruthy();
    // The capability list is NOT mounted until the sheet opens.
    expect(screen.queryByTestId("capability-tab-skill")).toBeNull();
  });

  it("passes skill decoration + write affordances to the editor", () => {
    render(<SettingsCapabilities />);
    const props = editorProps();
    const map = props?.skillStateBySlug as Map<
      string,
      { active: boolean; reason: string | null }
    >;
    expect(map.get("stale-skill")).toEqual({
      active: false,
      reason: "trust_gate",
    });
    // Default-agent write scope: add + detach handlers are provided.
    expect(props?.canManageSkills).toBe(true);
    expect(typeof props?.onAddSkill).toBe("function");
    expect(typeof props?.onDetachSkill).toBe("function");
  });

  it("withholds write affordances on a read-lens (space) selection", () => {
    queryState.inspector = {
      data: inspection({ spaceId: "space-1" }),
      fetching: false,
      error: undefined,
    };
    render(<SettingsCapabilities />);
    expect(editorProps()?.canManageSkills).toBe(false);
  });
});

describe("capability side sheet (read surface)", () => {
  it("class tab counts read active/total, independent of the State filter", () => {
    render(<SettingsCapabilities />);
    openSheet();
    // Skills: 1 active (approve-receipt) of 3 total — even though the default
    // State token hides the 2 inactive rows.
    expect(screen.getByTestId("capability-tab-skill").textContent).toContain(
      "Skills",
    );
    expect(screen.getByTestId("capability-tab-skill").textContent).toContain(
      "1/3",
    );
    expect(
      screen.getByTestId("capability-tab-mcp_server").textContent,
    ).toContain("MCP servers");
  });

  it("renders verbatim reason chips and token status across tabs", () => {
    render(<SettingsCapabilities />);
    openSheet();
    clearDefaultFilters();
    expect(screen.getByText("trust_gate")).toBeTruthy();
    fireEvent.mouseDown(screen.getByTestId("capability-tab-pi_extension"), {
      button: 0,
    });
    expect(screen.getByText("extension_validation_failed")).toBeTruthy();
    expect(
      screen.getByText("verification artifact hash is stale"),
    ).toBeTruthy();
    fireEvent.mouseDown(screen.getByTestId("capability-tab-mcp_server"), {
      button: 0,
    });
    expect(screen.getByText("token: expired")).toBeTruthy();
  });

  it("defaults to active-only rows; clearing filters reveals the pool", () => {
    render(<SettingsCapabilities />);
    openSheet();
    expect(screen.queryByText("trust_gate")).toBeNull();
    clearDefaultFilters();
    expect(screen.getByText("trust_gate")).toBeTruthy();
  });

  it("quick search filters rows when expanded", () => {
    render(<SettingsCapabilities />);
    openSheet();
    clearDefaultFilters();
    expandSearch();
    fireEvent.change(screen.getByTestId("capability-search"), {
      target: { value: "expenses" },
    });
    const rowText = screen
      .queryAllByTestId("capability-row")
      .map((row) => row.textContent)
      .join(" ");
    expect(rowText).toContain("Expenses");
    expect(rowText).not.toContain("approve-receipt");
  });

  it("shows the loading state while a refetch is in flight", () => {
    queryState.inspector = {
      data: undefined,
      fetching: true,
      error: undefined,
    };
    render(<SettingsCapabilities />);
    openSheet();
    expect(screen.getByTestId("capability-loading")).toBeTruthy();
  });

  it("renders fault + invalid selection states in the sheet", () => {
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
    openSheet();
    expect(screen.getByTestId("resolution-fault").textContent).toContain(
      "db unavailable",
    );
  });

  it("explains the no-user baseline in the view-info dialog", () => {
    render(<SettingsCapabilities />);
    fireEvent.click(screen.getByTestId("view-info-trigger"));
    expect(screen.getByTestId("baseline-note").textContent).toContain(
      "no-user baseline",
    );
    expect(screen.getByTestId("view-info-body").textContent).toContain(
      "state active",
    );
  });
});

describe("capability write actions (sheet rows)", () => {
  it("attach on a not-installed pool row invokes grantCapability and ends on the fresh state", async () => {
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
    openSheet();
    clearDefaultFilters();
    fireEvent.click(screen.getByTestId("attach-skill:expenses"));
    // No persistent banner — the mutation fires and the view refetches so the
    // live tree + sheet reflect the result.
    await waitFor(() =>
      expect(grantMock).toHaveBeenCalledWith({
        input: {
          tenantId: "tenant-1",
          capabilityClass: "SKILL",
          scope: "AGENT",
          agentId: null,
          agentProfileId: null,
          capabilityRef: "expenses",
        },
      }),
    );
    expect(screen.queryByTestId("mutation-confirmation")).toBeNull();
    await waitFor(() => expect(refetchMock).toHaveBeenCalled());
  });

  it("a held gate leaves no stuck pending node (no sync ghost)", async () => {
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
    openSheet();
    clearDefaultFilters();
    fireEvent.click(screen.getByTestId("attach-skill:expenses"));
    await waitFor(() => expect(grantMock).toHaveBeenCalled());
    // A held gate (reason ≠ not_installed) is settled immediately — no ghost.
    expect(editorProps()?.pendingSkillSlug).toBeNull();
  });

  it("post-attach S3 lag forwards a sync ghost to the editor, cleared when the row lands active", async () => {
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
    openSheet();
    clearDefaultFilters();
    fireEvent.click(screen.getByTestId("attach-skill:expenses"));
    // The sync window forwards the affected slug to the editor as a ghost.
    await waitFor(() => expect(editorProps()?.pendingSkillSlug).toBe("expenses"));

    queryState.inspector = {
      data: inspection({
        predicted: {
          variant: "PREDICTED",
          computedAt: "2026-07-02T12:02:00.000Z",
          configFingerprint: "fp-final",
          items: BASE_ITEMS.map((item) =>
            item.capabilityId === "expenses"
              ? { ...item, active: true, reason: null }
              : item,
          ),
        },
      }),
      fetching: false,
      error: undefined,
    };
    view.rerender(<SettingsCapabilities />);
    await waitFor(() =>
      expect(editorProps()?.pendingSkillSlug).toBeNull(),
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
    openSheet();
    fireEvent.click(screen.getByTestId("detach-confirm-skill:approve-receipt"));
    await waitFor(() =>
      expect(detachMock).toHaveBeenCalledWith({
        input: {
          tenantId: "tenant-1",
          capabilityClass: "SKILL",
          scope: "AGENT",
          agentId: null,
          agentProfileId: null,
          capabilityRef: "approve-receipt",
        },
      }),
    );
    // No persistent banner; the refetch reflects the post-detach state.
    expect(screen.queryByTestId("mutation-confirmation")).toBeNull();
    await waitFor(() => expect(refetchMock).toHaveBeenCalled());
  });

  it("grant actions are absent on a space selection (R11)", () => {
    queryState.inspector = {
      data: inspection({ spaceId: "space-1" }),
      fetching: false,
      error: undefined,
    };
    render(<SettingsCapabilities />);
    openSheet();
    expect(screen.queryByTestId("attach-skill:expenses")).toBeNull();
    expect(screen.queryByTestId("detach-skill:approve-receipt")).toBeNull();
  });

  it("extension rows carry no row actions here", () => {
    render(<SettingsCapabilities />);
    openSheet();
    fireEvent.mouseDown(screen.getByTestId("capability-tab-pi_extension"), {
      button: 0,
    });
    expect(screen.getByText("Live Ext")).toBeTruthy();
    expect(screen.queryByTestId("detach-pi_extension:assignment-3")).toBeNull();
  });
});

describe("tree context-menu callbacks (item 4)", () => {
  it("jump-to-cause opens the sheet, resets State/Search, switches tab, focuses the row", () => {
    render(<SettingsCapabilities />);
    // Sheet closed initially.
    expect(screen.queryByTestId("capability-row-focused")).toBeNull();
    act(() => {
      (editorProps()?.onFocusCapabilityRow as (c: string, i: string) => void)(
        "skill",
        "stale-skill",
      );
    });
    // The hidden diagnose target is now visible + focused inside the open sheet.
    expect(screen.getByText("trust_gate")).toBeTruthy();
    const focused = screen.getByTestId("capability-row-focused");
    expect(focused.textContent).toContain("stale-skill");
  });

  it("detach from the tree runs the SAME detach mutation behind a confirm", async () => {
    render(<SettingsCapabilities />);
    act(() => {
      (editorProps()?.onDetachSkill as (slug: string) => void)(
        "approve-receipt",
      );
    });
    fireEvent.click(screen.getByTestId("tree-detach-confirm"));
    await waitFor(() =>
      expect(detachMock).toHaveBeenCalledWith(
        expect.objectContaining({
          input: expect.objectContaining({ capabilityRef: "approve-receipt" }),
        }),
      ),
    );
  });

  it("add-skill picker lists the not-installed pool and grants on pick", async () => {
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
    act(() => {
      (editorProps()?.onAddSkill as () => void)();
    });
    expect(screen.getByTestId("add-skill-dialog")).toBeTruthy();
    // Pool = every inactive skill (not_installed + gated).
    expect(screen.getByTestId("add-skill-row-expenses")).toBeTruthy();
    expect(screen.getByTestId("add-skill-row-stale-skill")).toBeTruthy();
    fireEvent.click(screen.getByTestId("add-skill-pick-expenses"));
    await waitFor(() =>
      expect(grantMock).toHaveBeenCalledWith(
        expect.objectContaining({
          input: expect.objectContaining({ capabilityRef: "expenses" }),
        }),
      ),
    );
  });
});

describe("divergence surface (U13)", () => {
  it("renders per-row deltas and the divergent summary", () => {
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
    // The divergence chip + runtime-only extras live in the always-visible footer.
    expect(screen.getByTestId("divergence-chip").textContent).toContain(
      "divergent",
    );
    expect(screen.getByTestId("extra-in-observed").textContent).toContain(
      "shadow-server",
    );
    // The per-row delta badge is in the sheet.
    openSheet();
    expect(
      screen.getByTestId("delta-skill:approve-receipt").textContent,
    ).toContain("not loaded last turn");
  });

  it("renders config-changed as its own state, never divergent", () => {
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
  });

  it("renders in-sync and no-manifest states", () => {
    queryState.inspector = {
      data: inspection({ divergence: { state: "in_sync", deltas: null } }),
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
