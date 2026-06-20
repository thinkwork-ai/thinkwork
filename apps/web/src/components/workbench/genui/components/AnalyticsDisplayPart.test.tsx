import { render, screen } from "@testing-library/react";
import {
  createAnalyticsDisplayFixture,
  safeDisplayValue,
} from "@thinkwork/analytics-display";
import {
  createAnalyticsDisplayGenUIPart,
  createThreadGenUISpecHash,
} from "@thinkwork/genui";
import { describe, expect, it } from "vitest";

import { AnalyticsDisplayPart } from "./AnalyticsDisplayPart";

describe("AnalyticsDisplayPart", () => {
  it("renders an inline analytical chart payload in Thread density", () => {
    const part = createAnalyticsDisplayGenUIPart({
      id: "genui:analytics:support-volume",
      payload: createAnalyticsDisplayFixture(),
    });

    render(<AnalyticsDisplayPart data={part.data} />);

    expect(screen.getByTestId("analytics-display-part")).toBeTruthy();
    expect(screen.getByText("Support Volume")).toBeTruthy();
    expect(
      screen
        .getByTestId("analytics-display-element-chart")
        .textContent?.includes("thinkwork.ui.ChartContainer"),
    ).toBe(true);
    expect(
      screen
        .getByTestId("analytics-display-element-table")
        .textContent?.includes("8 row preview"),
    ).toBe(true);
    expect(screen.getByLabelText("Applied filters").textContent).toContain(
      "Priority",
    );
    expect(screen.getByText(/Source: Zendesk/)).toBeTruthy();
  });

  it("renders a compact fallback for invalid analytical payloads", () => {
    const part = createAnalyticsDisplayGenUIPart({
      id: "genui:analytics:invalid",
      payload: createAnalyticsDisplayFixture(),
    });
    part.data.spec.elements.analytics.props = {
      ...part.data.spec.elements.analytics.props,
      dashboardId: "dash_123",
    };
    part.data.specHash = createThreadGenUISpecHash(part.data.spec);

    render(<AnalyticsDisplayPart data={part.data} />);

    expect(screen.getByTestId("analytics-display-fallback")).toBeTruthy();
    expect(screen.getByText("Unsupported analytics")).toBeTruthy();
  });

  it("escapes snapshot values rendered in summary lines", () => {
    const payload = createAnalyticsDisplayFixture();
    payload.data.rows[0].total = `<script>alert("x")</script>`;
    const part = createAnalyticsDisplayGenUIPart({
      id: "genui:analytics:safe-labels",
      payload,
    });

    render(<AnalyticsDisplayPart data={part.data} />);

    expect(
      screen.getByText(
        `Total Tickets: ${safeDisplayValue(`<script>alert("x")</script>`)}`,
      ),
    ).toBeTruthy();
    expect(screen.queryByText(`<script>alert("x")</script>`)).toBeNull();
  });
});
