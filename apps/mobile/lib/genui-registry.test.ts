import { describe, expect, it } from "vitest";
import {
  createAnalyticsDisplayGenUIPart,
  createTaskReviewGenUIFixture,
} from "@thinkwork/genui";

import {
  parseMessageBlocks,
  parseThreadGenUIMobileFallbacks,
} from "./genui-registry";

describe("mobile GenUI registry", () => {
  it("renders persisted data-genui parts as mobile fallback summaries", () => {
    const fixture = createTaskReviewGenUIFixture();

    const fallbacks = parseThreadGenUIMobileFallbacks([fixture]);

    expect(fallbacks).toEqual([
      expect.objectContaining({
        id: fixture.id,
        title: "Review onboarding task",
        summary: expect.stringContaining("kickoff task"),
        status: "ready",
        component: "task.review",
        lines: ["Status: pending"],
      }),
    ]);
  });

  it("accepts analytics.display parts through the shared analytics adapter context", () => {
    const part = createAnalyticsDisplayGenUIPart({
      id: "genui:analytics:support-volume",
      payload: {
        kind: "analytics.display",
        analyticsDisplayVersion: "analytics-display/v1",
        spec: {
          title: "Support Volume",
          columns: [
            { key: "day", label: "Day", type: "date" },
            { key: "total", label: "Total", type: "number" },
          ],
          elements: [
            {
              type: "chart",
              id: "volume",
              title: "Ticket Volume",
              chartKind: "bar",
              categoryKey: "day",
              series: [
                {
                  key: "total",
                  label: "Total",
                  valueKey: "total",
                  palette: "chart-1",
                },
              ],
            },
          ],
        },
        data: { rows: [{ day: "2026-06-18", total: 59 }] },
        freshness: {
          takenAt: "2026-06-18T15:30:00.000Z",
          status: "fresh",
        },
        provenance: {
          sourceLabels: ["Warehouse daily rollup"],
          dataSourceSlugs: ["warehouse-daily-rollup"],
        },
      } as never,
    });

    const [fallback] = parseThreadGenUIMobileFallbacks(JSON.stringify([part]));

    expect(fallback).toEqual(
      expect.objectContaining({
        id: "genui:analytics:support-volume",
        title: "Support Volume",
        component: "analytics.display",
        status: "ready",
      }),
    );
    expect(fallback.lines.join("\n")).toContain("Source: Warehouse");
  });

  it("renders an unsupported fallback for data-genui parts without mobileFallback", () => {
    const fixture = createTaskReviewGenUIFixture() as any;
    delete fixture.data.mobileFallback;

    const [fallback] = parseThreadGenUIMobileFallbacks([fixture]);

    expect(fallback).toEqual(
      expect.objectContaining({
        id: fixture.id,
        title: "Generated view",
        summary: "Open this thread on web to view the generated interface.",
        status: "unsupported",
      }),
    );
    expect(
      fallback.diagnostics?.map((diagnostic) => diagnostic.code),
    ).toContain("GENUI_MOBILE_FALLBACK_REQUIRED");
  });

  it("ignores malformed parts JSON without crashing", () => {
    expect(parseThreadGenUIMobileFallbacks("{not-json")).toEqual([]);
  });

  it("keeps existing _type GenUI message fences working", () => {
    const blocks = parseMessageBlocks(
      'Here is a task.\n```genui\n{"_type":"task","id":"task-1","title":"Follow up"}\n```',
    );

    expect(blocks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "text" }),
        expect.objectContaining({
          type: "genui",
          data: expect.objectContaining({ _type: "task" }),
        }),
      ]),
    );
  });
});
