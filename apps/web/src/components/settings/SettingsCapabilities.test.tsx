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

import React from "react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
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
  refetchExtensionsMock,
  refetchManifestFileMock,
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
    extensions: {
      data: { piExtensions: [] } as unknown,
      fetching: false,
      error: undefined as { message: string } | undefined,
    },
    // THINK-173 U9: the rendered capabilities.json served through the
    // workspace preview-file resolver.
    manifestFile: {
      data: undefined as unknown,
      fetching: false,
      error: undefined as { message: string } | undefined,
    },
  },
  refetchMock: vi.fn(),
  refetchExtensionsMock: vi.fn(),
  refetchManifestFileMock: vi.fn(),
  grantMock: vi.fn(),
  detachMock: vi.fn(),
  toastMock: { success: vi.fn(), error: vi.fn() },
  queryDocs: {
    SettingsCapabilityInspectorQuery: Symbol("capabilityInspector"),
    SettingsSpacesListQuery: Symbol("spacesList"),
    SettingsAgentProfilesQuery: Symbol("agentProfiles"),
    SettingsTenantMembersQuery: Symbol("tenantMembers"),
    SettingsComposerPiExtensionsQuery: Symbol("composerPiExtensions"),
    // Agent page merge U3: registry-shaped read for the Extensions sheet.
    SettingsPiExtensionsQuery: Symbol("piExtensionsRegistry"),
    SettingsPiExtensionFieldsFragment: Symbol("piExtensionFields"),
    SettingsWorkspacePreviewFileQuery: Symbol("workspacePreviewFile"),
    SettingsGrantCapabilityMutation: Symbol("grantCapability"),
    SettingsDetachCapabilityMutation: Symbol("detachCapability"),
    // U9: SettingsAgentExtensions mounts inside the Extensions sheet.
    SettingsImportPiExtensionFromGitHubMutation: Symbol("importPiExtension"),
    SettingsApprovePiExtensionVersionMutation: Symbol("approvePiExtension"),
    SettingsRejectPiExtensionVersionMutation: Symbol("rejectPiExtension"),
    // Agent page merge U2: AgentProfilesSheet's own operations.
    SettingsCreateAgentProfileMutation: Symbol("createAgentProfile"),
    SettingsDeleteAgentProfileMutation: Symbol("deleteAgentProfile"),
    SettingsUpdateAgentProfileMutation: Symbol("updateAgentProfile"),
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
        {
          data: {
            spaces: [
              { id: "space-2", name: "Finance" },
              { id: "space-1", name: "Customer" },
              { id: "space-3", name: "Default" },
            ],
          },
        },
        vi.fn(),
      ];
    }
    if (query === queryDocs.SettingsAgentProfilesQuery) {
      return [
        { data: { agentProfiles: [{ id: "prof-1", name: "Coding" }] } },
        vi.fn(),
      ];
    }
    if (query === queryDocs.SettingsComposerPiExtensionsQuery) {
      return [queryState.extensions, refetchExtensionsMock];
    }
    if (query === queryDocs.SettingsPiExtensionsQuery) {
      return [{ data: { piExtensions: [] }, fetching: false }, vi.fn()];
    }
    if (query === queryDocs.SettingsWorkspacePreviewFileQuery) {
      return [queryState.manifestFile, refetchManifestFileMock];
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
  useTenant: () => ({ tenantId: "tenant-1", userId: "user-1" }),
}));
vi.mock("@/context/PageHeaderContext", () => ({
  usePageHeaderActions: () => {},
}));
vi.mock("@/lib/settings-queries", () => queryDocs);

// Agent page merge U12: page actions render in the AppTopBar via
// SettingsHeader's `actions` prop; render them inline here so the suite can
// click the header icons without mounting the app chrome.
vi.mock("@/components/settings/SettingsContent", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    SettingsHeader: (props: {
      title: string;
      description?: string;
      actions?: React.ReactNode;
    }) => (
      <div>
        <div>{props.title}</div>
        <div data-testid="header-actions-inline">{props.actions}</div>
      </div>
    ),
  };
});

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
    capabilityClass: "mcp_server",
    capabilityId: "slack",
    displayName: "Slack",
    active: false,
    provenance: "tenant MCP registry",
    reason: "oauth_missing",
    detail: "no user OAuth token for this server",
    tokenStatus: "missing",
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
  queryState.extensions = {
    data: { piExtensions: [] },
    fetching: false,
    error: undefined,
  };
  queryState.manifestFile = {
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

function openSheet() {
  fireEvent.click(screen.getByTestId("open-capability-sheet"));
}

function clearDefaultFilters() {
  // No default filters (Agent page merge U12): nothing to clear — the full
  // pool renders immediately. Kept as a no-op so call sites read as intent.
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

  it("withholds write affordances on a read-lens (space) selection", async () => {
    queryState.inspector = {
      data: inspection({ spaceId: "space-1" }),
      fetching: false,
      error: undefined,
    };
    render(<SettingsCapabilities />);
    // The lens now comes from the static Space token (THINK-173).
    fireEvent.click(screen.getByLabelText("Edit Space values"));
    fireEvent.click(await screen.findByText("Customer"));
    expect(editorProps()?.canManageSkills).toBe(false);
  });
});

describe("URL-driven sheet state (U7, KTD-1)", () => {
  it("derives open sheets from urlSheet and routes user intent through the bridge", () => {
    const bridge = vi.fn();
    render(
      <SettingsCapabilities
        urlSheet="inspector"
        urlFocus="skill:approve-receipt"
        onUrlSheetChange={bridge}
      />,
    );
    // Inspector renders focused on the deep-linked row.
    expect(
      screen.getByTestId("inspector-row-skill:approve-receipt").className,
    ).toContain("bg-accent");
    // Opening another sheet is a URL request, not a local state flip.
    fireEvent.click(screen.getByTestId("open-profiles-sheet"));
    expect(bridge).toHaveBeenCalledWith("profiles", undefined);
  });

  it("legacy view=workspace deep links select the file in the tree", () => {
    render(<SettingsCapabilities initialTreeFile="AGENTS.md" />);
    expect(editorProps()?.initialSelectedPath).toBe("AGENTS.md");
  });
});

describe("capability side sheet (read surface)", () => {
  it("explains the no-user baseline in the view-info dialog", () => {
    render(<SettingsCapabilities />);
    fireEvent.click(screen.getByTestId("view-info-trigger"));
    expect(screen.getByTestId("baseline-note").textContent).toContain(
      "no-user baseline",
    );
    expect(screen.getByTestId("view-info-body").textContent).toContain(
      "all states",
    );
  });
});

describe("capability write actions (sheet rows)", () => {
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
    act(() => {
      (editorProps()?.onAddSkill as () => void)();
    });
    fireEvent.click(screen.getByTestId("add-skill-pick-expenses"));
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
    act(() => {
      (editorProps()?.onAddSkill as () => void)();
    });
    fireEvent.click(screen.getByTestId("add-skill-pick-expenses"));
    // The sync window forwards the affected slug to the editor as a ghost.
    await waitFor(() =>
      expect(editorProps()?.pendingSkillSlug).toBe("expenses"),
    );

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
    await waitFor(() => expect(editorProps()?.pendingSkillSlug).toBeNull());
  });

  it("a granted extension version that left the registry shows a disabled detach (plan U8)", () => {
    // Empty registry: the active "Live Ext" (assignment-3) can't be resolved to
    // a version, so its detach is disabled/error rather than silently absent.
    render(<SettingsCapabilities />);
    fireEvent.click(screen.getByTestId("open-extensions-sheet"));
    expect(screen.getByText("Live Ext")).toBeTruthy();
    expect(screen.queryByTestId("detach-pi_extension:assignment-3")).toBeNull();
    expect(
      (
        screen.getByTestId(
          "detach-pi_extension-missing:assignment-3",
        ) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
  });

  it("detaches a granted extension version through the unified mutation (plan U8)", async () => {
    // Registry data resolves assignment-3 → its version id; detach targets that.
    queryState.extensions = {
      data: {
        piExtensions: [
          {
            id: "ver-live",
            sourceId: "src-live",
            displayName: "Live Ext",
            repositoryName: "live-ext",
            repositoryOwner: "acme",
            sourceRef: "main",
            status: "APPROVED",
            permissionClasses: ["fs.read"],
            createdAt: "2026-07-01T00:00:00.000Z",
            updatedAt: "2026-07-01T00:00:00.000Z",
            assignments: [
              {
                id: "assignment-3",
                versionId: "ver-live",
                targetType: "DEFAULT_AGENT",
                agentProfileId: null,
                enabled: true,
              },
            ],
          },
        ],
      },
      fetching: false,
      error: undefined,
    };
    render(<SettingsCapabilities />);
    fireEvent.click(screen.getByTestId("open-extensions-sheet"));
    fireEvent.click(
      screen.getByTestId("detach-confirm-pi_extension:assignment-3"),
    );
    await waitFor(() =>
      expect(detachMock).toHaveBeenCalledWith({
        input: {
          tenantId: "tenant-1",
          capabilityClass: "PI_EXTENSION",
          scope: "AGENT",
          agentId: null,
          agentProfileId: null,
          capabilityRef: "ver-live",
        },
      }),
    );
  });

  it("assigns an approved extension version from the Add picker (plan U8)", async () => {
    // Two approved versions of one extension, none assigned yet → attachable,
    // latest selected by default; grant targets the chosen version id.
    queryState.extensions = {
      data: {
        piExtensions: [
          {
            id: "ver-old",
            sourceId: "src-a",
            displayName: "Alpha Ext",
            repositoryName: "alpha",
            repositoryOwner: "acme",
            sourceRef: "v1",
            status: "APPROVED",
            permissionClasses: ["fs.read"],
            createdAt: "2026-06-01T00:00:00.000Z",
            updatedAt: "2026-06-01T00:00:00.000Z",
            assignments: [],
          },
          {
            id: "ver-new",
            sourceId: "src-a",
            displayName: "Alpha Ext",
            repositoryName: "alpha",
            repositoryOwner: "acme",
            sourceRef: "v2",
            status: "APPROVED",
            permissionClasses: ["fs.read", "net.fetch"],
            createdAt: "2026-06-20T00:00:00.000Z",
            updatedAt: "2026-06-20T00:00:00.000Z",
            assignments: [],
          },
        ],
      },
      fetching: false,
      error: undefined,
    };
    grantMock.mockResolvedValue(grantResult(null));
    render(<SettingsCapabilities />);
    fireEvent.click(screen.getByTestId("open-extensions-sheet"));
    fireEvent.click(screen.getByTestId("open-add-extension"));
    expect(screen.getByTestId("add-extension-dialog")).toBeTruthy();
    expect(screen.getByTestId("add-extension-row-src-a")).toBeTruthy();
    // Default = latest approved version (ver-new).
    fireEvent.click(screen.getByTestId("add-extension-pick-src-a"));
    await waitFor(() =>
      expect(grantMock).toHaveBeenCalledWith({
        input: {
          tenantId: "tenant-1",
          capabilityClass: "PI_EXTENSION",
          scope: "AGENT",
          agentId: null,
          agentProfileId: null,
          capabilityRef: "ver-new",
          grantedPermissions: ["fs.read", "net.fetch"],
        },
      }),
    );
  });

  it("hides the Add-extension control under a space read lens (R11/AE4)", async () => {
    queryState.inspector = {
      data: inspection({ spaceId: "space-1" }),
      fetching: false,
      error: undefined,
    };
    render(<SettingsCapabilities />);
    // The lens now comes from the static Space token (THINK-173).
    fireEvent.click(screen.getByLabelText("Edit Space values"));
    fireEvent.click(await screen.findByText("Customer"));
    fireEvent.click(screen.getByTestId("open-extensions-sheet"));
    expect(screen.queryByTestId("open-add-extension")).toBeNull();
  });
});

describe("tree context-menu callbacks (item 4)", () => {
  it("jump-to-cause and gate badges land on the read-only Inspector (U9, AE7)", () => {
    render(<SettingsCapabilities />);
    expect(screen.queryByTestId("capability-inspector-view")).toBeNull();
    act(() => {
      (editorProps()?.onFocusCapabilityRow as (c: string, i: string) => void)(
        "skill",
        "stale-skill",
      );
    });
    // The diagnose target renders focused in the Inspector — no write
    // affordances anywhere on that surface.
    expect(
      screen.getByTestId("inspector-row-skill:stale-skill").className,
    ).toContain("bg-accent");
    expect(
      screen.getByTestId("inspector-reason-skill:stale-skill").textContent,
    ).toContain("trust_gate");
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

  // Agent page merge U6: tree adds are no longer gated on profile selection —
  // grantScope already switches to AGENT_PROFILE when a profile chip is set.
  it("no longer gates tree add affordances on profile selection", () => {
    const source = readFileSync(
      join(process.cwd(), "src/components/settings/SettingsCapabilities.tsx"),
      "utf8",
    );
    expect(source).not.toContain("!agentProfileId ? () => setAddSkillOpen");
    expect(source).not.toContain("!agentProfileId ? () => setAddMcpOpen");
    expect(source).toContain("profileScopeName={selectedProfileName}");
  });

  it("MCP picker empty state links to the MCP Servers registry", () => {
    queryState.inspector = {
      data: inspection({
        predicted: null,
      }),
      fetching: false,
      error: undefined,
    };
    render(<SettingsCapabilities />);
    act(() => {
      (editorProps()?.onAddMcpServer as () => void)();
    });
    expect(screen.getByTestId("add-mcp-empty-registry-link")).toBeTruthy();
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

describe("MCP tree callbacks (U9c)", () => {
  it("forwards mcp decoration state + sync/removing slugs to the editor", () => {
    render(<SettingsCapabilities />);
    const props = editorProps();
    const map = props?.mcpStateBySlug as Map<
      string,
      { active: boolean; reason: string | null }
    >;
    expect(map.get("github")).toEqual({ active: true, reason: null });
    expect(map.get("slack")).toEqual({
      active: false,
      reason: "oauth_missing",
    });
    expect(typeof props?.onAddMcpServer).toBe("function");
    expect(typeof props?.onDetachMcpServer).toBe("function");
  });

  it("add-MCP picker lists the registered servers with state and grants with the MCP_SERVER class", async () => {
    grantMock.mockResolvedValue({
      data: {
        grantCapability: {
          outcome: "applied",
          inspectionState: "ok",
          computedAt: "2026-07-02T12:01:00.000Z",
          configFingerprint: "fp-after",
          item: {
            capabilityClass: "mcp_server",
            capabilityId: "slack",
            displayName: "Slack",
            active: true,
            provenance: "agent: workspace folder (mcp/slack/)",
            reason: null,
            detail: null,
            tokenStatus: null,
          },
        },
      },
      error: undefined,
    });
    render(<SettingsCapabilities />);
    act(() => {
      (editorProps()?.onAddMcpServer as () => void)();
    });
    expect(screen.getByTestId("add-mcp-dialog")).toBeTruthy();
    // ALL registered servers list, with state shown; the attached one can't
    // be re-added.
    const githubRow = screen.getByTestId("add-mcp-row-github");
    expect(githubRow.textContent).toContain("active");
    expect(githubRow.textContent).toContain("token: expired");
    expect(
      (screen.getByTestId("add-mcp-pick-github") as HTMLButtonElement).disabled,
    ).toBe(true);
    const slackRow = screen.getByTestId("add-mcp-row-slack");
    // Verbatim gate reason + token status render in the picker.
    expect(slackRow.textContent).toContain("oauth_missing");
    expect(slackRow.textContent).toContain("token: missing");
    fireEvent.click(screen.getByTestId("add-mcp-pick-slack"));
    await waitFor(() =>
      expect(grantMock).toHaveBeenCalledWith({
        input: {
          tenantId: "tenant-1",
          capabilityClass: "MCP_SERVER",
          scope: "AGENT",
          agentId: null,
          agentProfileId: null,
          capabilityRef: "slack",
        },
      }),
    );
  });

  it("detach from an mcp/<slug> folder runs detachCapability with the MCP_SERVER class behind the confirm", async () => {
    render(<SettingsCapabilities />);
    act(() => {
      (editorProps()?.onDetachMcpServer as (slug: string) => void)("github");
    });
    fireEvent.click(screen.getByTestId("tree-detach-confirm"));
    await waitFor(() =>
      expect(detachMock).toHaveBeenCalledWith({
        input: {
          tenantId: "tenant-1",
          capabilityClass: "MCP_SERVER",
          scope: "AGENT",
          agentId: null,
          agentProfileId: null,
          capabilityRef: "github",
        },
      }),
    );
  });
});

describe("folder capabilities from the manifest (THINK-173 U9)", () => {
  const MANIFEST = {
    version: 1,
    fingerprint: "f".repeat(64),
    active: [
      { slug: "firecrawl", class: "connection", type: "api" },
      { slug: "web-fetch", class: "tool", kind: "binding" },
      { slug: "read", class: "builtin" },
    ],
    withheld: [
      { slug: "draft-x", class: "tool", reason: "unsigned" },
      { slug: "linear", class: "connection", reason: "definition_drift" },
      { slug: "gated-mailer", class: "tool", reason: "approval_gated" },
      { slug: "shadow", class: "tool", reason: "collision" },
      { slug: "cruncher", class: "tool", reason: "trust_gate" },
      { slug: "blocked-db", class: "connection", reason: "policy_blocked" },
    ],
  };

  function seedManifest(manifest: unknown = MANIFEST) {
    queryState.manifestFile = {
      data: {
        workspacePreviewFile: {
          state: "ok",
          stateDetail: null,
          file: {
            path: "capabilities.json",
            owner: "agent",
            generated: true,
            size: 1,
          },
          content: JSON.stringify(manifest),
        },
      },
      fetching: false,
      error: undefined,
    };
  }

  it("mirrors the manifest's active+withheld sets into the editor decoration exactly", () => {
    seedManifest();
    render(<SettingsCapabilities />);
    const props = editorProps();
    const connections = props?.connectionStateBySlug as Map<
      string,
      { active: boolean; reason: string | null }
    >;
    const tools = props?.toolStateBySlug as Map<
      string,
      { active: boolean; reason: string | null }
    >;
    // Consistency: exactly the manifest's folder-class entries, no more.
    expect([...connections.keys()].sort()).toEqual([
      "blocked-db",
      "firecrawl",
      "linear",
    ]);
    expect([...tools.keys()].sort()).toEqual([
      "cruncher",
      "draft-x",
      "gated-mailer",
      "shadow",
      "web-fetch",
    ]);
    expect(connections.get("firecrawl")).toEqual({
      active: true,
      reason: null,
    });
    // Reason strings carry verbatim from the backend taxonomy.
    expect(connections.get("linear")?.reason).toBe("definition_drift");
    expect(connections.get("blocked-db")?.reason).toBe("policy_blocked");
    expect(tools.get("draft-x")?.reason).toBe("unsigned");
    expect(tools.get("gated-mailer")?.reason).toBe("approval_gated");
    expect(tools.get("shadow")?.reason).toBe("collision");
    expect(tools.get("cruncher")?.reason).toBe("trust_gate");
  });

  it("lists ONLY unsigned folders as pending proposals; approve grants with the folder class", async () => {
    seedManifest();
    render(<SettingsCapabilities />);
    const proposals = screen.getByTestId("pending-proposals");
    expect(proposals.textContent).toContain("tools/draft-x");
    expect(proposals.textContent).not.toContain("linear");
    expect(proposals.textContent).toContain("1 pending proposal");
    fireEvent.click(screen.getByTestId("approve-proposal-tool-draft-x"));
    await waitFor(() =>
      expect(grantMock).toHaveBeenCalledWith({
        input: {
          tenantId: "tenant-1",
          capabilityClass: "TOOL",
          scope: "AGENT",
          agentId: null,
          agentProfileId: null,
          capabilityRef: "draft-x",
        },
      }),
    );
  });

  it("approve from the editor's tree callback grants a CONNECTION proposal", async () => {
    seedManifest();
    render(<SettingsCapabilities />);
    act(() => {
      (
        editorProps()?.onApproveCapabilityFolder as (
          klass: string,
          slug: string,
        ) => void
      )("connection", "pending-conn");
    });
    await waitFor(() =>
      expect(grantMock).toHaveBeenCalledWith({
        input: {
          tenantId: "tenant-1",
          capabilityClass: "CONNECTION",
          scope: "AGENT",
          agentId: null,
          agentProfileId: null,
          capabilityRef: "pending-conn",
        },
      }),
    );
  });

  it("revoke rides the shared detach confirm with the folder class", async () => {
    seedManifest();
    render(<SettingsCapabilities />);
    act(() => {
      (
        editorProps()?.onDetachCapabilityFolder as (
          klass: string,
          slug: string,
        ) => void
      )("connection", "firecrawl");
    });
    fireEvent.click(screen.getByTestId("tree-detach-confirm"));
    await waitFor(() =>
      expect(detachMock).toHaveBeenCalledWith({
        input: {
          tenantId: "tenant-1",
          capabilityClass: "CONNECTION",
          scope: "AGENT",
          agentId: null,
          agentProfileId: null,
          capabilityRef: "firecrawl",
        },
      }),
    );
  });

  it("renders no proposals block when the manifest has none", () => {
    seedManifest({ version: 1, active: [], withheld: [] });
    render(<SettingsCapabilities />);
    expect(screen.queryByTestId("pending-proposals")).toBeNull();
    expect(screen.queryByTestId("drifted-capabilities")).toBeNull();
  });

  it("lists drift/signature-withheld folders with a Re-approve that re-grants the class", async () => {
    seedManifest();
    render(<SettingsCapabilities />);
    const drifted = screen.getByTestId("drifted-capabilities");
    // linear is definition_drift in the shared fixture; unsigned draft-x
    // stays in the proposals block, not here.
    expect(drifted.textContent).toContain("connections/linear");
    expect(drifted.textContent).toContain("changed since approval");
    expect(drifted.textContent).not.toContain("draft-x");
    fireEvent.click(screen.getByTestId("reapprove-proposal-connection-linear"));
    await waitFor(() =>
      expect(grantMock).toHaveBeenCalledWith({
        input: {
          tenantId: "tenant-1",
          capabilityClass: "CONNECTION",
          scope: "AGENT",
          agentId: null,
          agentProfileId: null,
          capabilityRef: "linear",
        },
      }),
    );
  });
});

describe("divergence surface (U13)", () => {
  it("renders the divergent summary in the footer with per-row deltas on the Inspector (U9)", () => {
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
    // Per-row divergence renders on the read-only Inspector (U9).
    fireEvent.click(screen.getByTestId("open-inspector-view"));
    expect(
      screen.getByTestId("inspector-divergent-skill:approve-receipt")
        .textContent,
    ).toContain("Not loaded last turn");
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

// THINK-173 static scope bar (Eric 2026-07-05): three pinned tokens in
// the standard token chrome — no filter icon, no Clear, no remove \u2715.
// The value popover is the shared FilterValueEditor (search + options).
describe("static scope bar", () => {
  it("renders Space, User, and Sub-Agent tokens with required defaults and no clear affordances", () => {
    render(<SettingsCapabilities />);
    const toolbar = screen.getByTestId("capability-toolbar");
    for (const id of [
      "scope-filter-space",
      "scope-filter-user",
      "scope-filter-subagent",
    ]) {
      expect(screen.getByTestId(id)).toBeTruthy();
    }
    // Defaults visible on the value segments.
    expect(screen.getByTestId("scope-filter-space").textContent).toContain(
      "Default",
    );
    expect(screen.getByTestId("scope-filter-user").textContent).toContain(
      "Eric",
    );
    expect(screen.getByTestId("scope-filter-subagent").textContent).toContain(
      "None",
    );
    // No Clear, no add-filter icon, no removable tokens, no remove buttons.
    expect(toolbar.textContent).not.toContain("Clear");
    expect(toolbar.querySelector("[data-token-filter-token]")).toBeNull();
    expect(toolbar.querySelector('[aria-label^="Remove"]')).toBeNull();
  });

  it("selecting a Sub-Agent (agent profile) through the standard popover drives the profile lens", async () => {
    render(<SettingsCapabilities />);
    // Open the shared value popover (search + option rows).
    fireEvent.click(screen.getByLabelText("Edit Sub-Agent values"));
    expect(await screen.findByLabelText("Search filter values")).toBeTruthy();
    fireEvent.click(await screen.findByText("Coding"));
    await waitFor(() => {
      expect(editorProps()?.profileScopeName).toBe("Coding");
    });
  });

  it("keeps write scope on the default view (own perspective)", () => {
    render(<SettingsCapabilities />);
    expect(editorProps()?.canManageSkills).toBe(true);
  });

  it("sorts Space options alphabetically and dedupes a real space named Default", async () => {
    render(<SettingsCapabilities />);
    fireEvent.click(screen.getByLabelText("Edit Space values"));
    await screen.findByLabelText("Search filter values");
    const rows = screen
      .getAllByRole("checkbox")
      .map((row) => row.textContent?.trim());
    // Sentinel Default pinned first, rest alphabetical, no duplicate row
    // for the real space named "Default" (space-3).
    expect(rows).toEqual(["Default", "Customer", "Finance"]);
  });
});
