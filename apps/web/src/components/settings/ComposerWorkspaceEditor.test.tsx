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
  focusRowMock,
  addSkillMock,
  detachSkillMock,
} = vi.hoisted(() => ({
  getManifestMock: vi.fn(),
  getFilePayloadMock: vi.fn(),
  navigateMock: vi.fn(),
  editorSpy: vi.fn(),
  tenant: { isOperator: true, roleResolved: true },
  putFileMock: vi.fn(),
  sourceGetFileMock: vi.fn(),
  focusRowMock: vi.fn(),
  addSkillMock: vi.fn(),
  detachSkillMock: vi.fn(),
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
    onChange?: (value: string) => void;
    onSave?: () => void;
  }) => (
    <div
      data-testid="cm-pane"
      data-readonly={props.readOnly ? "true" : "false"}
    >
      <textarea
        data-testid="cm-input"
        value={props.value}
        readOnly={props.readOnly}
        onChange={(event) => props.onChange?.(event.target.value)}
      />
      <button type="button" data-testid="cm-save" onClick={props.onSave}>
        save
      </button>
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
    deleteFile: vi.fn().mockResolvedValue(undefined),
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

function renderEditor(
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

beforeEach(() => {
  vi.clearAllMocks();
  getManifestMock.mockResolvedValue(manifest());
  getFilePayloadMock.mockResolvedValue(filePayload());
  tenant.isOperator = true;
  tenant.roleResolved = true;
  putFileMock.mockResolvedValue(undefined);
  sourceGetFileMock.mockResolvedValue({
    content: "# source body",
    source: "agent",
    sha256: "",
  });
});

afterEach(() => cleanup());

describe("ComposerWorkspaceEditor rendering", () => {
  it("renders skill, space, user, and generated nodes from the manifest", async () => {
    renderEditor();
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
      "6 files",
    );
  });

  it("collapses and expands folders", async () => {
    renderEditor();
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

  it("reloads the manifest when the selection changes", async () => {
    const view = renderEditor();
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
    const view = renderEditor({ refreshToken: 0 });
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
    renderEditor({ skillStateBySlug });
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

  it("leaves active skill folders undecorated", async () => {
    const skillStateBySlug = new Map<string, SkillNodeState>([
      ["approve-receipt", { active: true, reason: null }],
    ]);
    renderEditor({ skillStateBySlug });
    await screen.findByTestId("tree-node-skills/approve-receipt");
    expect(screen.queryByTestId("tree-gate-skills/approve-receipt")).toBeNull();
  });
});

describe("context-menu actions (item 4)", () => {
  it("offers Add skill on the skills folder and Detach skill on an install", async () => {
    renderEditor({
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
    renderEditor({ canManageSkills: false });
    await screen.findByTestId("tree-node-skills");
    expect(screen.queryByTestId("menu-add-skill")).toBeNull();
    expect(
      screen.queryByTestId("menu-detach-skill-approve-receipt"),
    ).toBeNull();
  });

  it("offers Open source on non-skill nodes", async () => {
    renderEditor();
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

  it("skill nodes focus their capability row via the menu", async () => {
    renderEditor();
    await screen.findByTestId("tree-node-skills/approve-receipt");
    fireEvent.click(
      screen.getByTestId("menu-open-source-skills/approve-receipt"),
    );
    expect(focusRowMock).toHaveBeenCalledWith("skill", "approve-receipt");
    expect(navigateMock).not.toHaveBeenCalled();
  });

  it("generated agent files navigate to the agent workspace editor", async () => {
    renderEditor();
    await screen.findByTestId("tree-node-AGENTS.md");
    fireEvent.click(screen.getByTestId("menu-open-source-AGENTS.md"));
    expect(navigateMock).toHaveBeenCalledWith({
      to: "/settings/agents",
      search: { view: "workspace", file: "AGENTS.md" },
    });
  });

  it("user nodes navigate to the perspective user's detail page", async () => {
    renderEditor();
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
    renderEditor({ pendingSkillSlug: "expenses" });
    expect(await screen.findByTestId("tree-node-skills/expenses")).toBeTruthy();
    expect(
      screen.getByTestId("tree-pending-skills/expenses").textContent,
    ).toContain("syncing");
  });

  it("marks a skill folder removing while a detach is in flight", async () => {
    renderEditor({ removingSkillSlug: "approve-receipt" });
    expect(
      (await screen.findByTestId("tree-removing-skills/approve-receipt"))
        .textContent,
    ).toContain("removing");
  });
});

describe("read-only rendered pane", () => {
  it("loads content lazily and renders it in a read-only CodeMirror pane", async () => {
    renderEditor();
    await screen.findByTestId("tree-file-AGENTS.md");
    expect(getFilePayloadMock).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId("tree-file-AGENTS.md"));
    await waitFor(() =>
      expect(getFilePayloadMock).toHaveBeenCalledWith("AGENTS.md"),
    );
    // AGENTS.md is generated → split view; the rendered (left) pane is read-only.
    const viewer = await screen.findByTestId("composer-file-viewer");
    const pane = within(viewer).getByTestId("cm-pane");
    expect(pane.textContent).toContain("# Rendered body");
    expect(pane.getAttribute("data-readonly")).toBe("true");
    // Close returns to the empty pane.
    fireEvent.click(within(viewer).getByTestId("composer-file-close"));
    expect(screen.getByTestId("composer-empty-pane")).toBeTruthy();
  });

  it("renders viewer error states from a generated file's payload state", async () => {
    getFilePayloadMock.mockResolvedValue(
      filePayload({
        state: "not_found",
        stateDetail: "source object no longer exists",
        content: null,
      }),
    );
    renderEditor();
    await screen.findByTestId("tree-file-AGENTS.md");
    fireEvent.click(screen.getByTestId("tree-file-AGENTS.md"));
    expect(
      (await screen.findByTestId("composer-file-error")).textContent,
    ).toContain("source object no longer exists");
  });
});

describe("live-editable source pane (v1.1)", () => {
  it("edits a non-generated source file and saves through the owning client, then refetches the preview", async () => {
    renderEditor();
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
    renderEditor();
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
    renderEditor();
    await screen.findByTestId("tree-file-CAPABILITIES.md");
    fireEvent.click(screen.getByTestId("tree-file-CAPABILITIES.md"));
    await screen.findByTestId("composer-editable-pane");
    expect(screen.getByTestId("cm-pane").getAttribute("data-readonly")).toBe(
      "true",
    );
  });

  it("surfaces a source load error in the editable pane", async () => {
    sourceGetFileMock.mockRejectedValue(new Error("s3 unavailable"));
    renderEditor();
    await screen.findByTestId("tree-file-CAPABILITIES.md");
    fireEvent.click(screen.getByTestId("tree-file-CAPABILITIES.md"));
    expect(
      (await screen.findByTestId("composer-file-error")).textContent,
    ).toContain("s3 unavailable");
  });
});

describe("split-view template editor (U7)", () => {
  it("opens a generated agent file split: read-only rendered pane + single-file agent source editor (no nested tree)", async () => {
    renderEditor();
    await screen.findByTestId("tree-file-AGENTS.md");
    fireEvent.click(screen.getByTestId("tree-file-AGENTS.md"));
    expect(await screen.findByTestId("composer-split-view")).toBeTruthy();
    // Left: read-only rendered pane. Right: single-file editable source pane.
    expect(screen.getByTestId("composer-file-viewer")).toBeTruthy();
    const sourcePane = screen.getByTestId("composer-editable-pane");
    expect(sourcePane).toBeTruthy();
    // The source editor is a plain single-file editor — no embedded file tree.
    expect(screen.queryByTestId("mock-editor")).toBeNull();
    await waitFor(() =>
      expect(sourceGetFileMock).toHaveBeenCalledWith(
        { agentId: "agent-1" },
        "AGENTS.md",
      ),
    );
    expect(
      within(sourcePane).getByTestId("cm-pane").getAttribute("data-readonly"),
    ).toBe("false");
  });

  it("opens a generated space file split with the space layer source (prefix stripped)", async () => {
    getFilePayloadMock.mockResolvedValue(
      filePayload({
        entry: {
          path: "Spaces/customer-success/CONTEXT.md",
          owner: "space",
          generated: true,
          size: 900,
        },
      }),
    );
    renderEditor();
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

  it("opens non-generated files single-pane in the live editor (no split)", async () => {
    renderEditor();
    await screen.findByTestId("tree-file-CAPABILITIES.md");
    fireEvent.click(screen.getByTestId("tree-file-CAPABILITIES.md"));
    await screen.findByTestId("composer-editable-pane");
    expect(screen.queryByTestId("composer-split-view")).toBeNull();
    expect(screen.queryByTestId("mock-editor")).toBeNull();
  });

  it("refetches the preview after the split source is saved", async () => {
    renderEditor();
    await screen.findByTestId("tree-file-AGENTS.md");
    fireEvent.click(screen.getByTestId("tree-file-AGENTS.md"));
    const sourcePane = await screen.findByTestId("composer-editable-pane");
    await waitFor(() => expect(sourceGetFileMock).toHaveBeenCalled());
    getManifestMock.mockClear();
    fireEvent.change(within(sourcePane).getByTestId("cm-input"), {
      target: { value: "# edited template" },
    });
    fireEvent.click(within(sourcePane).getByTestId("cm-save"));
    await waitFor(() =>
      expect(putFileMock).toHaveBeenCalledWith(
        { agentId: "agent-1" },
        "AGENTS.md",
        "# edited template",
      ),
    );
    await waitFor(() => expect(getManifestMock).toHaveBeenCalled());
  });

  it("gates editing to operators: a non-operator gets a read-only split source pane", async () => {
    tenant.isOperator = false;
    renderEditor();
    await screen.findByTestId("tree-file-AGENTS.md");
    fireEvent.click(screen.getByTestId("tree-file-AGENTS.md"));
    const sourcePane = await screen.findByTestId("composer-editable-pane");
    expect(
      within(sourcePane).getByTestId("cm-pane").getAttribute("data-readonly"),
    ).toBe("true");
  });

  it("keeps the source pane when the rendered pane errors", async () => {
    getFilePayloadMock.mockResolvedValue(
      filePayload({ state: "resolution_fault", stateDetail: "compose failed" }),
    );
    renderEditor();
    await screen.findByTestId("tree-file-AGENTS.md");
    fireEvent.click(screen.getByTestId("tree-file-AGENTS.md"));
    // The rendered (left) pane shows its error; the source (right) editor stays.
    expect(
      await within(screen.getByTestId("composer-file-viewer")).findByTestId(
        "composer-file-error",
      ),
    ).toBeTruthy();
    expect(screen.getByTestId("composer-editable-pane")).toBeTruthy();
  });
});

describe("loading and error states", () => {
  it("shows skeletons while the manifest loads", () => {
    getManifestMock.mockReturnValue(new Promise(() => {}));
    renderEditor();
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
    renderEditor();
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
    renderEditor();
    expect(
      (await screen.findByTestId("preview-resolution-fault")).textContent,
    ).toContain("compose failed");
  });

  it("renders transport errors", async () => {
    getManifestMock.mockRejectedValue(new Error("network sad"));
    renderEditor();
    expect((await screen.findByTestId("preview-error")).textContent).toContain(
      "network sad",
    );
  });
});
