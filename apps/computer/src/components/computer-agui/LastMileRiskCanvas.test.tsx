import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { LastMileRiskCanvas } from "./LastMileRiskCanvas";

afterEach(cleanup);

describe("LastMileRiskCanvas", () => {
  it("renders KPIs, risk rows, and source status", () => {
    render(
      <LastMileRiskCanvas
        title="LastMile risk review"
        summary="Three stale enterprise deals need attention."
        kpis={[
          {
            label: "At-risk ARR",
            value: 1450000,
            detail: "3 opportunities",
            tone: "risk",
          },
          { label: "Healthy expansion", value: "2 deals", tone: "success" },
        ]}
        risks={[
          {
            account: "Northstar Freight",
            opportunity: "Fleet rollout",
            stage: "Proposal",
            amount: 560000,
            daysStale: 21,
            riskLevel: "high",
            nextStep: "Confirm buying committee",
          },
          {
            account: "Harbor Foods",
            stage: "Discovery",
            amount: 190000,
            daysStale: 9,
            riskLevel: "medium",
          },
        ]}
        sources={[
          {
            name: "Salesforce",
            status: "connected",
            recordCount: 42,
          },
          {
            name: "Gmail activity",
            status: "stale",
            detail: "Last sync was more than 7 days ago.",
          },
        ]}
      />,
    );

    expect(screen.getByText("LastMile risk review")).toBeTruthy();
    expect(screen.getByText("At-risk ARR")).toBeTruthy();
    expect(screen.getByText("1.5M")).toBeTruthy();
    expect(screen.getByText("Northstar Freight")).toBeTruthy();
    expect(screen.getByText("Confirm buying committee")).toBeTruthy();
    expect(screen.getByText("Salesforce")).toBeTruthy();
    expect(screen.getByText("Gmail activity")).toBeTruthy();
  });

  it("handles empty and partial source data without layout collapse", () => {
    render(
      <LastMileRiskCanvas
        summary="Waiting on pipeline data."
        kpis={[]}
        risks={[]}
        sources={[]}
      />,
    );

    expect(screen.getByText("LastMile pipeline risk")).toBeTruthy();
    expect(screen.getByText("Waiting on pipeline data.")).toBeTruthy();
    expect(screen.getByText("No pipeline risks reported.")).toBeTruthy();
    expect(screen.getByText("No source status reported yet.")).toBeTruthy();
  });
});
