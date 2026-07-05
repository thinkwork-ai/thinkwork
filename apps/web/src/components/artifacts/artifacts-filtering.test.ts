import { describe, expect, it } from "vitest";
import {
  DEFAULT_SORT_BY,
  SORT_GENERATED,
  SORT_NAME,
  artifactNodeToItem,
  filterArtifactItems,
  isAppletArtifactNode,
  sortArtifactItems,
  toArtifactItem,
  type ArtifactItem,
} from "./artifacts-filtering";
import type { AppArtifactPreview } from "@/lib/app-artifacts";

describe("artifact list projection", () => {
  it("maps a living-canvas row into an ArtifactItem (id === artifactId, head version, Canvas badge)", () => {
    const item = artifactNodeToItem({
      id: "canvas-1",
      title: "Cost dashboard",
      type: "DATA_VIEW",
      status: "final",
      headVersion: 3,
      updatedAt: "2026-07-04T10:00:00Z",
      metadata: { kind: "json_render_canvas" },
    });
    expect(item).not.toBeNull();
    expect(item?.id).toBe("canvas-1");
    expect(item?.artifactId).toBe("canvas-1");
    expect(item?.title).toBe("Cost dashboard");
    expect(item?.version).toBe(3);
    expect(item?.generatedAt).toBe("2026-07-04T10:00:00Z");
    expect(item?.typeLabel).toBe("Canvas");
  });

  it("accepts a stringified metadata blob", () => {
    const item = artifactNodeToItem({
      id: "c2",
      title: "x",
      type: "DATA_VIEW",
      metadata: '{"kind":"json_render_canvas"}',
    });
    expect(item?.typeLabel).toBe("Canvas");
  });

  it("shows no version chip for an unpinned (headVersion 0) canvas", () => {
    expect(
      artifactNodeToItem({ id: "c", title: "x", headVersion: 0 })?.version,
    ).toBeNull();
  });

  it("maps an HTML document artifact with a title-cased genre badge", () => {
    const item = artifactNodeToItem({
      id: "doc-1",
      title: "Q3 Board Report",
      type: "REPORT",
      status: "final",
      updatedAt: "2026-07-04T10:00:00Z",
      metadata: { kind: "document" },
    });
    expect(item).not.toBeNull();
    expect(item?.typeLabel).toBe("Report");
    expect(item?.title).toBe("Q3 Board Report");
  });

  it("falls back to 'Document' (not 'Canvas') for a titleless document", () => {
    const item = artifactNodeToItem({
      id: "doc-2",
      type: "PLAN",
      metadata: { kind: "document" },
    });
    expect(item?.title).toBe("Document");
    expect(item?.typeLabel).toBe("Plan");
  });

  it("keeps an unknown plugin-minted type with a title-cased badge (not dropped)", () => {
    const item = artifactNodeToItem({
      id: "ev-1",
      title: "SOC2 access review",
      type: "SOC2_EVIDENCE",
      metadata: { kind: "soc2_evidence" },
    });
    expect(item).not.toBeNull();
    expect(item?.typeLabel).toBe("Soc2 Evidence");
  });

  it("excludes applet-kind rows to avoid duplicates with the applets query", () => {
    expect(
      artifactNodeToItem({
        id: "app-1",
        title: "Pipeline app",
        type: "APPLET",
        metadata: { kind: "computer_applet" },
      }),
    ).toBeNull();
    expect(
      artifactNodeToItem({
        id: "app-2",
        title: "Dash",
        type: "DATA_VIEW",
        metadata: { kind: "research_dashboard" },
      }),
    ).toBeNull();
    expect(
      artifactNodeToItem({
        id: "app-3",
        title: "Surface app",
        type: "DATA_VIEW",
        metadata: { uiSurface: "app" },
      }),
    ).toBeNull();
  });

  it("isAppletArtifactNode flags applet-kind rows and passes real artifacts", () => {
    expect(isAppletArtifactNode({ id: "x", type: "APPLET_STATE" })).toBe(true);
    expect(
      isAppletArtifactNode({
        id: "y",
        type: "DATA_VIEW",
        metadata: { kind: "json_render_canvas" },
      }),
    ).toBe(false);
  });
});

const items: ArtifactItem[] = [
  {
    id: "a1",
    artifactId: "artifact-a1",
    title: "LastMile CRM pipeline risk",
    userName: "Ada Lovelace",
    modelId: "claude-opus-4-7",
    stdlibVersion: "0.1.0",
    generatedAt: "2026-05-09T10:00:00.000Z",
    favoritedAt: null,
    version: 1,
    typeLabel: "App",
  },
  {
    id: "a2",
    artifactId: "artifact-a2",
    title: "Austin Map",
    userName: "Grace Hopper",
    modelId: "claude-sonnet-4-6",
    stdlibVersion: "0.1.0",
    generatedAt: "2026-05-09T11:00:00.000Z",
    favoritedAt: null,
    version: 2,
    typeLabel: "App",
  },
  {
    id: "c1",
    artifactId: "artifact-c1",
    title: "Pipeline chart",
    userName: null,
    modelId: null,
    stdlibVersion: null,
    generatedAt: "",
    favoritedAt: null,
    version: null,
    typeLabel: "Canvas",
  },
];

describe("filterArtifactItems", () => {
  it("returns all items when the search is empty", () => {
    expect(filterArtifactItems({ items, search: "" })).toHaveLength(3);
  });

  it("matches title case-insensitively", () => {
    expect(
      filterArtifactItems({ items, search: "lastmile" }).map((r) => r.id),
    ).toEqual(["a1"]);
  });

  it("matches modelId substring even when title does not contain it", () => {
    expect(
      filterArtifactItems({ items, search: "sonnet" }).map((r) => r.id),
    ).toEqual(["a2"]);
  });

  it("matches the generating user's name", () => {
    expect(
      filterArtifactItems({ items, search: "grace" }).map((r) => r.id),
    ).toEqual(["a2"]);
  });

  it("matches the type label badge text", () => {
    expect(
      filterArtifactItems({ items, search: "canvas" }).map((r) => r.id),
    ).toEqual(["c1"]);
  });

  it("returns empty when the search excludes everything", () => {
    expect(filterArtifactItems({ items, search: "nothing-matches" })).toEqual(
      [],
    );
  });

  it("handles an empty input list", () => {
    expect(filterArtifactItems({ items: [], search: "anything" })).toEqual([]);
  });
});

describe("sortArtifactItems", () => {
  function row(overrides: Partial<ArtifactItem>): ArtifactItem {
    return {
      id: overrides.id ?? "id-1",
      artifactId: overrides.artifactId ?? null,
      title: overrides.title ?? "Untitled",
      userName: overrides.userName ?? null,
      modelId: overrides.modelId ?? null,
      stdlibVersion: overrides.stdlibVersion ?? null,
      generatedAt: overrides.generatedAt ?? "",
      favoritedAt: overrides.favoritedAt ?? null,
      version: overrides.version ?? null,
      typeLabel: overrides.typeLabel ?? null,
    };
  }

  it("defaults to SORT_GENERATED", () => {
    expect(DEFAULT_SORT_BY).toBe(SORT_GENERATED);
  });

  it("sorts by title ascending, case-insensitive", () => {
    const rows = [
      row({ id: "a", title: "Beta" }),
      row({ id: "b", title: "alpha" }),
      row({ id: "c", title: "Charlie" }),
    ];
    expect(sortArtifactItems(rows, SORT_NAME).map((i) => i.title)).toEqual([
      "alpha",
      "Beta",
      "Charlie",
    ]);
  });

  it("sorts by generatedAt descending, newest first", () => {
    const rows = [
      row({ id: "old", generatedAt: "2026-05-08T10:00:00Z" }),
      row({ id: "new", generatedAt: "2026-05-10T10:00:00Z" }),
      row({ id: "mid", generatedAt: "2026-05-09T10:00:00Z" }),
    ];
    expect(sortArtifactItems(rows, SORT_GENERATED).map((i) => i.id)).toEqual([
      "new",
      "mid",
      "old",
    ]);
  });

  it("distinguishes time-of-day on the same calendar date", () => {
    const rows = [
      row({ id: "morning", generatedAt: "2026-05-10T08:00:00Z" }),
      row({ id: "evening", generatedAt: "2026-05-10T20:00:00Z" }),
      row({ id: "midday", generatedAt: "2026-05-10T12:30:00Z" }),
    ];
    expect(sortArtifactItems(rows, SORT_GENERATED).map((i) => i.id)).toEqual([
      "evening",
      "midday",
      "morning",
    ]);
  });

  it("places items with empty generatedAt last in date-desc order", () => {
    const rows = [
      row({ id: "missing", generatedAt: "" }),
      row({ id: "old", generatedAt: "2026-05-08T10:00:00Z" }),
      row({ id: "new", generatedAt: "2026-05-10T10:00:00Z" }),
    ];
    expect(sortArtifactItems(rows, SORT_GENERATED).map((i) => i.id)).toEqual([
      "new",
      "old",
      "missing",
    ]);
  });

  it("does not mutate the input array", () => {
    const original: ArtifactItem[] = [
      row({ id: "z", title: "Zebra" }),
      row({ id: "a", title: "Apple" }),
    ];
    const snapshot = original.map((i) => i.id);
    sortArtifactItems(original, SORT_NAME);
    expect(original.map((i) => i.id)).toEqual(snapshot);
  });
});

describe("toArtifactItem", () => {
  it("preserves identifying fields including the generating user name", () => {
    const preview: AppArtifactPreview = {
      id: "33333333-3333-4333-8333-333333333333",
      artifactId: "artifact-3333",
      title: "LastMile CRM pipeline risk",
      kind: "applet",
      summary: "Pipeline-risk applet generated by Computer.",
      href: "/artifacts/33333333-3333-4333-8333-333333333333",
      generatedAt: "2026-05-08T16:00:00.000Z",
      favoritedAt: "2026-05-10T18:00:00.000Z",
      version: 1,
      modelId: "claude-opus-4-7",
      stdlibVersionAtGeneration: "0.1.0",
      userName: "Ada Lovelace",
    };
    expect(toArtifactItem(preview)).toEqual({
      id: preview.id,
      artifactId: "artifact-3333",
      title: preview.title,
      userName: "Ada Lovelace",
      modelId: "claude-opus-4-7",
      stdlibVersion: "0.1.0",
      generatedAt: "2026-05-08T16:00:00.000Z",
      favoritedAt: "2026-05-10T18:00:00.000Z",
      version: 1,
      typeLabel: "App",
    });
  });

  it("coerces missing optional fields to null/empty", () => {
    const preview: AppArtifactPreview = {
      id: "x",
      artifactId: null,
      title: "X",
      kind: "applet",
      summary: "",
      href: "/artifacts/x",
      generatedAt: "",
      favoritedAt: null,
    };
    const item = toArtifactItem(preview);
    expect(item.userName).toBeNull();
    expect(item.modelId).toBeNull();
    expect(item.stdlibVersion).toBeNull();
    expect(item.version).toBeNull();
    expect(item.generatedAt).toBe("");
    expect(item.favoritedAt).toBeNull();
    expect(item.artifactId).toBeNull();
  });
});
