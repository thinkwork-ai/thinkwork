import { describe, expect, it } from "vitest";

import {
  EMIT_ANALYTICS_CHART_TOOL_NAME,
  MAX_CHART_PARTS_PER_TURN,
  buildEmitAnalyticsChartTool,
  chartDataValues,
  extractEmitAnalyticsChartToolPart,
  wrapEmitChartWithProvenance,
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

describe("emit_analytics_chart provenance gate (THINK-681)", () => {
  function invocation(
    result: unknown,
    overrides: Record<string, unknown> = {},
  ) {
    return { id: "call-1", result, ...overrides };
  }

  function wrapped(
    invocations: Array<Record<string, unknown>>,
    userText?: string,
  ) {
    return wrapEmitChartWithProvenance(
      buildEmitAnalyticsChartTool(),
      () => invocations as never,
      { getUserText: () => userText },
    );
  }

  it("accepts a chart whose numbers came back from a tool this turn", async () => {
    const tool = wrapped([
      invocation({
        content: [{ type: "text", text: '[{"region":"EMEA","amount":12}]' }],
        details: { rows: [{ amount: 20 }] },
      }),
    ]);
    const result = await run(tool, chartArgs());
    expect(result.details.ok).toBe(true);
    expect(extractEmitAnalyticsChartToolPart(result)?.data.title).toBe(
      "Revenue by region",
    );
  });

  it("accepts derived numbers computed from fetched data", async () => {
    const tool = wrapped([invocation({ leads: 120, won: 30 })]);
    const result = await run(
      tool,
      chartArgs({
        series: [
          { label: "Win rate", value: 25 }, // 30 * 100 / 120
          { label: "Lost", value: 90 }, // 120 - 30
        ],
      }),
    );
    expect(result.details.ok).toBe(true);
  });

  it("accepts numbers the user supplied in this turn's message", async () => {
    const tool = wrapped(
      [invocation({ note: "no numbers here" })],
      "Chart my own figures: EMEA 12 and AMER 20 please.",
    );
    const result = await run(tool, chartArgs());
    expect(result.details.ok).toBe(true);
  });

  it("rejects invented numbers and lists them for self-repair", async () => {
    const tool = wrapped([invocation({ rows: [{ amount: 12 }] })]);
    const result = await run(
      tool,
      chartArgs({
        series: [
          { label: "EMEA", value: 4711 },
          { label: "AMER", value: 8123 },
        ],
      }),
    );
    expect(result.details.ok).toBe(false);
    expect(result.details.provenance).toBe("untraced");
    expect(result.content[0].text).toContain("4711");
    expect(result.content[0].text).toContain("8123");
    expect(extractEmitAnalyticsChartToolPart(result)).toBeNull();
  });

  it("rejects any chart when the turn fetched no data at all", async () => {
    const tool = wrapped([]);
    const result = await run(tool, chartArgs());
    expect(result.details.ok).toBe(false);
    expect(result.details.provenance).toBe("no_data_this_turn");
    expect(result.content[0].text).toContain("no data was fetched this turn");
    expect(extractEmitAnalyticsChartToolPart(result)).toBeNull();
  });

  it("ignores errored and still-running invocations as corpus sources", async () => {
    const tool = wrapped([
      invocation(
        { rows: [{ amount: 12 }, { amount: 20 }] },
        { is_error: true },
      ),
      { id: "call-2" },
    ]);
    const result = await run(tool, chartArgs());
    expect(result.details.provenance).toBe("no_data_this_turn");
  });

  it("accepts a re-emit of an already-rejected chart id (loop guard)", async () => {
    const tool = wrapped([]);
    const first = await run(tool, chartArgs());
    expect(first.details.ok).toBe(false);
    const second = await run(tool, chartArgs());
    expect(second.details.ok).toBe(true);
    expect(second.details.provenance).toBe("post_rejection");
    expect(extractEmitAnalyticsChartToolPart(second)?.data.title).toBe(
      "Revenue by region",
    );
    expect(second.content.at(-1)?.text).toContain("Accepted despite");
  });

  it("passes validator rejections through untouched", async () => {
    const tool = wrapped([invocation({ rows: [{ amount: 12 }] })]);
    const result = await run(tool, chartArgs({ type: "hologram" }));
    expect(result.details.ok).toBe(false);
    expect(result.content[0].text).toContain("Unknown chart type");
  });

  it("checks a meter's target alongside its series values", () => {
    expect(
      chartDataValues({
        type: "meter",
        title: "Progress",
        series: [{ label: "Booked", value: 40 }],
        max: 100,
      }),
    ).toEqual([40, 100]);
  });
});
