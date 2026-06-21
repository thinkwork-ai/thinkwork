import { cleanup, render, screen } from "@testing-library/react";
import {
  createAnalyticsDisplayFixture,
  createCrmOpportunityValueByOwnerFixture,
  safeDisplayValue,
} from "@thinkwork/analytics-display";
import {
  createAnalyticsDisplayGenUIPart,
  createThreadGenUISpecHash,
} from "@thinkwork/genui";
import { afterEach, describe, expect, it } from "vitest";

import { AnalyticsDisplayPart } from "./AnalyticsDisplayPart";

afterEach(cleanup);

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
        .querySelector("[data-slot='chart']"),
    ).toBeTruthy();
    expect(screen.getAllByText("High Priority").length).toBeGreaterThan(0);
    expect(screen.getByText("Daily Detail")).toBeTruthy();
    expect(screen.getByLabelText("Applied filters").textContent).toContain(
      "Priority",
    );
    expect(screen.getByText(/Source: Zendesk/)).toBeTruthy();
  });

  it("renders a CRM opportunity chart payload through the analytics adapter", () => {
    const part = createAnalyticsDisplayGenUIPart({
      id: "genui:analytics:crm-owner-value",
      payload: createCrmOpportunityValueByOwnerFixture(),
    });

    render(<AnalyticsDisplayPart data={part.data} />);

    expect(screen.getByText("Opportunity Value by Owner")).toBeTruthy();
    expect(screen.getByText("$184,000")).toBeTruthy();
    expect(screen.getByText("Open Opportunity Value")).toBeTruthy();
    expect(
      screen
        .getByTestId("analytics-display-element-chart")
        .querySelector("[data-slot='chart']"),
    ).toBeTruthy();
    expect(screen.getAllByText("Maya Chen").length).toBeGreaterThan(0);
    expect(screen.getByText(/Source: Twenty CRM/)).toBeTruthy();
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
