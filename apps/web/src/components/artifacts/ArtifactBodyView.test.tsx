/**
 * THINK-168: ArtifactBodyView dispatch — the shared chrome-free body used by
 * both /artifacts/$id and the docked thread panel.
 */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// The document body lazily fetches a pinned version's render when a history
// entry is clicked; the mock serves a fixed v-render unless paused.
const useQueryMock = vi.fn(
  (opts: { pause?: boolean; variables?: { version?: number } }) => [
    {
      data: opts.pause
        ? undefined
        : { documentVersionRender: "<html>pinned</html>" },
      fetching: false,
    },
    vi.fn(),
  ],
);
vi.mock("urql", () => ({
  useQuery: (opts: never) => useQueryMock(opts),
}));

vi.mock("@/components/apps/InlineAppletEmbed", () => ({
  InlineAppletEmbed: ({ appId }: { appId: string }) => (
    <div data-testid="inline-applet-embed-stub" data-app-id={appId} />
  ),
}));

vi.mock("@/components/workbench/DocumentFrame", () => ({
  DocumentFrame: ({ title }: { title: string }) => (
    <div data-testid="document-frame-stub" data-title={title} />
  ),
}));

vi.mock("@/components/artifacts/canvas/CanvasArtifactView", () => ({
  CanvasArtifactView: ({ artifact }: { artifact: { id: string } }) => (
    <div data-testid="canvas-view-stub" data-artifact-id={artifact.id} />
  ),
}));

import { ArtifactBodyView } from "./ArtifactBodyView";

const base = {
  id: "artifact-1",
  title: "Some artifact",
  status: "FINAL",
  updatedAt: "2026-07-04T00:00:00.000Z",
};

afterEach(() => {
  cleanup();
});

describe("ArtifactBodyView", () => {
  it("renders documents in the DocumentFrame reader", () => {
    render(
      <ArtifactBodyView
        artifact={{
          ...base,
          type: "DOCUMENT",
          renderHtml: "<html></html>",
          metadata: { kind: "document" },
        }}
      />,
    );
    expect(screen.getByTestId("document-frame-stub")).toBeTruthy();
  });

  it("renders living canvases via CanvasArtifactView", () => {
    render(
      <ArtifactBodyView
        artifact={{
          ...base,
          type: "DATA_VIEW",
          metadata: {
            kind: "json_render_canvas",
            stablePartId: "json-render:x",
          },
        }}
      />,
    );
    expect(screen.getByTestId("canvas-view-stub").dataset.artifactId).toBe(
      "artifact-1",
    );
  });

  it("embeds app artifacts inline (replaces the legacy summary side panel)", () => {
    render(
      <ArtifactBodyView
        artifact={{
          ...base,
          type: "DATA_VIEW",
          // AWSJSON string form must coerce too.
          metadata: JSON.stringify({ kind: "research_dashboard" }),
        }}
      />,
    );
    expect(screen.getByTestId("inline-applet-embed-stub").dataset.appId).toBe(
      "artifact-1",
    );
  });

  it("falls back like the full page for unsupported types", () => {
    render(<ArtifactBodyView artifact={{ ...base, type: "MYSTERY" }} />);
    expect(
      screen.getByText("This artifact type cannot be opened here."),
    ).toBeTruthy();
  });
});

describe("document staleness indicator (THINK-155 R8)", () => {
  const doc = {
    ...base,
    type: "DOCUMENT",
    renderHtml: "<html></html>",
    metadata: { kind: "document" },
  };

  it("footer shows Updated (no refresh entries) when the refresh fields are null", () => {
    render(<ArtifactBodyView artifact={doc} />);
    expect(screen.getByTestId("document-refreshed-chip").textContent).toContain(
      "Updated",
    );
    expect(screen.queryByTestId("document-stale-chip")).toBeNull();
  });

  it("footer shows Refreshed (replacing Updated) without a warning after a successful refresh", () => {
    render(
      <ArtifactBodyView
        artifact={{ ...doc, lastRefreshAt: "2026-07-06T07:00:00.000Z" }}
      />,
    );
    expect(screen.getByTestId("document-refreshed-chip").textContent).toContain(
      "Refreshed",
    );
    expect(screen.queryByTestId("document-stale-chip")).toBeNull();
  });

  it("footer shows the stale warning when a refresh failed after the last success", () => {
    render(
      <ArtifactBodyView
        artifact={{
          ...doc,
          lastRefreshAt: "2026-06-29T07:00:00.000Z",
          refreshFailedAt: "2026-07-06T07:00:00.000Z",
        }}
      />,
    );
    expect(screen.getByTestId("document-refreshed-chip").textContent).toContain(
      "Refreshed",
    );
    expect(screen.getByTestId("document-stale-chip").textContent).toContain(
      "Scheduled refresh failed",
    );
  });

  it("clears the warning once a later refresh succeeds (recovered)", () => {
    render(
      <ArtifactBodyView
        artifact={{
          ...doc,
          lastRefreshAt: "2026-07-06T07:00:00.000Z",
          refreshFailedAt: "2026-06-29T07:00:00.000Z",
        }}
      />,
    );
    expect(screen.queryByTestId("document-stale-chip")).toBeNull();
  });

  it("warns when the only scheduled refresh ever attempted failed", () => {
    render(
      <ArtifactBodyView
        artifact={{ ...doc, refreshFailedAt: "2026-07-06T07:00:00.000Z" }}
      />,
    );
    expect(screen.getByTestId("document-stale-chip")).toBeTruthy();
    expect(screen.getByTestId("document-refreshed-chip").textContent).toContain(
      "Updated",
    );
  });

  it("keeps the header to identity only — no timestamps above the document", () => {
    render(
      <ArtifactBodyView
        artifact={{ ...doc, lastRefreshAt: "2026-07-06T07:00:00.000Z" }}
      />,
    );
    const header = screen.getByTestId("document-status-chip").parentElement!;
    expect(header.textContent).not.toContain("Updated");
    expect(header.textContent).not.toContain("Refreshed");
  });
});

describe("document change-log footer", () => {
  const versions = [
    {
      id: "ver-2",
      version: 2,
      createdBy: "u1",
      createdByName: "Eric Odom",
      createdAt: "2026-07-06T07:00:00.000Z",
    },
    {
      id: "ver-1",
      version: 1,
      createdBy: "u1",
      createdByName: "Eric Odom",
      createdAt: "2026-07-01T07:00:00.000Z",
    },
  ];
  const doc = {
    ...base,
    type: "DOCUMENT",
    headVersion: 2,
    renderHtml: "<html>head</html>",
    metadata: { kind: "document" },
    versions,
  };

  it("hides the history toggle when the document has no pinned versions", () => {
    render(<ArtifactBodyView artifact={{ ...doc, versions: [] }} />);
    expect(screen.queryByTestId("document-history-toggle")).toBeNull();
  });

  it("Show all slides up the full change log, newest first with author and age", () => {
    render(<ArtifactBodyView artifact={doc} />);
    expect(screen.queryByTestId("document-history-panel")).toBeNull();
    fireEvent.click(screen.getByTestId("document-history-toggle"));
    const panel = screen.getByTestId("document-history-panel");
    expect(panel.textContent).toContain("v2");
    expect(panel.textContent).toContain("v1");
    expect(panel.textContent).toContain("Eric Odom");
    expect(
      screen.getByTestId("document-history-version-2").textContent,
    ).toContain("current");
  });

  it("clicking an older version views its pinned render with a back-to-latest affordance", () => {
    render(<ArtifactBodyView artifact={doc} />);
    fireEvent.click(screen.getByTestId("document-history-toggle"));
    fireEvent.click(screen.getByTestId("document-history-version-1"));
    expect(screen.getByTestId("document-back-to-latest").textContent).toContain(
      "Viewing v1",
    );
    // Freshness line yields to the viewing state while off the head.
    expect(screen.queryByTestId("document-refreshed-chip")).toBeNull();
    fireEvent.click(screen.getByTestId("document-back-to-latest"));
    expect(screen.getByTestId("document-refreshed-chip")).toBeTruthy();
  });

  it("clicking the current version returns to the living head, not a pinned copy", () => {
    render(<ArtifactBodyView artifact={doc} />);
    fireEvent.click(screen.getByTestId("document-history-toggle"));
    fireEvent.click(screen.getByTestId("document-history-version-1"));
    fireEvent.click(screen.getByTestId("document-history-version-2"));
    expect(screen.queryByTestId("document-back-to-latest")).toBeNull();
    expect(screen.getByTestId("document-refreshed-chip")).toBeTruthy();
  });
});
