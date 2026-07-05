/**
 * Shared ArtifactCard (THINK-166 U3) — one compact rendering pattern for all
 * artifact emissions in the transcript, including unknown plugin types.
 */

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-router")>()),
  Link: ({
    to,
    params,
    children,
    ...rest
  }: {
    to: string;
    params?: Record<string, string>;
    children: React.ReactNode;
    [key: string]: unknown;
  }) => (
    <a
      href={to.replace(
        /\$(\w+)/g,
        (_match, key: string) => params?.[key] ?? `$${key}`,
      )}
      {...rest}
    >
      {children}
    </a>
  ),
}));

import {
  ArtifactCard,
  bornCanvasStablePartId,
  deriveStatusLabel,
} from "./ArtifactCard";
import { DocumentCard } from "@/components/workbench/DocumentCard";

afterEach(() => {
  cleanup();
});

describe("ArtifactCard", () => {
  it("renders title + type badge on line 1 and 'status · vN · freshness' on line 2; links to /artifacts/$id", () => {
    const eightHoursAgo = new Date(
      Date.now() - 8 * 60 * 60 * 1000,
    ).toISOString();
    render(
      <ArtifactCard
        artifact={{
          id: "artifact-1",
          title: "Q3 pipeline table",
          type: "DATA_VIEW",
          status: "FINAL",
          headVersion: 3,
          updatedAt: eightHoursAgo,
        }}
      />,
    );

    const card = screen.getByTestId("artifact-card");
    expect(card.getAttribute("href")).toBe("/artifacts/artifact-1");
    expect(screen.getByText("Q3 pipeline table")).toBeTruthy();
    expect(screen.getByText("DATA_VIEW")).toBeTruthy();
    expect(screen.getByText("Final · v3 · 8h ago")).toBeTruthy();
    // No footer affordance line (THINK-168 declutter).
    expect(screen.queryByText(/Open/)).toBeNull();
  });

  it("omits the freshness segment without updatedAt, and never renders a summary line", () => {
    render(
      <ArtifactCard
        artifact={{
          id: "artifact-1",
          title: "Q3 pipeline table",
          type: "DATA_VIEW",
          status: "FINAL",
          headVersion: 3,
        }}
      />,
    );

    expect(screen.getByText("Final · v3")).toBeTruthy();
    expect(screen.queryByText(/ago/)).toBeNull();
  });

  it("onOpen mode: the card is a button that opens the panel; no full-page footer link (THINK-168)", () => {
    const onOpen = vi.fn();
    render(
      <ArtifactCard
        artifact={{
          id: "artifact-1",
          title: "Q3 pipeline table",
          type: "DATA_VIEW",
        }}
        onOpen={onOpen}
      />,
    );

    const card = screen.getByTestId("artifact-card");
    expect(card.tagName).toBe("BUTTON");
    expect(card.getAttribute("aria-label")).toBe("Open Q3 pipeline table");
    card.click();
    expect(onOpen).toHaveBeenCalledTimes(1);
    // Full-page access lives in the panel header now, not on the card.
    expect(screen.queryByText(/full page/i)).toBeNull();
    expect(document.querySelector("a")).toBeNull();
  });

  it("renders unknown plugin type strings verbatim (open string, no enum switch)", () => {
    render(
      <ArtifactCard
        artifact={{
          id: "artifact-2",
          title: "Deal room",
          type: "crm.plugin/pipeline-board",
        }}
      />,
    );

    expect(screen.getByText("crm.plugin/pipeline-board")).toBeTruthy();
  });

  it("falls back to an Artifact badge when type is missing and hides status when absent", () => {
    render(
      <ArtifactCard artifact={{ id: "artifact-3", title: "Untyped thing" }} />,
    );

    expect(screen.getByText("Artifact")).toBeTruthy();
    expect(screen.queryByText(/· v/)).toBeNull();
  });

  it("omits the version suffix when headVersion is 0 (unsaved draft head)", () => {
    render(
      <ArtifactCard
        artifact={{
          id: "artifact-4",
          title: "Draft canvas",
          type: "DATA_VIEW",
          status: "DRAFT",
          headVersion: 0,
        }}
      />,
    );

    expect(screen.getByText("Draft")).toBeTruthy();
    expect(screen.queryByText(/v0/)).toBeNull();
  });
});

describe("deriveStatusLabel", () => {
  it("prettifies open-string statuses and appends vN only when positive", () => {
    expect(deriveStatusLabel("DRAFT", 0)).toBe("Draft");
    expect(deriveStatusLabel("final", 2)).toBe("Final · v2");
    expect(deriveStatusLabel("some_custom_status", null)).toBe(
      "Some_custom_status",
    );
    expect(deriveStatusLabel(null, 4)).toBeNull();
    expect(deriveStatusLabel("  ", 4)).toBeNull();
  });
});

describe("bornCanvasStablePartId", () => {
  it("returns the stable part id for living-canvas metadata", () => {
    expect(
      bornCanvasStablePartId({
        metadata: {
          kind: "json_render_canvas",
          stablePartId: "json-render:abc123",
        },
      }),
    ).toBe("json-render:abc123");
  });

  it("returns null for documents, missing metadata, and missing part ids", () => {
    expect(
      bornCanvasStablePartId({
        metadata: { kind: "document", stablePartId: "json-render:abc123" },
      }),
    ).toBeNull();
    expect(bornCanvasStablePartId({ metadata: null })).toBeNull();
    expect(bornCanvasStablePartId({})).toBeNull();
    expect(
      bornCanvasStablePartId({ metadata: { kind: "json_render_canvas" } }),
    ).toBeNull();
    expect(
      bornCanvasStablePartId({
        metadata: { kind: "json_render_canvas", stablePartId: "" },
      }),
    ).toBeNull();
  });
});

describe("DocumentCard (delegates to ArtifactCard)", () => {
  it("keeps the document presentation: genre badge up top, 'status · vN · freshness' meta line, no abstract", () => {
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    render(
      <DocumentCard
        card={{
          artifactId: "doc-1",
          title: "Onboarding guide",
          genre: "guide",
          abstract: "How to onboard.",
          status: "final",
          headVersion: 2,
          updatedAt: twoHoursAgo,
        }}
      />,
    );

    const card = screen.getByTestId("document-card");
    expect(card.getAttribute("href")).toBe("/artifacts/doc-1");
    expect(screen.getByText("Onboarding guide")).toBeTruthy();
    expect(screen.getByText("guide")).toBeTruthy();
    expect(screen.getByText("Final · v2 · 2h ago")).toBeTruthy();
    // The abstract no longer renders on the card (meta line replaced it).
    expect(screen.queryByText("How to onboard.")).toBeNull();
    // No footer affordance line — the card itself is the link.
    expect(screen.queryByText("Open document →")).toBeNull();
  });

  it("shows Draft with no badge when genre is missing", () => {
    render(
      <DocumentCard
        card={{ artifactId: "doc-2", title: "Draft memo", status: "draft" }}
      />,
    );

    expect(screen.getByText("Draft")).toBeTruthy();
    // No genre → no badge at all (not an "Artifact" fallback badge).
    expect(screen.queryByText("Artifact")).toBeNull();
  });
});
