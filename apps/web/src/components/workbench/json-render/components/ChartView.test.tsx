import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { ChartView } from "./ChartView";
import { createChartJsonRenderFixture } from "../fixtures";

// recharts renders into an SVG that needs a sized container; in jsdom the
// ResponsiveContainer measures 0x0 and never paints marks. We assert on the
// Card chrome (title/description/footer) + no-throw rather than SVG internals,
// which is the contract that matters for the display-only chart component.

afterEach(() => {
  cleanup();
});

function chartProps(kind: "area" | "bar" | "line" | "pie") {
  return createChartJsonRenderFixture(kind).data.spec.elements.chart
    .props as Parameters<typeof ChartView>[0];
}

describe("ChartView", () => {
  it("renders each chart kind with its title and footer without throwing", () => {
    for (const kind of ["area", "bar", "line", "pie"] as const) {
      const props = chartProps(kind);
      const { unmount } = render(<ChartView {...props} />);

      expect(screen.getByTestId("json-render-chart")).toBeTruthy();
      expect(screen.getByText(props.title as string)).toBeTruthy();
      expect(screen.getByText(props.description as string)).toBeTruthy();
      expect(screen.queryByTestId("json-render-chart-empty")).toBeNull();
      unmount();
    }
  });

  it("shows a benign empty state for a partial frame with no data", () => {
    render(
      <ChartView
        kind="bar"
        title="Streaming chart"
        xKey="week"
        series={[
          { dataKey: "completed", label: "Completed", colorKey: "chart-1" },
        ]}
        data={[]}
      />,
    );

    expect(screen.getByTestId("json-render-chart")).toBeTruthy();
    expect(screen.getByTestId("json-render-chart-empty")).toBeTruthy();
    expect(screen.getByText("Streaming chart")).toBeTruthy();
  });

  it("does not throw when series and data are entirely undefined", () => {
    expect(() =>
      render(<ChartView kind="line" title="Undefined frame" />),
    ).not.toThrow();
    expect(screen.getByTestId("json-render-chart-empty")).toBeTruthy();
  });
});

describe("ChartView width regression (THINK-116 live squish)", () => {
  it("the chart card claims full width — charts have no intrinsic width", () => {
    render(<ChartView kind="bar" title="T" xKey="x" series={[{ dataKey: "y", colorKey: "chart-1" }]} data={[{ x: "a", y: 1 }]} />);
    const card = screen.getByTestId("json-render-chart");
    expect(card.className).toContain("w-full");
    expect(card.className).toContain("min-w-0");
  });
});
