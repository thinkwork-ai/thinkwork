/**
 * Composer workspace editor tests (Composer plan U2; v1.1 items 1, 3, 4).
 *
 * The editor is the WorkspaceSettingsView-style shell (full-height tree + real
 * CodeMirror pane) backed by the read-only `createComposerPreviewClient`
 * adapter. These tests mock that adapter so the manifest / file payloads are
 * driven deterministically, and mock the shared workspace-editor components so
 * no CodeMirror mounts in jsdom.
 */

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
  getManifestMock,
  getFilePayloadMock,
  navigateMock,
  editorSpy,
  tenant,
  putFileMock,
  sourceGetFileMock,
  deleteFileMock,
  renamePathMock,
  movePathMock,
  focusRowMock,
  addSkillMock,
  detachSkillMock,
  addMcpMock,
  detachMcpMock,
} = vi.hoisted(() => ({
  getManifestMock: vi.fn(),
  getFilePayloadMock: vi.fn(),
  navigateMock: vi.fn(),
  editorSpy: vi.fn(),
  tenant: { isOperator: true, roleResolved: true },
  putFileMock: vi.fn(),
  sourceGetFileMock: vi.fn(),
  deleteFileMock: vi.fn(),
  renamePathMock: vi.fn(),
  movePathMock: vi.fn(),
  focusRowMock: vi.fn(),
  addSkillMock: vi.fn(),
  detachSkillMock: vi.fn(),
  addMcpMock: vi.fn(),
  detachMcpMock: vi.fn(),
}));

vi.mock("urql", () => ({ useClient: () => ({}) }));

vi.mock("@/lib/composer-preview-client", () => ({
  createComposerPreviewClient: () => ({
    getManifest: () => getManifestMock(),
    getFilePayload: (path: string) => getFilePayloadMock(path),
    putFile: () => Promise.reject(new Error("read-only")),
    deleteFile: () => Promise.reject(new Error("read-only")),
    listFiles: () => Promise.resolve({ files: [] }),
    getFile: () =>
      Promise.resolve({ content: "", source: "agent", sha256: "" }),
  }),
}));

vi.mock("@tanstack/react-router", () => ({ useNavigate: () => navigateMock }));

vi.mock("@thinkwork/workspace-editor", () => ({
  DEFAULT_MANAGED_SECTION_HEADINGS: [],
  editTouchesManagedSection: () => false,
  FileEditorPane: (props: {
    value: string;
    readOnly?: boolean;
    headerBadges?: React.ReactNode;
    headerActions?: React.ReactNode;
    onChange?: (value: string) => void;
    onSave?: () => void;
  }) => (
    <div
      data-testid="cm-pane"
      data-readonly={props.readOnly ? "true" : "false"}
    >
      {props.headerBadges}
      <textarea
        data-testid="cm-input"
        value={props.value}
        readOnly={props.readOnly}
        onChange={(event) => props.onChange?.(event.target.value)}
      />
      <button type="button" data-testid="cm-save" onClick={props.onSave}>
        save
      </button>
      {props.headerActions}
    </div>
  ),
  WorkspaceFileEditor: (props: Record<string, unknown>) => {
    editorSpy(props);
    return <div data-testid="mock-editor" />;
  },
}));

vi.mock("@/context/TenantContext", () => ({ useTenant: () => tenant }));

vi.mock("@/components/LoadingShimmer", () => ({
  LoadingShimmer: () => <div data-testid="loading-shimmer" />,
}));

vi.mock("@/lib/workspace-files-api", () => ({
  spacesWorkspaceFilesClient: {
    listFiles: vi.fn().mockResolvedValue({ files: [] }),
    getFile: (...args: unknown[]) => sourceGetFileMock(...args),
    putFile: (...args: unknown[]) => putFileMock(...args),
    deleteFile: (...args: unknown[]) => deleteFileMock(...args),
    renamePath: (...args: unknown[]) => renamePathMock(...args),
    movePath: (...args: unknown[]) => movePathMock(...args),
  },
}));

// ContextMenu is a passthrough so its items render + click deterministically.
vi.mock("@thinkwork/ui", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  const pass = ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  );
  return {
    ...actual,
    // react-resizable-panels chokes on apps/web's ResizeObserver stub — render
    // plain passthroughs so the resizable shell mounts deterministically.
    ResizablePanelGroup: pass,
    ResizablePanel: pass,
    ResizableHandle: () => <div data-testid="resizable-handle" />,
    ContextMenu: pass,
    ContextMenuTrigger: pass,
    ContextMenuContent: pass,
    ContextMenuSeparator: () => <hr />,
    ContextMenuItem: ({
      children,
      onSelect,
      ...props
    }: React.ComponentProps<"button"> & { onSelect?: () => void }) => (
      <button type="button" onClick={() => onSelect?.()} {...props}>
        {children}
      </button>
    ),
  };
});

import {
  ComposerWorkspaceEditor,
  causeOf,
  type SkillNodeState,
} from "./ComposerWorkspaceEditor";

const ENTRIES = [
  { path: "AGENTS.md", owner: "agent", generated: true, size: 2048 },
  { path: "CAPABILITIES.md", owner: "agent", generated: false, size: 512 },
  {
    path: "skills/approve-receipt/SKILL.md",
    owner: "agent",
    generated: false,
    size: 300,
  },
  {
    path: "Spaces/customer-success/CONTEXT.md",
    owner: "space",
    generated: true,
    size: 900,
  },
  {
    path: "Spaces/customer-success/notes.md",
    owner: "space",
    generated: false,
    size: 100,
  },
  { path: "User/USER.md", owner: "user", generated: false, size: 128 },
  // MCP attachment folders (U9a dual-write): agent-owned reference manifests.
  {
    path: "mcp/github/.assignment.json",
    owner: "agent",
    generated: false,
    size: 220,
  },
  {
    path: "mcp/gmail/.assignment.json",
    owner: "agent",
    generated: false,
    size: 210,
  },
];

function manifest(overrides: Record<string, unknown> = {}) {
  return {
    state: "ok",
    stateDetail: null,
    agentId: "agent-1",
    spaceId: "space-1",
    perspectiveUserId: "user-1",
    noUserBaseline: false,
    entries: ENTRIES,
    ...overrides,
  };
}

function filePayload(overrides: Record<string, unknown> = {}) {
  return {
    state: "ok",
    stateDetail: null,
    content: "# Rendered body",
    entry: { path: "AGENTS.md", owner: "agent", generated: true, size: 2048 },
    ...overrides,
  };
}

function renderRaw(
  props: Partial<React.ComponentProps<typeof ComposerWorkspaceEditor>> = {},
) {
  return render(
    <ComposerWorkspaceEditor
      tenantId="tenant-1"
      spaceId="space-1"
      perspectiveUserId="user-1"
      onFocusCapabilityRow={focusRowMock}
      {...props}
    />,
  );
}

/**
 * The tree defaults to fully COLLAPSED (every folder closed at every depth).
 * Most tests operate on nested nodes, so this helper renders and then expands
 * ALL folders for convenience; the default-collapsed behavior + icon swap are
 * asserted in their own tests.
 */
async function renderEditor(
  props: Partial<React.ComponentProps<typeof ComposerWorkspaceEditor>> = {},
) {
  const view = renderRaw(props);
  try {
    // Wait until the default-collapse has settled (a COLLAPSED folder toggle
    // exists) before expanding — the collapse runs in an effect after the first
    // render, so expanding too early would be undone. Loading / error / empty
    // renders never produce a collapsed toggle and fall through the catch.
    await waitFor(
      () => {
        if (
          !document.querySelector(
            '[data-testid^="tree-toggle-"][aria-expanded="false"]',
          )
        ) {
          throw new Error("tree not collapsed yet");
        }
      },
      { timeout: 800 },
    );
  } catch {
    // loading / error / empty-tree render — nothing to expand.
  }
  // Expanding a folder reveals deeper (still-collapsed) folders, so iterate.
  for (let pass = 0; pass < 12; pass += 1) {
    const collapsed = Array.from(
      document.querySelectorAll(
        '[data-testid^="tree-toggle-"][aria-expanded="false"]',
      ),
    );
    if (collapsed.length === 0) break;
    collapsed.forEach((toggle) => fireEvent.click(toggle));
  }
  return view;
}

beforeEach(() => {
  vi.clearAllMocks();
  getManifestMock.mockResolvedValue(manifest());
  getFilePayloadMock.mockResolvedValue(filePayload());
  tenant.isOperator = true;
  tenant.roleResolved = true;
  putFileMock.mockResolvedValue(undefined);
  deleteFileMock.mockResolvedValue(undefined);
  renamePathMock.mockResolvedValue({ destPath: "" });
  movePathMock.mockResolvedValue({ destPath: "" });
  sourceGetFileMock.mockResolvedValue({
    content: "# source body",
    source: "agent",
    sha256: "",
  });
});

afterEach(() => cleanup());

describe("ComposerWorkspaceEditor rendering", () => {
  it("renders skill, space, user, and generated nodes from the manifest", async () => {
    await renderEditor();
    expect(
      await screen.findByTestId("tree-node-skills/approve-receipt"),
    ).toBeTruthy();
    expect(
      screen.getByTestId("tree-file-skills/approve-receipt/SKILL.md"),
    ).toBeTruthy();
    expect(
      screen.getByTestId("tree-node-Spaces/customer-success"),
    ).toBeTruthy();
    expect(screen.getByTestId("tree-file-User/USER.md")).toBeTruthy();
    expect(screen.getByTestId("tree-generated-AGENTS.md")).toBeTruthy();
    expect(
      screen.getByTestId("tree-generated-Spaces/customer-success/CONTEXT.md"),
    ).toBeTruthy();
    expect(screen.queryByTestId("tree-generated-CAPABILITIES.md")).toBeNull();
    // The editor-shell "N files" header counts the manifest entries.
    expect(screen.getByTestId("composer-files-header").textContent).toContain(
      "8 files",
    );
  });

  it("collapses and expands folders", async () => {
    await renderEditor();
    await screen.findByTestId("tree-file-skills/approve-receipt/SKILL.md");
    fireEvent.click(screen.getByTestId("tree-toggle-skills"));
    expect(
      screen.queryByTestId("tree-file-skills/approve-receipt/SKILL.md"),
    ).toBeNull();
    fireEvent.click(screen.getByTestId("tree-toggle-skills"));
    expect(
      screen.getByTestId("tree-file-skills/approve-receipt/SKILL.md"),
    ).toBeTruthy();
  });

  it("defaults to fully COLLAPSED at every depth (root folders closed, root files visible)", async () => {
    renderRaw();
    // Root folders render collapsed (the collapse settles in a mount effect).
    await waitFor(() =>
      expect(
        screen.getByTestId("tree-toggle-skills").getAttribute("aria-expanded"),
      ).toBe("false"),
    );
    const skillsToggle = screen.getByTestId("tree-toggle-skills");
    expect(screen.getByTestId("tree-file-AGENTS.md")).toBeTruthy();
    // Nested content is hidden until its ancestors are opened.
    expect(
      screen.queryByTestId("tree-file-skills/approve-receipt/SKILL.md"),
    ).toBeNull();
    // Expanding a root reveals its immediate children — themselves collapsed.
    fireEvent.click(skillsToggle);
    const slugToggle = screen.getByTestId("tree-toggle-skills/approve-receipt");
    expect(slugToggle.getAttribute("aria-expanded")).toBe("false");
    expect(
      screen.queryByTestId("tree-file-skills/approve-receipt/SKILL.md"),
    ).toBeNull();
  });

  it("swaps the folder icon to the open glyph when a folder is expanded", async () => {
    renderRaw();
    await waitFor(() =>
      expect(
        screen.getByTestId("tree-toggle-skills").getAttribute("aria-expanded"),
      ).toBe("false"),
    );
    // Collapsed → no open-folder glyph.
    expect(screen.queryByTestId("tree-folder-open-skills")).toBeNull();
    fireEvent.click(screen.getByTestId("tree-toggle-skills"));
    // Expanded → open-folder glyph present.
    expect(screen.getByTestId("tree-folder-open-skills")).toBeTruthy();
  });

  it("reloads the manifest when the selection changes", async () => {
    const view = await renderEditor();
    await screen.findByTestId("tree-node-skills/approve-receipt");
    expect(getManifestMock).toHaveBeenCalledTimes(1);
    view.rerender(
      <ComposerWorkspaceEditor
        tenantId="tenant-1"
        spaceId="space-2"
        perspectiveUserId={null}
        onFocusCapabilityRow={focusRowMock}
      />,
    );
    await waitFor(() => expect(getManifestMock).toHaveBeenCalledTimes(2));
  });

  it("bumping refreshToken reloads the manifest", async () => {
    const view = await renderEditor({ refreshToken: 0 });
    await screen.findByTestId("tree-node-skills/approve-receipt");
    expect(getManifestMock).toHaveBeenCalledTimes(1);
    view.rerender(
      <ComposerWorkspaceEditor
        tenantId="tenant-1"
        spaceId="space-1"
        perspectiveUserId="user-1"
        refreshToken={1}
        onFocusCapabilityRow={focusRowMock}
      />,
    );
    await waitFor(() => expect(getManifestMock).toHaveBeenCalledTimes(2));
  });
});

describe("skill-folder decoration (item 3)", () => {
  it("dims gated skill folders and badges the verbatim reason; the badge opens the list", async () => {
    const skillStateBySlug = new Map<string, SkillNodeState>([
      ["approve-receipt", { active: false, reason: "trust_gate" }],
    ]);
    await renderEditor({ skillStateBySlug });
    const gate = await screen.findByTestId("tree-gate-skills/approve-receipt");
    expect(gate.textContent).toContain("trust_gate");
    // Dimmed row.
    expect(
      screen
        .getByTestId("tree-node-skills/approve-receipt")
        .className.includes("opacity-60"),
    ).toBe(true);
    fireEvent.click(gate);
    expect(focusRowMock).toHaveBeenCalledWith("skill", "approve-receipt");
  });

  it("renders the Spaces mount lowercase as a display alias (real path unchanged)", async () => {
    await renderEditor();
    const row = await screen.findByTestId("tree-node-Spaces");
    // Display-only: the label reads "spaces" while the node path stays "Spaces".
    expect(within(row).getByText("spaces")).toBeTruthy();
  });

  it("leaves active skill folders undecorated", async () => {
    const skillStateBySlug = new Map<string, SkillNodeState>([
      ["approve-receipt", { active: true, reason: null }],
    ]);
    await renderEditor({ skillStateBySlug });
    await screen.findByTestId("tree-node-skills/approve-receipt");
    expect(screen.queryByTestId("tree-gate-skills/approve-receipt")).toBeNull();
  });
});

describe("context-menu actions (item 4)", () => {
  it("offers Add skill on the skills folder and Detach skill on an install", async () => {
    await renderEditor({
      canManageSkills: true,
      onAddSkill: addSkillMock,
      onDetachSkill: detachSkillMock,
    });
    await screen.findByTestId("tree-node-skills");
    fireEvent.click(screen.getByTestId("menu-add-skill"));
    expect(addSkillMock).toHaveBeenCalled();
    fireEvent.click(screen.getByTestId("menu-detach-skill-approve-receipt"));
    expect(detachSkillMock).toHaveBeenCalledWith("approve-receipt");
  });

  it("withholds destructive actions when writes aren't allowed", async () => {
    await renderEditor({ canManageSkills: false });
    await screen.findByTestId("tree-node-skills");
    expect(screen.queryByTestId("menu-add-skill")).toBeNull();
    expect(
      screen.queryByTestId("menu-detach-skill-approve-receipt"),
    ).toBeNull();
  });

  it("offers Open source on non-skill nodes", async () => {
    await renderEditor();
    await screen.findByTestId("tree-node-Spaces/customer-success/notes.md");
    fireEvent.click(
      screen.getByTestId("menu-open-source-Spaces/customer-success/notes.md"),
    );
    expect(navigateMock).toHaveBeenCalledWith({
      to: "/settings/spaces/$spaceId",
      params: { spaceId: "space-1" },
      search: { view: "workspace", file: "notes.md" },
    });
  });
});

describe("standard file-tree menu (v1.1)", () => {
  it("creates a new file inside a folder through the owning source client, then refetches", async () => {
    await renderEditor();
    await screen.findByTestId("tree-node-skills/approve-receipt");
    fireEvent.click(screen.getByTestId("menu-new-file-skills/approve-receipt"));
    fireEvent.change(await screen.findByTestId("composer-name-input"), {
      target: { value: "NOTES.md" },
    });
    getManifestMock.mockClear();
    fireEvent.click(screen.getByTestId("composer-name-submit"));
    await waitFor(() =>
      expect(putFileMock).toHaveBeenCalledWith(
        { agentId: "agent-1" },
        "skills/approve-receipt/NOTES.md",
        "",
      ),
    );
    await waitFor(() => expect(getManifestMock).toHaveBeenCalled());
  });

  it("creates a ROOT-level folder via the tree background menu (agent workspace root)", async () => {
    await renderEditor();
    await screen.findByTestId("composer-tree-scroll");
    fireEvent.click(screen.getByTestId("menu-root-new-folder"));
    fireEvent.change(await screen.findByTestId("composer-name-input"), {
      target: { value: "playbooks" },
    });
    getManifestMock.mockClear();
    fireEvent.click(screen.getByTestId("composer-name-submit"));
    await waitFor(() =>
      expect(putFileMock).toHaveBeenCalledWith(
        { agentId: "agent-1" },
        "playbooks/.gitkeep",
        "",
      ),
    );
    await waitFor(() => expect(getManifestMock).toHaveBeenCalled());
  });

  it("hides the tree-background create menu for non-operators", async () => {
    tenant.isOperator = false;
    await renderEditor();
    await screen.findByTestId("composer-tree-scroll");
    expect(screen.queryByTestId("menu-root-new-folder")).toBeNull();
  });

  it("renames a source file through renamePath (relative to its layer)", async () => {
    await renderEditor();
    await screen.findByTestId("tree-node-CAPABILITIES.md");
    fireEvent.click(screen.getByTestId("menu-rename-CAPABILITIES.md"));
    fireEvent.change(await screen.findByTestId("composer-name-input"), {
      target: { value: "CAPS.md" },
    });
    fireEvent.click(screen.getByTestId("composer-name-submit"));
    await waitFor(() =>
      expect(renamePathMock).toHaveBeenCalledWith(
        { agentId: "agent-1" },
        "CAPABILITIES.md",
        "CAPS.md",
      ),
    );
  });

  it("deletes a Space source file through the space client (prefix stripped)", async () => {
    await renderEditor();
    await screen.findByTestId("tree-node-Spaces/customer-success/notes.md");
    fireEvent.click(
      screen.getByTestId("menu-delete-Spaces/customer-success/notes.md"),
    );
    fireEvent.click(await screen.findByTestId("composer-delete-confirm"));
    await waitFor(() =>
      expect(deleteFileMock).toHaveBeenCalledWith(
        { spaceId: "space-1" },
        "notes.md",
      ),
    );
  });

  it("offers NO standard ops on a generated file (derived)", async () => {
    await renderEditor();
    await screen.findByTestId("tree-node-AGENTS.md");
    expect(screen.queryByTestId("menu-rename-AGENTS.md")).toBeNull();
    expect(screen.queryByTestId("menu-delete-AGENTS.md")).toBeNull();
  });

  it("maps a skill folder's destructive action to Detach, not raw Delete", async () => {
    await renderEditor({
      canManageSkills: true,
      onDetachSkill: detachSkillMock,
    });
    await screen.findByTestId("tree-node-skills/approve-receipt");
    // No raw Delete on the skill folder — Detach is the destructive path.
    expect(
      screen.queryByTestId("menu-delete-skills/approve-receipt"),
    ).toBeNull();
    expect(
      screen.getByTestId("menu-detach-skill-approve-receipt"),
    ).toBeTruthy();
  });

  it("hides standard ops for non-operators", async () => {
    tenant.isOperator = false;
    await renderEditor();
    await screen.findByTestId("tree-node-CAPABILITIES.md");
    expect(screen.queryByTestId("menu-rename-CAPABILITIES.md")).toBeNull();
    expect(screen.queryByTestId("menu-delete-CAPABILITIES.md")).toBeNull();
  });
});

describe("MCP server tree affordances (U9c)", () => {
  it("offers Add MCP server on the mcp root and Detach on an mcp/<slug> folder", async () => {
    await renderEditor({
      canManageSkills: true,
      onAddMcpServer: addMcpMock,
      onDetachMcpServer: detachMcpMock,
    });
    await screen.findByTestId("tree-node-mcp");
    fireEvent.click(screen.getByTestId("menu-add-mcp-server"));
    expect(addMcpMock).toHaveBeenCalled();
    fireEvent.click(screen.getByTestId("menu-detach-mcp-github"));
    expect(detachMcpMock).toHaveBeenCalledWith("github");
  });

  it("withholds MCP affordances when writes aren't allowed", async () => {
    await renderEditor({
      canManageSkills: false,
      onAddMcpServer: addMcpMock,
      onDetachMcpServer: detachMcpMock,
    });
    await screen.findByTestId("tree-node-mcp");
    expect(screen.queryByTestId("menu-add-mcp-server")).toBeNull();
    expect(screen.queryByTestId("menu-detach-mcp-github")).toBeNull();
  });

  it("maps an mcp/<slug> folder's destructive action to Detach, not raw Delete/Rename", async () => {
    await renderEditor({
      canManageSkills: true,
      onDetachMcpServer: detachMcpMock,
    });
    await screen.findByTestId("tree-node-mcp/github");
    expect(screen.queryByTestId("menu-delete-mcp/github")).toBeNull();
    expect(screen.queryByTestId("menu-rename-mcp/github")).toBeNull();
    expect(screen.getByTestId("menu-detach-mcp-github")).toBeTruthy();
  });

  it("dims gated mcp folders with the verbatim reason; the badge focuses the mcp_server row", async () => {
    const mcpStateBySlug = new Map<string, SkillNodeState>([
      ["github", { active: false, reason: "oauth_missing" }],
      ["gmail", { active: true, reason: null }],
    ]);
    await renderEditor({ mcpStateBySlug });
    const gate = await screen.findByTestId("tree-gate-mcp/github");
    expect(gate.textContent).toContain("oauth_missing");
    expect(
      screen
        .getByTestId("tree-node-mcp/github")
        .className.includes("opacity-60"),
    ).toBe(true);
    // Active server folders stay undecorated.
    expect(screen.queryByTestId("tree-gate-mcp/gmail")).toBeNull();
    fireEvent.click(gate);
    expect(focusRowMock).toHaveBeenCalledWith("mcp_server", "github");
  });

  it("renders a ghost mcp folder while an attach materializes", async () => {
    await renderEditor({ pendingMcpSlug: "slack" });
    expect(await screen.findByTestId("tree-node-mcp/slack")).toBeTruthy();
    expect(screen.getByTestId("tree-pending-mcp/slack").textContent).toContain(
      "syncing",
    );
  });

  it("marks an mcp folder removing while a detach is in flight", async () => {
    await renderEditor({ removingMcpSlug: "github" });
    expect(
      (await screen.findByTestId("tree-removing-mcp/github")).textContent,
    ).toContain("removing");
  });

  it("the .assignment.json opens as a normal agent-source file", async () => {
    await renderEditor();
    await screen.findByTestId("tree-file-mcp/github/.assignment.json");
    fireEvent.click(
      screen.getByTestId("tree-file-mcp/github/.assignment.json"),
    );
    await waitFor(() =>
      expect(sourceGetFileMock).toHaveBeenCalledWith(
        { agentId: "agent-1" },
        "mcp/github/.assignment.json",
      ),
    );
    expect(screen.getByTestId("composer-editable-pane")).toBeTruthy();
  });
});

describe("user mount is fully editable (everything editable)", () => {
  it("loads a user-owned file through the { userId } source client", async () => {
    await renderEditor();
    await screen.findByTestId("tree-file-User/USER.md");
    fireEvent.click(screen.getByTestId("tree-file-User/USER.md"));
    await waitFor(() =>
      expect(sourceGetFileMock).toHaveBeenCalledWith(
        { userId: "user-1" },
        "USER.md",
      ),
    );
    expect(screen.getByTestId("composer-editable-pane")).toBeTruthy();
  });

  it("saves a user-owned file through the { userId } client, then refetches", async () => {
    await renderEditor();
    await screen.findByTestId("tree-file-User/USER.md");
    fireEvent.click(screen.getByTestId("tree-file-User/USER.md"));
    await screen.findByTestId("composer-editable-pane");
    getManifestMock.mockClear();
    fireEvent.change(screen.getByTestId("cm-input"), {
      target: { value: "# edited user profile" },
    });
    fireEvent.click(screen.getByTestId("cm-save"));
    await waitFor(() =>
      expect(putFileMock).toHaveBeenCalledWith(
        { userId: "user-1" },
        "USER.md",
        "# edited user profile",
      ),
    );
    await waitFor(() => expect(getManifestMock).toHaveBeenCalled());
  });

  it("renames and deletes user files through the { userId } client", async () => {
    await renderEditor();
    await screen.findByTestId("tree-node-User/USER.md");
    fireEvent.click(screen.getByTestId("menu-rename-User/USER.md"));
    fireEvent.change(await screen.findByTestId("composer-name-input"), {
      target: { value: "PROFILE.md" },
    });
    fireEvent.click(screen.getByTestId("composer-name-submit"));
    await waitFor(() =>
      expect(renamePathMock).toHaveBeenCalledWith(
        { userId: "user-1" },
        "USER.md",
        "PROFILE.md",
      ),
    );
    fireEvent.click(screen.getByTestId("menu-delete-User/USER.md"));
    fireEvent.click(await screen.findByTestId("composer-delete-confirm"));
    await waitFor(() =>
      expect(deleteFileMock).toHaveBeenCalledWith(
        { userId: "user-1" },
        "USER.md",
      ),
    );
  });

  it("creates a new folder inside the user mount through the { userId } client", async () => {
    await renderEditor();
    await screen.findByTestId("tree-node-User");
    fireEvent.click(screen.getByTestId("menu-new-folder-User"));
    fireEvent.change(await screen.findByTestId("composer-name-input"), {
      target: { value: "packs" },
    });
    fireEvent.click(screen.getByTestId("composer-name-submit"));
    await waitFor(() =>
      expect(putFileMock).toHaveBeenCalledWith(
        { userId: "user-1" },
        "packs/.gitkeep",
        "",
      ),
    );
  });

  it("renders the User mount lowercase as a display alias", async () => {
    await renderEditor();
    const row = await screen.findByTestId("tree-node-User");
    expect(within(row).getByText("user")).toBeTruthy();
  });
});

describe("jump-to-cause (KTD-5)", () => {
  it("maps entries to their owning surface", () => {
    expect(
      causeOf({
        path: "skills/renewal-prep/SKILL.md",
        owner: "agent",
        generated: false,
      }),
    ).toEqual({ kind: "skill", slug: "renewal-prep" });
    expect(
      causeOf({
        path: "Spaces/cs/CONTEXT.md",
        owner: "space",
        generated: true,
      }),
    ).toEqual({ kind: "space", file: "CONTEXT.md" });
    expect(
      causeOf({ path: "User/USER.md", owner: "user", generated: false }),
    ).toEqual({ kind: "user" });
    expect(
      causeOf({ path: "AGENTS.md", owner: "agent", generated: true }),
    ).toEqual({ kind: "agent_source", file: "AGENTS.md" });
    expect(
      causeOf({ path: "GOAL.md", owner: "thread_goal", generated: false }),
    ).toBeNull();
  });

  it("skill nodes have NO capability-sheet menu entry (gate badge handles focus)", async () => {
    await renderEditor();
    await screen.findByTestId("tree-node-skills/approve-receipt");
    // No "Open in capabilities" / open-source entry on skill nodes.
    expect(
      screen.queryByTestId("menu-open-source-skills/approve-receipt"),
    ).toBeNull();
  });

  it("generated agent files navigate to the agent workspace editor", async () => {
    await renderEditor();
    await screen.findByTestId("tree-node-AGENTS.md");
    fireEvent.click(screen.getByTestId("menu-open-source-AGENTS.md"));
    expect(navigateMock).toHaveBeenCalledWith({
      to: "/settings/agents",
      search: { view: "workspace", file: "AGENTS.md" },
    });
  });

  it("user nodes navigate to the perspective user's detail page", async () => {
    await renderEditor();
    await screen.findByTestId("tree-node-User/USER.md");
    fireEvent.click(screen.getByTestId("menu-open-source-User/USER.md"));
    expect(navigateMock).toHaveBeenCalledWith({
      to: "/settings/users/$userId",
      params: { userId: "user-1" },
    });
  });
});

describe("pending / removing affordances", () => {
  it("renders a ghost skill folder while an attach materializes", async () => {
    await renderEditor({ pendingSkillSlug: "expenses" });
    expect(await screen.findByTestId("tree-node-skills/expenses")).toBeTruthy();
    expect(
      screen.getByTestId("tree-pending-skills/expenses").textContent,
    ).toContain("syncing");
  });

  it("marks a skill folder removing while a detach is in flight", async () => {
    await renderEditor({ removingSkillSlug: "approve-receipt" });
    expect(
      (await screen.findByTestId("tree-removing-skills/approve-receipt"))
        .textContent,
    ).toContain("removing");
  });
});

describe("read-only fallback pane (no editable owning layer)", () => {
  const THREAD_MANIFEST = manifest({
    entries: [{ path: "GOAL.md", owner: "thread_goal", generated: false }],
  });

  it("loads a thread-scoped file read-only via the preview payload", async () => {
    getManifestMock.mockResolvedValue(THREAD_MANIFEST);
    getFilePayloadMock.mockResolvedValue(
      filePayload({
        content: "# goal",
        entry: { path: "GOAL.md", owner: "thread_goal", generated: false },
      }),
    );
    await renderEditor();
    await screen.findByTestId("tree-file-GOAL.md");
    fireEvent.click(screen.getByTestId("tree-file-GOAL.md"));
    await waitFor(() =>
      expect(getFilePayloadMock).toHaveBeenCalledWith("GOAL.md"),
    );
    const viewer = await screen.findByTestId("composer-file-viewer");
    expect(
      within(viewer).getByTestId("cm-pane").getAttribute("data-readonly"),
    ).toBe("true");
    fireEvent.click(within(viewer).getByTestId("composer-file-close"));
    expect(screen.getByTestId("composer-empty-pane")).toBeTruthy();
  });

  it("renders payload error states in the fallback pane", async () => {
    getManifestMock.mockResolvedValue(THREAD_MANIFEST);
    getFilePayloadMock.mockResolvedValue(
      filePayload({
        state: "not_found",
        stateDetail: "source object no longer exists",
        content: null,
      }),
    );
    await renderEditor();
    await screen.findByTestId("tree-file-GOAL.md");
    fireEvent.click(screen.getByTestId("tree-file-GOAL.md"));
    expect(
      (await screen.findByTestId("composer-file-error")).textContent,
    ).toContain("source object no longer exists");
  });
});

describe("live-editable source pane (v1.1)", () => {
  it("edits a non-generated source file and saves through the owning client, then refetches the preview", async () => {
    await renderEditor();
    await screen.findByTestId("tree-file-skills/approve-receipt/SKILL.md");
    fireEvent.click(
      screen.getByTestId("tree-file-skills/approve-receipt/SKILL.md"),
    );
    // Loads via the SOURCE client (not the preview payload), editable.
    await waitFor(() =>
      expect(sourceGetFileMock).toHaveBeenCalledWith(
        { agentId: "agent-1" },
        "skills/approve-receipt/SKILL.md",
      ),
    );
    const pane = await screen.findByTestId("composer-editable-pane");
    expect(pane).toBeTruthy();
    expect(screen.getByTestId("cm-pane").getAttribute("data-readonly")).toBe(
      "false",
    );
    // getFilePayload (the read-only preview path) is NOT used for source files.
    expect(getFilePayloadMock).not.toHaveBeenCalled();
    getManifestMock.mockClear();
    fireEvent.change(screen.getByTestId("cm-input"), {
      target: { value: "# edited skill" },
    });
    fireEvent.click(screen.getByTestId("cm-save"));
    await waitFor(() =>
      expect(putFileMock).toHaveBeenCalledWith(
        { agentId: "agent-1" },
        "skills/approve-receipt/SKILL.md",
        "# edited skill",
      ),
    );
    // Save refetches the preview so the tree/content stay truthful.
    await waitFor(() => expect(getManifestMock).toHaveBeenCalled());
  });

  it("edits a Space source file through the space client (mount prefix stripped)", async () => {
    await renderEditor();
    await screen.findByTestId("tree-file-Spaces/customer-success/notes.md");
    fireEvent.click(
      screen.getByTestId("tree-file-Spaces/customer-success/notes.md"),
    );
    await waitFor(() =>
      expect(sourceGetFileMock).toHaveBeenCalledWith(
        { spaceId: "space-1" },
        "notes.md",
      ),
    );
  });

  it("keeps a non-operator on a read-only source pane", async () => {
    tenant.isOperator = false;
    await renderEditor();
    await screen.findByTestId("tree-file-CAPABILITIES.md");
    fireEvent.click(screen.getByTestId("tree-file-CAPABILITIES.md"));
    await screen.findByTestId("composer-editable-pane");
    expect(screen.getByTestId("cm-pane").getAttribute("data-readonly")).toBe(
      "true",
    );
  });

  it("surfaces a source load error in the editable pane", async () => {
    sourceGetFileMock.mockRejectedValue(new Error("s3 unavailable"));
    await renderEditor();
    await screen.findByTestId("tree-file-CAPABILITIES.md");
    fireEvent.click(screen.getByTestId("tree-file-CAPABILITIES.md"));
    expect(
      (await screen.findByTestId("composer-file-error")).textContent,
    ).toContain("s3 unavailable");
  });
});

describe("generated files (single full-width source editor)", () => {
  it("opens a generated agent file as ONE source editor with the generated badge (no split, no rendered pane)", async () => {
    await renderEditor();
    await screen.findByTestId("tree-file-AGENTS.md");
    fireEvent.click(screen.getByTestId("tree-file-AGENTS.md"));
    const pane = await screen.findByTestId("composer-editable-pane");
    // One editor only — no split, no read-only rendered pane.
    expect(screen.queryByTestId("composer-split-view")).toBeNull();
    expect(screen.queryByTestId("composer-file-viewer")).toBeNull();
    // The generated badge is kept in the header.
    expect(within(pane).getByText("generated")).toBeTruthy();
    // Edits the producing SOURCE file, editable for operators.
    await waitFor(() =>
      expect(sourceGetFileMock).toHaveBeenCalledWith(
        { agentId: "agent-1" },
        "AGENTS.md",
      ),
    );
    expect(
      within(pane).getByTestId("cm-pane").getAttribute("data-readonly"),
    ).toBe("false");
    // The read-only preview payload path is not used for generated files.
    expect(getFilePayloadMock).not.toHaveBeenCalled();
  });

  it("opens a generated space file as one editor on the space source (prefix stripped)", async () => {
    await renderEditor();
    await screen.findByTestId("tree-file-Spaces/customer-success/CONTEXT.md");
    fireEvent.click(
      screen.getByTestId("tree-file-Spaces/customer-success/CONTEXT.md"),
    );
    await screen.findByTestId("composer-editable-pane");
    await waitFor(() =>
      expect(sourceGetFileMock).toHaveBeenCalledWith(
        { spaceId: "space-1" },
        "CONTEXT.md",
      ),
    );
  });

  it("saving a generated file's prose writes the source and refetches the preview", async () => {
    await renderEditor();
    await screen.findByTestId("tree-file-AGENTS.md");
    fireEvent.click(screen.getByTestId("tree-file-AGENTS.md"));
    const pane = await screen.findByTestId("composer-editable-pane");
    await waitFor(() => expect(sourceGetFileMock).toHaveBeenCalled());
    getManifestMock.mockClear();
    fireEvent.change(within(pane).getByTestId("cm-input"), {
      target: { value: "# edited template" },
    });
    fireEvent.click(within(pane).getByTestId("cm-save"));
    await waitFor(() =>
      expect(putFileMock).toHaveBeenCalledWith(
        { agentId: "agent-1" },
        "AGENTS.md",
        "# edited template",
      ),
    );
    await waitFor(() => expect(getManifestMock).toHaveBeenCalled());
  });

  it("gates editing to operators: a non-operator gets a read-only editor", async () => {
    tenant.isOperator = false;
    await renderEditor();
    await screen.findByTestId("tree-file-AGENTS.md");
    fireEvent.click(screen.getByTestId("tree-file-AGENTS.md"));
    const pane = await screen.findByTestId("composer-editable-pane");
    expect(
      within(pane).getByTestId("cm-pane").getAttribute("data-readonly"),
    ).toBe("true");
  });

  it("opens non-generated files as one editor too (no split)", async () => {
    await renderEditor();
    await screen.findByTestId("tree-file-CAPABILITIES.md");
    fireEvent.click(screen.getByTestId("tree-file-CAPABILITIES.md"));
    await screen.findByTestId("composer-editable-pane");
    expect(screen.queryByTestId("composer-split-view")).toBeNull();
    expect(screen.queryByTestId("composer-file-viewer")).toBeNull();
  });
});

describe("loading and error states", () => {
  it("shows skeletons while the manifest loads", async () => {
    getManifestMock.mockReturnValue(new Promise(() => {}));
    await renderEditor();
    expect(screen.getByTestId("preview-loading")).toBeTruthy();
  });

  it("renders invalid_selection with the backend detail", async () => {
    getManifestMock.mockResolvedValue(
      manifest({
        state: "invalid_selection",
        stateDetail: "space not found in tenant",
        entries: [],
      }),
    );
    await renderEditor();
    expect(
      (await screen.findByTestId("preview-invalid-selection")).textContent,
    ).toContain("space not found in tenant");
  });

  it("renders resolution_fault distinctly", async () => {
    getManifestMock.mockResolvedValue(
      manifest({
        state: "resolution_fault",
        stateDetail: "compose failed",
        entries: [],
      }),
    );
    await renderEditor();
    expect(
      (await screen.findByTestId("preview-resolution-fault")).textContent,
    ).toContain("compose failed");
  });

  it("renders transport errors", async () => {
    getManifestMock.mockRejectedValue(new Error("network sad"));
    await renderEditor();
    expect((await screen.findByTestId("preview-error")).textContent).toContain(
      "network sad",
    );
  });
});
