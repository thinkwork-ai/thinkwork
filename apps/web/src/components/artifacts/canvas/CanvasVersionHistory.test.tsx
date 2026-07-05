import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";

const useQueryMock = vi.fn();
vi.mock("urql", () => ({
  useQuery: (...args: unknown[]) => useQueryMock(...args),
}));

vi.mock("@/lib/graphql-queries", () => ({
  ArtifactVersionContentQuery: Symbol("ArtifactVersionContentQuery"),
}));

vi.mock("@/components/workbench/json-render/ThreadJsonRenderRenderer", () => ({
  ThreadJsonRenderRenderer: ({ partId }: { partId?: string }) => (
    <div data-testid="rendered-version">rendered:{partId}</div>
  ),
}));

// Passthrough dialog so its (open) content renders inline in jsdom.
vi.mock("@thinkwork/ui", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    Dialog: ({ open, children }: { open?: boolean; children: ReactNode }) =>
      open ? <div>{children}</div> : null,
    DialogContent: ({ children }: { children: ReactNode }) => (
      <div>{children}</div>
    ),
    DialogHeader: ({ children }: { children: ReactNode }) => (
      <div>{children}</div>
    ),
    DialogTitle: ({ children }: { children: ReactNode }) => (
      <div>{children}</div>
    ),
  };
});

import { CanvasVersionHistory } from "./CanvasVersionHistory";

afterEach(() => {
  cleanup();
  useQueryMock.mockReset();
});

const livingPart = JSON.stringify({
  type: "data-json-render",
  id: "part-1",
  data: { spec: {} },
});

describe("CanvasVersionHistory", () => {
  it("renders an empty state when there are no versions", () => {
    useQueryMock.mockReturnValue([{ data: undefined, fetching: false }]);
    render(
      <CanvasVersionHistory artifactId="a1" versions={[]} headVersion={0} />,
    );
    expect(screen.getByTestId("canvas-version-history").textContent).toContain(
      "No pinned versions yet",
    );
  });

  it("lists versions newest-first and marks the current head", () => {
    useQueryMock.mockReturnValue([{ data: undefined, fetching: false }]);
    render(
      <CanvasVersionHistory
        artifactId="a1"
        headVersion={2}
        versions={[
          { id: "v2", version: 2, createdAt: "2026-07-04T10:00:00Z" },
          { id: "v1", version: 1, createdAt: "2026-07-03T10:00:00Z" },
        ]}
      />,
    );
    const rows = screen.getAllByTestId("canvas-version-row");
    expect(rows).toHaveLength(2);
    expect(rows[0].textContent).toContain("Version 2");
    expect(rows[0].textContent).toContain("(current)");
  });

  it("opens a pinned version read-only when View is clicked", () => {
    useQueryMock.mockReturnValue([
      {
        data: {
          artifact: {
            versions: [{ id: "v1", version: 1, content: livingPart }],
          },
        },
        fetching: false,
      },
    ]);
    render(
      <CanvasVersionHistory
        artifactId="a1"
        headVersion={1}
        versions={[{ id: "v1", version: 1, createdAt: "2026-07-03T10:00:00Z" }]}
      />,
    );
    fireEvent.click(screen.getByTestId("canvas-version-view"));
    expect(screen.getByTestId("rendered-version").textContent).toBe(
      "rendered:part-1",
    );
  });
});
