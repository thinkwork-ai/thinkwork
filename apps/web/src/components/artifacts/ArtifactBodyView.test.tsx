/**
 * THINK-168: ArtifactBodyView dispatch — the shared chrome-free body used by
 * both /artifacts/$id and the docked thread panel.
 */

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

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
