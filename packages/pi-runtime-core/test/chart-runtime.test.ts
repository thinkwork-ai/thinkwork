import { describe, expect, it } from "vitest";

import {
  EMIT_ANALYTICS_CHART_TOOL_NAME,
  MAX_CHART_PARTS_PER_TURN,
  buildEmitAnalyticsChartTool,
  extractEmitAnalyticsChartToolPart,
} from "../src/chart-runtime.js";

function chartArgs(overrides: Record<string, unknown> = {}) {
  return {
    type: "bar",
    title: "Revenue by region",
    series: [
      { label: "EMEA", value: 12 },
      { label: "AMER", value: 20 },
    ],
    caption: "AMER carries the quarter.",
    ...overrides,
  };
}

async function run(
  tool: ReturnType<typeof buildEmitAnalyticsChartTool>,
  args: unknown,
) {
  return (await tool.execute(
    "call-1",
    args as never,
    undefined as never,
    undefined as never,
  )) as {
    content: Array<{ text: string }>;
    details: Record<string, unknown>;
  };
}

describe("emit_analytics_chart", () => {
  it("is named for the always-on chart tool", () => {
    expect(buildEmitAnalyticsChartTool().name).toBe(
      EMIT_ANALYTICS_CHART_TOOL_NAME,
    );
  });

  it("queues a validated chart part with a stable content-hash id", async () => {
    const tool = buildEmitAnalyticsChartTool();
    const result = await run(tool, chartArgs());
    expect(result.details.ok).toBe(true);
    const part = extractEmitAnalyticsChartToolPart(result);
    expect(part?.type).toBe("data-chart");
    expect(part?.id).toMatch(/^chart:[0-9a-f]{8}$/);
    expect(part?.data.title).toBe("Revenue by region");
    expect(result.content[0].text).toContain("Chart queued: Revenue by region");

    // Identical payload → identical id, so a re-emit dedupes.
    const again = await run(buildEmitAnalyticsChartTool(), chartArgs());
    expect(extractEmitAnalyticsChartToolPart(again)?.id).toBe(part?.id);
  });

  it("returns the validator error to the model and queues nothing", async () => {
    const tool = buildEmitAnalyticsChartTool();
    const result = await run(tool, chartArgs({ type: "hologram" }));
    expect(result.details.ok).toBe(false);
    expect(result.content[0].text).toContain("Unknown chart type");
    expect(extractEmitAnalyticsChartToolPart(result)).toBeNull();
  });

  it("caps distinct charts per turn", async () => {
    const tool = buildEmitAnalyticsChartTool();
    for (let i = 0; i < MAX_CHART_PARTS_PER_TURN; i += 1) {
      const ok = await run(tool, chartArgs({ title: `Chart ${i}` }));
      expect(ok.details.ok).toBe(true);
    }
    const overflow = await run(tool, chartArgs({ title: "One too many" }));
    expect(overflow.details.ok).toBe(false);
    expect(overflow.content[0].text).toContain("Chart limit reached");
    expect(extractEmitAnalyticsChartToolPart(overflow)).toBeNull();

    // A repeat of an already-queued chart is a no-op, not a limit strike.
    const repeat = await run(tool, chartArgs({ title: "Chart 0" }));
    expect(repeat.details.ok).toBe(true);
  });
});
