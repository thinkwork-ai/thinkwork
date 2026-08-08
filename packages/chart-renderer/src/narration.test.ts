import { describe, expect, it } from "vitest";

import { chartFitsWidth } from "./fitness.js";
import { chartNarration } from "./narration.js";
import type { ChartDirectiveData } from "./types.js";

const funnel: ChartDirectiveData = {
  type: "funnel",
  title: "Pipeline by stage",
  qualifier: "open deals",
  series: [
    { label: "Contacted", value: 12 },
    { label: "Qualified", value: 8 },
    { label: "Won", value: 3 },
  ],
  caption: "Qualification is the biggest drop-off.",
};

describe("chartNarration", () => {
  it("narrates a funnel with stage list, conversion, and takeaway", () => {
    const text = chartNarration(funnel);
    expect(text).toContain("Funnel chart: Pipeline by stage.");
    expect(text).toContain("open deals.");
    expect(text).toContain("3 stages: Contacted 12, Qualified 8, Won 3.");
    expect(text).toContain("Won is 25% of Contacted.");
    expect(text).toContain("Takeaway: Qualification is the biggest drop-off.");
  });

  it("narrates a donut with total and largest share", () => {
    const text = chartNarration({
      type: "donut",
      title: "Deals by region",
      series: [
        { label: "West", value: 6 },
        { label: "East", value: 4 },
      ],
    });
    expect(text).toContain("Donut chart: Deals by region.");
    expect(text).toContain("Total 10; largest share West at 60%.");
  });

  it("narrates a meter against its max and defaults max to 100", () => {
    expect(
      chartNarration({
        type: "meter",
        title: "Quota",
        series: [{ label: "Attained", value: 82 }],
      }),
    ).toContain("Attained: 82 of 100.");
    expect(
      chartNarration({
        type: "meter",
        title: "Quota",
        series: [{ label: "Attained", value: 8200 }],
        max: 10000,
      }),
    ).toContain("Attained: 8,200 of 10,000.");
  });

  it("summarizes long series by ends and extremes", () => {
    const text = chartNarration({
      type: "line",
      title: "Daily active",
      series: Array.from({ length: 12 }, (_, i) => ({
        label: `D${i + 1}`,
        value: i === 5 ? 99 : i + 1,
      })),
    });
    expect(text).toContain("12 points from D1 1 to D12 12");
    expect(text).toContain("high D6 99");
  });
});

describe("chartFitsWidth", () => {
  const series = (n: number) =>
    Array.from({ length: n }, (_, i) => ({ label: `p${i}`, value: i + 1 }));

  it("vetoes crowded donuts and stat-strips at phone width", () => {
    expect(
      chartFitsWidth({ type: "donut", title: "t", series: series(9) }, 360),
    ).toBe(false);
    expect(
      chartFitsWidth({ type: "donut", title: "t", series: series(8) }, 360),
    ).toBe(true);
    expect(
      chartFitsWidth(
        { type: "stat-strip", title: "t", series: series(9) },
        360,
      ),
    ).toBe(false);
  });

  it("keeps lines, sparklines, and meters at any sane width", () => {
    expect(
      chartFitsWidth({ type: "line", title: "t", series: series(24) }, 320),
    ).toBe(true);
    expect(
      chartFitsWidth({ type: "meter", title: "t", series: series(1) }, 320),
    ).toBe(true);
  });

  it("vetoes everything below 200 units", () => {
    expect(
      chartFitsWidth({ type: "line", title: "t", series: series(3) }, 199),
    ).toBe(false);
  });

  it("caps bar count by width and funnel stages at 12", () => {
    expect(
      chartFitsWidth({ type: "bar", title: "t", series: series(16) }, 360),
    ).toBe(false);
    expect(
      chartFitsWidth({ type: "funnel", title: "t", series: series(13) }, 720),
    ).toBe(false);
    expect(
      chartFitsWidth({ type: "funnel", title: "t", series: series(6) }, 360),
    ).toBe(true);
  });
});
