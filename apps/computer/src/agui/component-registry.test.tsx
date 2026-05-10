import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { AguiCanvasComponent } from "./component-registry";
import type { AguiCanvasComponentEvent } from "./events";

afterEach(cleanup);

describe("AguiCanvasComponent", () => {
  it("renders the registered LastMile risk component for a valid canvas event", () => {
    render(
      <AguiCanvasComponent
        event={canvasEvent({
          component: "lastmile_risk_canvas",
          props: {
            title: "Pipeline exposure",
            summary: "Enterprise opportunities need review.",
            kpis: [{ label: "At-risk ARR", value: 1240000, tone: "risk" }],
            risks: [
              {
                account: "Acme Logistics",
                opportunity: "Renewal expansion",
                stage: "Negotiation",
                amount: 410000,
                daysStale: 18,
                riskLevel: "high",
                nextStep: "Schedule exec review",
              },
            ],
            sources: [{ name: "Salesforce", status: "connected" }],
          },
        })}
      />,
    );

    expect(screen.getByText("Pipeline exposure")).toBeTruthy();
    expect(screen.getByText("Acme Logistics")).toBeTruthy();
    expect(screen.getByText("Salesforce")).toBeTruthy();
  });

  it("rejects unknown component names with diagnostic output", () => {
    render(
      <AguiCanvasComponent
        event={canvasEvent({
          component: "generated_tsx_blob",
          props: {},
        })}
      />,
    );

    expect(screen.getByRole("alert")).toBeTruthy();
    expect(screen.getByText("Unsupported Canvas component")).toBeTruthy();
    expect(screen.getByText("generated_tsx_blob")).toBeTruthy();
  });

  it("rejects invalid props with diagnostic output", () => {
    render(
      <AguiCanvasComponent
        event={canvasEvent({
          component: "lastmile_risk_canvas",
          props: {
            risks: [{ account: "", daysStale: -1 }],
          },
        })}
      />,
    );

    expect(screen.getByRole("alert")).toBeTruthy();
    expect(screen.getByText("Invalid Canvas props")).toBeTruthy();
  });
});

function canvasEvent({
  component,
  props,
}: {
  component: string;
  props: Record<string, unknown>;
}): AguiCanvasComponentEvent {
  return {
    id: `event-${component}`,
    type: "canvas_component",
    source: "chunk",
    seq: 1,
    component,
    props,
  };
}
