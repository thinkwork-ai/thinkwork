import { describe, expect, it } from "vitest";
import {
  ANALYTICS_DISPLAY_VERSION,
  createAnalyticsDisplayFixture,
} from "@thinkwork/analytics-display";

import {
  createAnalyticsDisplayGenUIPart,
  createAnalyticsDisplayGenUIValidationContext,
  validateAnalyticsDisplayGenUIData,
} from "./analytics-adapter.js";
import { createThreadGenUISpecHash } from "./hash.js";
import { THREAD_GENUI_ANALYTICS_COMPONENT } from "./spec.js";
import { validateThreadGenUIPart } from "./validation.js";

describe("analytics.display GenUI adapter", () => {
  it("validates metric, chart, and table analytics-display payloads through GenUI", () => {
    const payload = createAnalyticsDisplayFixture();
    const part = createAnalyticsDisplayGenUIPart({
      id: "genui:analytics:support-volume",
      payload,
    });

    const result = validateThreadGenUIPart(
      part,
      createAnalyticsDisplayGenUIValidationContext(),
    );
    const analyticsResult = validateAnalyticsDisplayGenUIData(part.data);

    expect(result.ok).toBe(true);
    expect(analyticsResult.ok).toBe(true);
    if (analyticsResult.ok) {
      expect(
        analyticsResult.payload.spec.elements.map((element) => element.type),
      ).toEqual(["metric", "chart", "table"]);
      expect(analyticsResult.summary.provenance).toContain("Zendesk");
      expect(part.data.mobileFallback.lines).toEqual(
        expect.arrayContaining([
          expect.stringContaining("Total Tickets"),
          expect.stringContaining("Source: Zendesk"),
        ]),
      );
    }
  });

  it("fails closed without the analytics adapter registration", () => {
    const part = createAnalyticsDisplayGenUIPart({
      id: "genui:analytics:support-volume",
      payload: createAnalyticsDisplayFixture(),
    });

    const result = validateThreadGenUIPart(part);

    expect(result.ok).toBe(false);
    expect(codes(result)).toContain("GENUI_ANALYTICS_ADAPTER_MISSING");
  });

  it("rejects dashboard and dataset references in inline analytical payloads", () => {
    const payload = {
      ...createAnalyticsDisplayFixture(),
      dashboardId: "dash_123",
      spec: {
        ...createAnalyticsDisplayFixture().spec,
        dataset_id: "dataset_123",
      },
    };
    const part = createAnalyticsDisplayGenUIPart({
      id: "genui:analytics:reference",
      payload: payload as never,
    });
    part.data.specHash = createThreadGenUISpecHash(part.data.spec);

    const result = validateThreadGenUIPart(
      part,
      createAnalyticsDisplayGenUIValidationContext(),
    );

    expect(result.ok).toBe(false);
    expect(codes(result)).toContain("ANALYTICS_DISPLAY_REFERENCE_FORBIDDEN");
  });

  it("rejects older or unsupported analytics-display versions", () => {
    const payload = createAnalyticsDisplayFixture();
    payload.analyticsDisplayVersion = "analytics-display/v0" as never;
    const part = createAnalyticsDisplayGenUIPart({
      id: "genui:analytics:old",
      payload,
    });

    const result = validateThreadGenUIPart(
      part,
      createAnalyticsDisplayGenUIValidationContext(),
    );

    expect(result.ok).toBe(false);
    expect(codes(result)).toContain("ANALYTICS_DISPLAY_VERSION_UNSUPPORTED");
    expect(JSON.stringify(result)).toContain(ANALYTICS_DISPLAY_VERSION);
  });

  it("rejects bespoke chart schemas instead of creating a parallel catalog", () => {
    const part = createAnalyticsDisplayGenUIPart({
      id: "genui:analytics:support-volume",
      payload: createAnalyticsDisplayFixture(),
    });
    part.data.spec.elements.analytics.component = "chart";
    part.data.spec.elements.analytics.props = {
      type: "bar",
      rows: [{ label: "A", value: 1 }],
    };
    part.data.specHash = createThreadGenUISpecHash(part.data.spec);

    const result = validateThreadGenUIPart(
      part,
      createAnalyticsDisplayGenUIValidationContext(),
    );

    expect(result.ok).toBe(false);
    expect(codes(result)).toContain("GENUI_ANALYTICS_ADAPTER_MISSING");
  });

  it("exposes the reserved analytics.display component constant", () => {
    expect(THREAD_GENUI_ANALYTICS_COMPONENT).toBe("analytics.display");
  });
});

function codes(result: ReturnType<typeof validateThreadGenUIPart>) {
  return result.ok
    ? []
    : result.diagnostics.map((diagnostic) => diagnostic.code);
}
