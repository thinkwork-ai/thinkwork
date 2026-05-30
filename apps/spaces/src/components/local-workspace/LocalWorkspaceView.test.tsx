import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  ReadWorkspaceFileResponse,
  ReadWorkspaceTreeResponse,
} from "@thinkwork/desktop-ipc";
import { PageHeaderProvider, usePageHeader } from "@/context/PageHeaderContext";
import { LocalWorkspaceView } from "./LocalWorkspaceView";

// react-resizable-panels needs a real ResizeObserver; the shared jsdom stub
// isn't compatible. The split's drag behavior is verified visually, so mock the
// primitives to passthroughs and keep the rest of @thinkwork/ui real.
vi.mock("@thinkwork/ui", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@thinkwork/ui")>();
  return {
    ...actual,
    ResizablePanelGroup: ({ children }: { children?: React.ReactNode }) =>
      children ?? null,
    ResizablePanel: ({ children }: { children?: React.ReactNode }) =>
      children ?? null,
    ResizableHandle: () => null,
  };
});

afterEach(cleanup);

function makeBridge(opts: {
  tree: ReadWorkspaceTreeResponse | (() => ReadWorkspaceTreeResponse);
  files?: Record<string, ReadWorkspaceFileResponse>;
}) {
  return {
    readWorkspaceTree: vi.fn(async () =>
      typeof opts.tree === "function" ? opts.tree() : opts.tree,
    ),
    readWorkspaceFile: vi.fn(
      async ({ path }: { path: string }) =>
        opts.files?.[path] ?? ({ status: "vanished" } as const),
    ),
  };
}

// Surfaces the header action the view publishes (Refresh) so tests can click
// it — in the app this slot is rendered by the settings header bar.
function HeaderActionProbe() {
  const { actions } = usePageHeader();
  return <div data-testid="header-actions">{actions?.action}</div>;
}

function Harness({ bridge }: { bridge: ReturnType<typeof makeBridge> }) {
  return (
    <PageHeaderProvider>
      <HeaderActionProbe />
      <LocalWorkspaceView bridge={bridge} />
    </PageHeaderProvider>
  );
}

const NESTED_TREE: ReadWorkspaceTreeResponse = {
  status: "ok",
  truncated: false,
  tree: [
    {
      name: "dev",
      path: "dev",
      kind: "dir",
      children: [
        { name: "GOAL.md", path: "dev/GOAL.md", kind: "file" },
        { name: "skills", path: "dev/skills", kind: "dir", children: [] },
      ],
    },
  ],
};

describe("LocalWorkspaceView", () => {
  it("renders the not-available state without a bridge (R14)", async () => {
    render(
      <PageHeaderProvider>
        <LocalWorkspaceView bridge={null} />
      </PageHeaderProvider>,
    );
    expect(
      await screen.findByText(/only available in the desktop app/i),
    ).toBeTruthy();
  });

  it("publishes an icon-only Refresh into the header; no second header (AE1)", async () => {
    const bridge = makeBridge({
      tree: NESTED_TREE,
      files: {
        "dev/GOAL.md": {
          status: "ok",
          content: "# GOAL",
          language: "markdown",
        },
      },
    });
    render(<Harness bridge={bridge} />);

    expect(
      await screen.findByText(/select a file to view its contents/i),
    ).toBeTruthy();
    // Refresh is published as a header action, not a second in-view header.
    expect(screen.getByRole("button", { name: /refresh/i })).toBeTruthy();
    const goal = await screen.findByText("GOAL.md");
    expect(screen.queryByText("skills")).toBeTruthy();
    fireEvent.click(goal);
    await waitFor(() =>
      expect(bridge.readWorkspaceFile).toHaveBeenCalledWith({
        path: "dev/GOAL.md",
      }),
    );
    expect(await screen.findByText("dev/GOAL.md")).toBeTruthy();
  });

  it("publishes no Refresh action when unavailable", () => {
    render(
      <PageHeaderProvider>
        <HeaderActionProbe />
        <LocalWorkspaceView bridge={null} />
      </PageHeaderProvider>,
    );
    expect(screen.queryByRole("button", { name: /refresh/i })).toBeNull();
  });

  it("shows empty state then repopulates on refresh (AE2)", async () => {
    let tree: ReadWorkspaceTreeResponse = { status: "empty" };
    const bridge = makeBridge({ tree: () => tree });
    render(<Harness bridge={bridge} />);

    expect(await screen.findByText(/nothing synced yet/i)).toBeTruthy();
    // Refresh is disabled while the initial load is in flight; wait for it to
    // settle enabled before clicking so the click isn't swallowed.
    await waitFor(() => {
      const b = screen.getByRole("button", {
        name: /refresh/i,
      }) as HTMLButtonElement;
      expect(b.disabled).toBe(false);
    });
    tree = NESTED_TREE;
    fireEvent.click(screen.getByRole("button", { name: /refresh/i }));
    expect(await screen.findByText("GOAL.md")).toBeTruthy();
  });

  it("renders too-large status (no copy button)", async () => {
    const bridge = makeBridge({
      tree: NESTED_TREE,
      files: {
        "dev/GOAL.md": { status: "too-large", size: 5 * 1024 * 1024 },
      },
    });
    render(<Harness bridge={bridge} />);
    fireEvent.click(await screen.findByText("GOAL.md"));
    expect(await screen.findByText(/preview unavailable/i)).toBeTruthy();
    expect(screen.getByText(/5\.0 MB/)).toBeTruthy();
  });

  it("surfaces a tree error with retry rather than empty state", async () => {
    const bridge = makeBridge({ tree: { status: "error", code: "EACCES" } });
    render(<Harness bridge={bridge} />);
    expect(
      await screen.findByText(/couldn't read the local workspace/i),
    ).toBeTruthy();
    expect(screen.getByText(/EACCES/)).toBeTruthy();
    expect(screen.queryByText(/nothing synced yet/i)).toBeNull();
  });

  it("clears the pane when the selected file vanishes on refresh", async () => {
    let tree: ReadWorkspaceTreeResponse = NESTED_TREE;
    const bridge = makeBridge({
      tree: () => tree,
      files: {
        "dev/GOAL.md": {
          status: "ok",
          content: "# GOAL",
          language: "markdown",
        },
      },
    });
    render(<Harness bridge={bridge} />);
    fireEvent.click(await screen.findByText("GOAL.md"));
    expect(await screen.findByText("dev/GOAL.md")).toBeTruthy();

    tree = { status: "empty" };
    fireEvent.click(screen.getByRole("button", { name: /refresh/i }));
    expect(await screen.findByText(/no longer in the cache/i)).toBeTruthy();
  });
});
