import { describe, expect, it } from "vitest";
import { createAnalyticsDisplaySummary } from "./summary.js";
import type { AnalyticsDisplayRenderPayload } from "./spec.js";

function createMinimalPayload(
  overrides: Partial<AnalyticsDisplayRenderPayload> = {},
): AnalyticsDisplayRenderPayload {
  return {
    kind: "analytics.display",
    analyticsDisplayVersion: "analytics-display/v1",
    spec: {
      title: "Test Dashboard",
      columns: [{ key: "day", label: "Day", type: "string" }],
      elements: [
        { type: "metric", id: "m1", title: "Total", valueKey: "total" },
      ],
    },
    data: {
      rows: [{ day: "2026-06-01", total: 42 }],
    },
    freshness: { takenAt: "2026-06-01T00:00:00.000Z" },
    provenance: { sourceLabels: ["Warehouse"] },
    ...overrides,
  };
}

describe("createAnalyticsDisplaySummary", () => {
  it("includes the title from the spec", () => {
    const summary = createAnalyticsDisplaySummary(createMinimalPayload());
    expect(summary.title).toBe("Test Dashboard");
  });

  it("creates a metric line with value from the first row", () => {
    const summary = createAnalyticsDisplaySummary(createMinimalPayload());
    expect(summary.lines[0]).toContain("Total");
    expect(summary.lines[0]).toContain("42");
  });

  it("shows 'No value' for metrics when rows are empty", () => {
    const summary = createAnalyticsDisplaySummary(
      createMinimalPayload({ data: { rows: [] } }),
    );
    expect(summary.lines[0]).toContain("No value");
  });

  it("uses the empty state title when no elements produce lines", () => {
    const payload = createMinimalPayload();
    payload.spec.elements = [];
    payload.spec.emptyState = { title: "Nothing to show" };
    const summary = createAnalyticsDisplaySummary(payload);
    expect(summary.lines).toEqual(["Nothing to show"]);
  });

  it("falls back to a default empty message when no emptyState is defined", () => {
    const payload = createMinimalPayload();
    payload.spec.elements = [];
    const summary = createAnalyticsDisplaySummary(payload);
    expect(summary.lines).toEqual(["No analytical data to display."]);
  });

  it("summarizes chart elements with point count", () => {
    const payload = createMinimalPayload();
    payload.spec.elements = [
      {
        type: "chart",
        id: "c1",
        title: "Trend",
        chartKind: "line",
        categoryKey: "day",
        series: [
          { key: "s1", label: "S1", valueKey: "total", palette: "chart-1" },
        ],
      },
    ];
    payload.data.rows = [
      { day: "2026-06-01", total: 1 },
      { day: "2026-06-02", total: 2 },
    ];
    const summary = createAnalyticsDisplaySummary(payload);
    expect(summary.lines[0]).toContain("2 points");
  });

  it("uses singular 'point' for single-row charts", () => {
    const payload = createMinimalPayload();
    payload.spec.elements = [
      {
        type: "chart",
        id: "c1",
        title: "Trend",
        chartKind: "bar",
        categoryKey: "day",
        series: [
          { key: "s1", label: "S1", valueKey: "total", palette: "chart-1" },
        ],
      },
    ];
    payload.data.rows = [{ day: "2026-06-01", total: 1 }];
    const summary = createAnalyticsDisplaySummary(payload);
    expect(summary.lines[0]).toContain("1 point");
    expect(summary.lines[0]).not.toContain("points");
  });

  it("summarizes table elements with row count", () => {
    const payload = createMinimalPayload();
    payload.spec.elements = [
      {
        type: "table",
        id: "t1",
        title: "Details",
        columns: [{ key: "day", label: "Day" }],
      },
    ];
    payload.data.rows = [{ day: "a" }, { day: "b" }, { day: "c" }];
    const summary = createAnalyticsDisplaySummary(payload);
    expect(summary.lines[0]).toContain("3 rows");
  });

  it("includes provenance and freshness", () => {
    const summary = createAnalyticsDisplaySummary(createMinimalPayload());
    expect(summary.provenance).toBe("Source: Warehouse");
    expect(summary.freshness).toContain("2026-06-01");
  });

  it("maps filter labels into appliedFilters", () => {
    const payload = createMinimalPayload();
    payload.spec.filters = [
      {
        id: "f1",
        label: "Status",
        columnKey: "day",
        operator: "text_contains",
      },
    ];
    const summary = createAnalyticsDisplaySummary(payload);
    expect(summary.appliedFilters).toEqual(["Status"]);
  });
});
