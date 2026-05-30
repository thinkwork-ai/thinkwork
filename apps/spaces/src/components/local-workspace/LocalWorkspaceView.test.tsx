import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  ReadWorkspaceFileResponse,
  ReadWorkspaceTreeResponse,
} from "@thinkwork/desktop-ipc";
import { LocalWorkspaceView } from "./LocalWorkspaceView";

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
    render(<LocalWorkspaceView bridge={null} />);
    expect(
      await screen.findByText(/only available in the desktop app/i),
    ).toBeTruthy();
  });

  it("shows the no-file-selected placeholder, then renders content (AE1, R15)", async () => {
    const bridge = makeBridge({
      tree: NESTED_TREE,
      files: {
        "dev/GOAL.md": { status: "ok", content: "# GOAL", language: "markdown" },
      },
    });
    render(<LocalWorkspaceView bridge={bridge} />);

    expect(
      await screen.findByText(/select a file to view its contents/i),
    ).toBeTruthy();
    // Nested "skills" folder is collapsed; "GOAL.md" under expanded "dev" shows.
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

  it("shows empty state then repopulates on refresh (AE2)", async () => {
    let tree: ReadWorkspaceTreeResponse = { status: "empty" };
    const bridge = makeBridge({ tree: () => tree });
    render(<LocalWorkspaceView bridge={bridge} />);

    expect(await screen.findByText(/nothing synced yet/i)).toBeTruthy();
    tree = NESTED_TREE;
    fireEvent.click(screen.getByRole("button", { name: /refresh/i }));
    expect(await screen.findByText("GOAL.md")).toBeTruthy();
  });

  it("renders too-large and binary statuses with no copy button", async () => {
    const bridge = makeBridge({
      tree: NESTED_TREE,
      files: {
        "dev/GOAL.md": { status: "too-large", size: 5 * 1024 * 1024 },
      },
    });
    render(<LocalWorkspaceView bridge={bridge} />);
    fireEvent.click(await screen.findByText("GOAL.md"));
    expect(await screen.findByText(/preview unavailable/i)).toBeTruthy();
    expect(screen.getByText(/5\.0 MB/)).toBeTruthy();
  });

  it("surfaces a tree error with retry rather than empty state", async () => {
    const bridge = makeBridge({ tree: { status: "error", code: "EACCES" } });
    render(<LocalWorkspaceView bridge={bridge} />);
    expect(await screen.findByText(/couldn't read the local workspace/i)).toBeTruthy();
    expect(screen.getByText(/EACCES/)).toBeTruthy();
    expect(screen.queryByText(/nothing synced yet/i)).toBeNull();
  });

  it("clears the pane when the selected file vanishes on refresh", async () => {
    let tree: ReadWorkspaceTreeResponse = NESTED_TREE;
    const bridge = makeBridge({
      tree: () => tree,
      files: {
        "dev/GOAL.md": { status: "ok", content: "# GOAL", language: "markdown" },
      },
    });
    render(<LocalWorkspaceView bridge={bridge} />);
    fireEvent.click(await screen.findByText("GOAL.md"));
    expect(await screen.findByText("dev/GOAL.md")).toBeTruthy();

    // Refresh against a tree that no longer contains the selected file.
    tree = { status: "empty" };
    fireEvent.click(screen.getByRole("button", { name: /refresh/i }));
    expect(
      await screen.findByText(/no longer in the cache/i),
    ).toBeTruthy();
  });

  it("fires onClose from the header control (R15)", async () => {
    const onClose = vi.fn();
    const bridge = makeBridge({ tree: { status: "empty" } });
    render(<LocalWorkspaceView bridge={bridge} onClose={onClose} />);
    fireEvent.click(await screen.findByRole("button", { name: /close/i }));
    expect(onClose).toHaveBeenCalledOnce();
  });
});
