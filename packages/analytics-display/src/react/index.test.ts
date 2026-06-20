import { describe, expect, it } from "vitest";

import { validateAnalyticsDisplayPayload } from "../validation.js";
import { createAnalyticsDisplayFixture } from "../test-fixtures.js";
import { createAnalyticsDisplayRenderModel } from "./index.js";

describe("createAnalyticsDisplayRenderModel", () => {
  it("builds dashboard and Thread render models from the same validated payload", () => {
    const payload = createAnalyticsDisplayFixture();
    const validation = validateAnalyticsDisplayPayload(payload);

    expect(validation.ok).toBe(true);
    if (!validation.ok) throw new Error("fixture should validate");

    const dashboard = createAnalyticsDisplayRenderModel(validation.payload, {
      host: "dashboard",
      density: "dashboard",
    });
    const thread = createAnalyticsDisplayRenderModel(validation.payload, {
      host: "thread",
      density: "thread",
    });

    expect(dashboard.title).toBe(thread.title);
    expect(dashboard.elements.map((element) => element.renderer)).toEqual([
      "thinkwork.analytics.metric",
      "thinkwork.ui.ChartContainer",
      "thinkwork.ui.DataTable",
    ]);
    expect(thread.elements.map((element) => element.renderer)).toEqual(
      dashboard.elements.map((element) => element.renderer),
    );
    expect(
      dashboard.elements.find((element) => element.type === "table")
        ?.rowPreviewLimit,
    ).toBe(50);
    expect(
      thread.elements.find((element) => element.type === "table")
        ?.rowPreviewLimit,
    ).toBe(8);
    expect(
      dashboard.elements.find((element) => element.type === "chart")?.maxHeight,
    ).toBe(520);
    expect(
      thread.elements.find((element) => element.type === "chart")?.maxHeight,
    ).toBe(280);
  });
});
