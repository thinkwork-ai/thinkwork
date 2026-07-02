/**
 * Composer result tree tests (Composer plan U2).
 *
 * The tree is a READ-ONLY preview backed by `workspacePreview` /
 * `workspacePreviewFile`; every node resolves jump-to-cause client-side
 * from `{owner, path, generated}` (KTD-5). The preview is profile-invariant
 * — no agentProfileId variable exists on either query by construction.
 */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  queryState,
  previewRefetchMock,
  fileRefetchMock,
  navigateMock,
  queryDocs,
  useQueryCalls,
  editorSpy,
  tenant,
  putFileMock,
} = vi.hoisted(() => ({
  queryState: {
    preview: {
      data: undefined as unknown,
      fetching: false,
      error: undefined as { message: string } | undefined,
    },
    file: {
      data: undefined as unknown,
      fetching: false,
      error: undefined as { message: string } | undefined,
    },
  },
  previewRefetchMock: vi.fn(),
  fileRefetchMock: vi.fn(),
  navigateMock: vi.fn(),
  queryDocs: {
    SettingsWorkspacePreviewQuery: Symbol("workspacePreview"),
    SettingsWorkspacePreviewFileQuery: Symbol("workspacePreviewFile"),
  },
  useQueryCalls: [] as Array<{
    query: unknown;
    variables: Record<string, unknown>;
    pause?: boolean;
  }>,
  editorSpy: vi.fn(),
  tenant: { isOperator: true, roleResolved: true },
  putFileMock: vi.fn(),
}));

vi.mock("urql", () => ({
  useQuery: (args: {
    query: unknown;
    variables: Record<string, unknown>;
    pause?: boolean;
  }) => {
    useQueryCalls.push(args);
    if (args.query === queryDocs.SettingsWorkspacePreviewQuery) {
      return [queryState.preview, previewRefetchMock];
    }
    return [queryState.file, fileRefetchMock];
  },
}));

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => navigateMock,
}));

vi.mock("@/lib/settings-queries", () => queryDocs);

vi.mock("@thinkwork/workspace-editor", () => ({
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
    getFile: vi
      .fn()
      .mockResolvedValue({ content: "", source: "agent", sha256: "" }),
    putFile: (...args: unknown[]) => putFileMock(...args),
    deleteFile: vi.fn().mockResolvedValue(undefined),
  },
}));

import { ComposerWorkspaceTree, causeOf } from "./ComposerWorkspaceTree";

const FILES = [
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

function previewData(overrides: Record<string, unknown> = {}) {
  return {
    workspacePreview: {
      state: "ok",
      stateDetail: null,
      agentId: "agent-1",
      spaceId: "space-1",
      perspectiveUserId: "user-1",
      noUserBaseline: false,
      files: FILES,
      ...overrides,
    },
  };
}

function lastPreviewVariables() {
  const calls = useQueryCalls.filter(
    (call) => call.query === queryDocs.SettingsWorkspacePreviewQuery,
  );
  return calls[calls.length - 1]?.variables;
}

function lastFileCall() {
  const calls = useQueryCalls.filter(
    (call) => call.query === queryDocs.SettingsWorkspacePreviewFileQuery,
  );
  return calls[calls.length - 1];
}

const focusRowMock = vi.fn();

function renderTree(
  props: Partial<React.ComponentProps<typeof ComposerWorkspaceTree>> = {},
) {
  return render(
    <ComposerWorkspaceTree
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
  useQueryCalls.length = 0;
  queryState.preview = {
    data: previewData(),
    fetching: false,
    error: undefined,
  };
  queryState.file = { data: undefined, fetching: false, error: undefined };
  tenant.isOperator = true;
  tenant.roleResolved = true;
  putFileMock.mockResolvedValue(undefined);
});

afterEach(() => cleanup());

describe("ComposerWorkspaceTree rendering", () => {
  it("renders skill, space, user, and generated nodes from the preview tree", () => {
    renderTree();
    // Skill folder + its file.
    expect(screen.getByTestId("tree-node-skills/approve-receipt")).toBeTruthy();
    expect(
      screen.getByTestId("tree-file-skills/approve-receipt/SKILL.md"),
    ).toBeTruthy();
    // Space mount + user mount.
    expect(
      screen.getByTestId("tree-node-Spaces/customer-success"),
    ).toBeTruthy();
    expect(screen.getByTestId("tree-file-User/USER.md")).toBeTruthy();
    // Generated files carry the badge; source files don't.
    expect(screen.getByTestId("tree-generated-AGENTS.md")).toBeTruthy();
    expect(
      screen.getByTestId("tree-generated-Spaces/customer-success/CONTEXT.md"),
    ).toBeTruthy();
    expect(screen.queryByTestId("tree-generated-CAPABILITIES.md")).toBeNull();
  });

  it("collapses and expands folders", () => {
    renderTree();
    expect(
      screen.getByTestId("tree-file-skills/approve-receipt/SKILL.md"),
    ).toBeTruthy();
    fireEvent.click(screen.getByTestId("tree-toggle-skills"));
    expect(
      screen.queryByTestId("tree-file-skills/approve-receipt/SKILL.md"),
    ).toBeNull();
    fireEvent.click(screen.getByTestId("tree-toggle-skills"));
    expect(
      screen.getByTestId("tree-file-skills/approve-receipt/SKILL.md"),
    ).toBeTruthy();
  });

  it("refetches when the selection changes (query variables track the tokens)", () => {
    const view = renderTree();
    expect(lastPreviewVariables()).toMatchObject({
      tenantId: "tenant-1",
      spaceId: "space-1",
      perspectiveUserId: "user-1",
    });
    view.rerender(
      <ComposerWorkspaceTree
        tenantId="tenant-1"
        spaceId="space-2"
        perspectiveUserId={null}
        onFocusCapabilityRow={focusRowMock}
      />,
    );
    expect(lastPreviewVariables()).toMatchObject({
      spaceId: "space-2",
      perspectiveUserId: null,
    });
  });

  it("is profile-invariant: no agentProfileId variable exists on the preview queries (R4)", () => {
    renderTree();
    expect(Object.keys(lastPreviewVariables() ?? {})).toEqual([
      "tenantId",
      "agentId",
      "spaceId",
      "perspectiveUserId",
    ]);
  });

  it("bumping refreshToken refetches the preview network-only", () => {
    const view = renderTree({ refreshToken: 0 });
    expect(previewRefetchMock).not.toHaveBeenCalled();
    view.rerender(
      <ComposerWorkspaceTree
        tenantId="tenant-1"
        spaceId="space-1"
        perspectiveUserId="user-1"
        refreshToken={1}
        onFocusCapabilityRow={focusRowMock}
      />,
    );
    expect(previewRefetchMock).toHaveBeenCalledWith({
      requestPolicy: "network-only",
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

  it("skill nodes focus their attach/detach row in-page", () => {
    renderTree();
    fireEvent.click(screen.getByTestId("tree-jump-skills/approve-receipt"));
    expect(focusRowMock).toHaveBeenCalledWith("skill", "approve-receipt");
    expect(navigateMock).not.toHaveBeenCalled();
  });

  it("space nodes navigate to the Space source editor with the in-space file", () => {
    renderTree();
    fireEvent.click(
      screen.getByTestId("tree-jump-Spaces/customer-success/notes.md"),
    );
    expect(navigateMock).toHaveBeenCalledWith({
      to: "/settings/spaces/$spaceId",
      params: { spaceId: "space-1" },
      search: { view: "workspace", file: "notes.md" },
    });
  });

  it("generated space files link to the producing source file (pre-U7)", () => {
    renderTree();
    fireEvent.click(
      screen.getByTestId("tree-jump-Spaces/customer-success/CONTEXT.md"),
    );
    expect(navigateMock).toHaveBeenCalledWith({
      to: "/settings/spaces/$spaceId",
      params: { spaceId: "space-1" },
      search: { view: "workspace", file: "CONTEXT.md" },
    });
  });

  it("user nodes navigate to the perspective user's detail page", () => {
    renderTree();
    fireEvent.click(screen.getByTestId("tree-jump-User/USER.md"));
    expect(navigateMock).toHaveBeenCalledWith({
      to: "/settings/users/$userId",
      params: { userId: "user-1" },
    });
  });

  it("hides the user jump when no perspective user is resolvable", () => {
    queryState.preview = {
      data: previewData({ perspectiveUserId: null, noUserBaseline: true }),
      fetching: false,
      error: undefined,
    };
    renderTree({ perspectiveUserId: null });
    expect(screen.queryByTestId("tree-jump-User/USER.md")).toBeNull();
  });

  it("generated agent files open the producing layer's source file in the agent editor", () => {
    renderTree();
    fireEvent.click(screen.getByTestId("tree-jump-AGENTS.md"));
    expect(navigateMock).toHaveBeenCalledWith({
      to: "/settings/agents",
      search: { view: "workspace", file: "AGENTS.md" },
    });
  });
});

describe("pending affordance (sync window)", () => {
  it("renders a ghost skill folder with a syncing badge while the attach materializes", () => {
    renderTree({ pendingSkillSlug: "expenses" });
    expect(screen.getByTestId("tree-node-skills/expenses")).toBeTruthy();
    expect(
      screen.getByTestId("tree-pending-skills/expenses").textContent,
    ).toContain("syncing");
  });

  it("drops the ghost once the folder is really in the tree", () => {
    queryState.preview = {
      data: previewData({
        files: [
          ...FILES,
          {
            path: "skills/expenses/SKILL.md",
            owner: "agent",
            generated: false,
            size: 100,
          },
        ],
      }),
      fetching: false,
      error: undefined,
    };
    renderTree({ pendingSkillSlug: null });
    expect(screen.queryByTestId("tree-pending-skills/expenses")).toBeNull();
    expect(
      screen.getByTestId("tree-file-skills/expenses/SKILL.md"),
    ).toBeTruthy();
  });
});

describe("read-only file viewer", () => {
  it("loads content lazily via workspacePreviewFile and renders it read-only (no put path)", () => {
    renderTree();
    // Nothing fetched until a file is clicked (the file query is paused).
    expect(lastFileCall()?.pause).toBe(true);
    queryState.file = {
      data: {
        workspacePreviewFile: {
          state: "ok",
          stateDetail: null,
          file: {
            path: "AGENTS.md",
            owner: "agent",
            generated: true,
            size: 2048,
          },
          content: "# Rendered AGENTS.md body",
        },
      },
      fetching: false,
      error: undefined,
    };
    fireEvent.click(screen.getByTestId("tree-file-AGENTS.md"));
    expect(lastFileCall()?.pause).toBe(false);
    expect(lastFileCall()?.variables).toMatchObject({ path: "AGENTS.md" });
    expect(screen.getByTestId("composer-file-content").textContent).toContain(
      "# Rendered AGENTS.md body",
    );
    // Read-only: preformatted output, no editor surface, no save path.
    expect(screen.getByText("read-only")).toBeTruthy();
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.queryByText(/save/i)).toBeNull();
    // Close returns to the tree-only view.
    fireEvent.click(screen.getByTestId("composer-file-close"));
    expect(screen.queryByTestId("composer-file-viewer")).toBeNull();
  });

  it("renders viewer error states from the payload state", () => {
    queryState.file = {
      data: {
        workspacePreviewFile: {
          state: "not_found",
          stateDetail: "source object no longer exists",
          file: null,
          content: null,
        },
      },
      fetching: false,
      error: undefined,
    };
    renderTree();
    fireEvent.click(screen.getByTestId("tree-file-CAPABILITIES.md"));
    expect(screen.getByTestId("composer-file-error").textContent).toContain(
      "source object no longer exists",
    );
  });
});

describe("split-view template editor (U7)", () => {
  function lastEditorProps() {
    return editorSpy.mock.calls.at(-1)?.[0] as
      | Record<string, unknown>
      | undefined;
  }

  it("opens a generated agent file split with the agent layer source", () => {
    renderTree();
    fireEvent.click(screen.getByTestId("tree-file-AGENTS.md"));
    expect(screen.getByTestId("composer-split-view")).toBeTruthy();
    expect(screen.getByTestId("composer-source-pane")).toBeTruthy();
    // Rendered pane (read-only viewer) is still present beside the editor.
    expect(screen.getByTestId("composer-file-viewer")).toBeTruthy();
    const props = lastEditorProps();
    expect(props?.target).toEqual({ agentId: "agent-1" });
    expect(props?.defaultOpenFile).toBe("AGENTS.md");
    expect(props?.readOnly).toBe(false);
  });

  it("opens a generated space file split with the space layer source (owner resolved)", () => {
    renderTree();
    fireEvent.click(
      screen.getByTestId("tree-file-Spaces/customer-success/CONTEXT.md"),
    );
    expect(screen.getByTestId("composer-source-pane")).toBeTruthy();
    const props = lastEditorProps();
    expect(props?.target).toEqual({ spaceId: "space-1" });
    expect(props?.defaultOpenFile).toBe("CONTEXT.md");
  });

  it("opens non-generated files single-pane (no source editor)", () => {
    renderTree();
    fireEvent.click(screen.getByTestId("tree-file-CAPABILITIES.md"));
    expect(screen.queryByTestId("composer-split-view")).toBeNull();
    expect(screen.queryByTestId("composer-source-pane")).toBeNull();
    expect(screen.queryByTestId("mock-editor")).toBeNull();
    expect(screen.getByTestId("composer-file-viewer")).toBeTruthy();
  });

  it("refetches the preview after the source is saved (existing putFile path)", async () => {
    renderTree();
    fireEvent.click(screen.getByTestId("tree-file-AGENTS.md"));
    const props = lastEditorProps();
    const client = props?.client as {
      putFile: (t: unknown, p: string, c: string) => Promise<void>;
    };
    await client.putFile({ agentId: "agent-1" }, "AGENTS.md", "# edited prose");
    expect(putFileMock).toHaveBeenCalledWith(
      { agentId: "agent-1" },
      "AGENTS.md",
      "# edited prose",
    );
    expect(previewRefetchMock).toHaveBeenCalledWith({
      requestPolicy: "network-only",
    });
    expect(fileRefetchMock).toHaveBeenCalledWith({
      requestPolicy: "network-only",
    });
  });

  it("gates editing to operators: a non-operator gets a read-only source pane", () => {
    tenant.isOperator = false;
    renderTree();
    fireEvent.click(screen.getByTestId("tree-file-AGENTS.md"));
    expect(lastEditorProps()?.readOnly).toBe(true);
  });

  it("keeps the source pane when the rendered pane errors (per-pane independence)", () => {
    queryState.file = {
      data: {
        workspacePreviewFile: {
          state: "resolution_fault",
          stateDetail: "compose failed",
          file: null,
          content: null,
        },
      },
      fetching: false,
      error: undefined,
    };
    renderTree();
    fireEvent.click(screen.getByTestId("tree-file-AGENTS.md"));
    // Viewer shows its error, source editor is still mounted beside it.
    expect(screen.getByTestId("composer-file-error")).toBeTruthy();
    expect(screen.getByTestId("composer-source-pane")).toBeTruthy();
    expect(screen.getByTestId("mock-editor")).toBeTruthy();
  });

  it("keeps the source pane while the rendered pane is loading", () => {
    queryState.file = { data: undefined, fetching: true, error: undefined };
    renderTree();
    fireEvent.click(screen.getByTestId("tree-file-AGENTS.md"));
    expect(screen.getByTestId("composer-file-loading")).toBeTruthy();
    expect(screen.getByTestId("composer-source-pane")).toBeTruthy();
  });
});

describe("loading and error states", () => {
  it("shows skeletons while the preview loads", () => {
    queryState.preview = { data: undefined, fetching: true, error: undefined };
    renderTree();
    expect(screen.getByTestId("preview-loading")).toBeTruthy();
  });

  it("renders invalid_selection with the backend detail (matches controls-pane copy)", () => {
    queryState.preview = {
      data: previewData({
        state: "invalid_selection",
        stateDetail: "space not found in tenant",
        files: null,
      }),
      fetching: false,
      error: undefined,
    };
    renderTree();
    expect(
      screen.getByTestId("preview-invalid-selection").textContent,
    ).toContain("space not found in tenant");
  });

  it("renders resolution_fault distinctly (matches controls-pane copy)", () => {
    queryState.preview = {
      data: previewData({
        state: "resolution_fault",
        stateDetail: "compose failed",
        files: null,
      }),
      fetching: false,
      error: undefined,
    };
    renderTree();
    expect(
      screen.getByTestId("preview-resolution-fault").textContent,
    ).toContain("compose failed");
  });

  it("renders transport errors", () => {
    queryState.preview = {
      data: undefined,
      fetching: false,
      error: { message: "network sad" },
    };
    renderTree();
    expect(screen.getByTestId("preview-error").textContent).toContain(
      "network sad",
    );
  });
});
