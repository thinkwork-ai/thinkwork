import { describe, expect, it } from "vitest";
import {
  ALL_KINDS,
  DEFAULT_SORT_BY,
  SORT_GENERATED,
  SORT_NAME,
  TAB_ALL,
  filterArtifactItems,
  sortArtifactItems,
  toArtifactItem,
  uniqueKinds,
  type ArtifactItem,
} from "./artifacts-filtering";
import type { AppArtifactPreview } from "@/lib/app-artifacts";

const items: ArtifactItem[] = [
  {
    id: "a1",
    artifactId: "artifact-a1",
    title: "LastMile CRM pipeline risk",
    kind: "applet",
    modelId: "claude-opus-4-7",
    stdlibVersion: "0.1.0",
    generatedAt: "2026-05-09T10:00:00.000Z",
    favoritedAt: null,
    version: 1,
  },
  {
    id: "a2",
    artifactId: "artifact-a2",
    title: "Austin Map",
    kind: "applet",
    modelId: "claude-sonnet-4-6",
    stdlibVersion: "0.1.0",
    generatedAt: "2026-05-09T11:00:00.000Z",
    favoritedAt: null,
    version: 2,
  },
  {
    id: "c1",
    artifactId: "artifact-c1",
    title: "Pipeline chart",
    kind: "chart",
    modelId: null,
    stdlibVersion: null,
    generatedAt: "",
    favoritedAt: null,
    version: null,
  },
];

describe("filterArtifactItems", () => {
  it("returns all items when no filters are active", () => {
    expect(
      filterArtifactItems({
        items,
        search: "",
        kind: ALL_KINDS,
        tab: TAB_ALL,
      }),
    ).toHaveLength(3);
  });

  it("matches title case-insensitively", () => {
    expect(
      filterArtifactItems({
        items,
        search: "lastmile",
        kind: ALL_KINDS,
        tab: TAB_ALL,
      }).map((r) => r.id),
    ).toEqual(["a1"]);
  });

  it("matches modelId substring even when title does not contain it", () => {
    expect(
      filterArtifactItems({
        items,
        search: "sonnet",
        kind: ALL_KINDS,
        tab: TAB_ALL,
      }).map((r) => r.id),
    ).toEqual(["a2"]);
  });

  it("tab filter excludes non-matching kinds", () => {
    expect(
      filterArtifactItems({
        items,
        search: "",
        kind: ALL_KINDS,
        tab: "applet",
      }).map((r) => r.id),
    ).toEqual(["a1", "a2"]);
  });

  it("kind dropdown filter applies on top of tab=all", () => {
    expect(
      filterArtifactItems({
        items,
        search: "",
        kind: "chart",
        tab: TAB_ALL,
      }).map((r) => r.id),
    ).toEqual(["c1"]);
  });

  it("returns empty when filters exclude everything", () => {
    expect(
      filterArtifactItems({
        items,
        search: "nothing-matches",
        kind: ALL_KINDS,
        tab: TAB_ALL,
      }),
    ).toEqual([]);
  });

  it("handles an empty input list", () => {
    expect(
      filterArtifactItems({
        items: [],
        search: "anything",
        kind: ALL_KINDS,
        tab: TAB_ALL,
      }),
    ).toEqual([]);
  });
});

describe("uniqueKinds", () => {
  it("returns sorted unique kinds", () => {
    expect(uniqueKinds(items)).toEqual(["applet", "chart"]);
  });

  it("returns [] for empty input", () => {
    expect(uniqueKinds([])).toEqual([]);
  });
});

describe("sortArtifactItems", () => {
  function row(overrides: Partial<ArtifactItem>): ArtifactItem {
    return {
      id: overrides.id ?? "id-1",
      artifactId: overrides.artifactId ?? null,
      title: overrides.title ?? "Untitled",
      kind: overrides.kind ?? "applet",
      modelId: overrides.modelId ?? null,
      stdlibVersion: overrides.stdlibVersion ?? null,
      generatedAt: overrides.generatedAt ?? "",
      favoritedAt: overrides.favoritedAt ?? null,
      version: overrides.version ?? null,
    };
  }

  it("defaults to SORT_GENERATED", () => {
    expect(DEFAULT_SORT_BY).toBe(SORT_GENERATED);
  });

  it("sorts by title ascending, case-insensitive", () => {
    const items = [
      row({ id: "a", title: "Beta" }),
      row({ id: "b", title: "alpha" }),
      row({ id: "c", title: "Charlie" }),
    ];
    expect(sortArtifactItems(items, SORT_NAME).map((i) => i.title)).toEqual([
      "alpha",
      "Beta",
      "Charlie",
    ]);
  });

  it("sorts by generatedAt descending, newest first", () => {
    const items = [
      row({ id: "old", generatedAt: "2026-05-08T10:00:00Z" }),
      row({ id: "new", generatedAt: "2026-05-10T10:00:00Z" }),
      row({ id: "mid", generatedAt: "2026-05-09T10:00:00Z" }),
    ];
    expect(sortArtifactItems(items, SORT_GENERATED).map((i) => i.id)).toEqual([
      "new",
      "mid",
      "old",
    ]);
  });

  it("distinguishes time-of-day on the same calendar date", () => {
    // U4 acceptance: even though the table only renders the date, the
    // sort uses the full ISO timestamp so two items on the same day are
    // ordered by hour:minute:second.
    const items = [
      row({ id: "morning", generatedAt: "2026-05-10T08:00:00Z" }),
      row({ id: "evening", generatedAt: "2026-05-10T20:00:00Z" }),
      row({ id: "midday", generatedAt: "2026-05-10T12:30:00Z" }),
    ];
    expect(sortArtifactItems(items, SORT_GENERATED).map((i) => i.id)).toEqual([
      "evening",
      "midday",
      "morning",
    ]);
  });

  it("places items with empty generatedAt last in date-desc order", () => {
    const items = [
      row({ id: "missing", generatedAt: "" }),
      row({ id: "old", generatedAt: "2026-05-08T10:00:00Z" }),
      row({ id: "new", generatedAt: "2026-05-10T10:00:00Z" }),
    ];
    expect(sortArtifactItems(items, SORT_GENERATED).map((i) => i.id)).toEqual([
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
  it("preserves identifying fields and coerces missing optionals to null/empty", () => {
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
    };
    expect(toArtifactItem(preview)).toEqual({
      id: preview.id,
      artifactId: "artifact-3333",
      title: preview.title,
      kind: "applet",
      modelId: "claude-opus-4-7",
      stdlibVersion: "0.1.0",
      generatedAt: "2026-05-08T16:00:00.000Z",
      favoritedAt: "2026-05-10T18:00:00.000Z",
      version: 1,
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
    expect(item.modelId).toBeNull();
    expect(item.stdlibVersion).toBeNull();
    expect(item.version).toBeNull();
    expect(item.generatedAt).toBe("");
    expect(item.favoritedAt).toBeNull();
    expect(item.artifactId).toBeNull();
  });
});
