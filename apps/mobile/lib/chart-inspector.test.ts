import { describe, expect, it } from "vitest";
import { HOUSE_DARK, HOUSE_LIGHT } from "@thinkwork/chart-renderer";
import type { ChartDirectiveData } from "@thinkwork/chart-renderer";
import {
  hueRamp,
  inspectorKindFor,
  sliceShare,
  toCartesianData,
  toPieData,
} from "./chart-inspector";

function chart(over: Partial<ChartDirectiveData> = {}): ChartDirectiveData {
  return {
    type: "bar",
    title: "Deals created by month",
    series: [
      { label: "Mar", value: 14 },
      { label: "Apr", value: 22 },
      { label: "May", value: 18 },
    ],
    ...over,
  };
}

describe("inspectorKindFor", () => {
  it("maps bar to the Cartesian bar treatment", () => {
    expect(inspectorKindFor("bar")).toBe("cartesian-bar");
  });

  it("maps line and sparkline to the same Cartesian line treatment", () => {
    expect(inspectorKindFor("line")).toBe("cartesian-line");
    expect(inspectorKindFor("sparkline")).toBe("cartesian-line");
  });

  it("maps donut to the polar pie treatment", () => {
    expect(inspectorKindFor("donut")).toBe("polar-pie");
  });

  it("falls back to the enlarged house SVG for kinds VNXL can't draw", () => {
    expect(inspectorKindFor("funnel")).toBe("svg-detail");
    expect(inspectorKindFor("meter")).toBe("svg-detail");
    expect(inspectorKindFor("stat-strip")).toBe("svg-detail");
  });
});

describe("toCartesianData", () => {
  it("indexes the series and carries the label through", () => {
    expect(toCartesianData(chart())).toEqual([
      { x: 0, y: 14, label: "Mar" },
      { x: 1, y: 22, label: "Apr" },
      { x: 2, y: 18, label: "May" },
    ]);
  });

  it("collapses non-finite values to zero so the domain survives", () => {
    const rows = toCartesianData(
      chart({
        series: [
          { label: "a", value: Number.NaN },
          { label: "b", value: Number.POSITIVE_INFINITY },
          { label: "c", value: 3 },
        ],
      }),
    );
    expect(rows.map((r) => r.y)).toEqual([0, 0, 3]);
  });

  it("returns an empty dataset for an empty series", () => {
    expect(toCartesianData(chart({ series: [] }))).toEqual([]);
  });
});

describe("sliceShare", () => {
  const series = [
    { label: "West", value: 18 },
    { label: "East", value: 12 },
    { label: "Central", value: 8 },
    { label: "International", value: 4 },
  ];

  it("rounds to whole percent like the house renderer", () => {
    // 18/42 = 42.857% -> 43
    expect(sliceShare(series, 0)).toBe(43);
    // 12/42 = 28.571% -> 29
    expect(sliceShare(series, 1)).toBe(29);
    // 8/42 = 19.047% -> 19
    expect(sliceShare(series, 2)).toBe(19);
    // 4/42 = 9.52% -> 10
    expect(sliceShare(series, 3)).toBe(10);
  });

  it("returns 0 rather than dividing by a zero total", () => {
    expect(
      sliceShare(
        [
          { label: "a", value: 0 },
          { label: "b", value: 0 },
        ],
        0,
      ),
    ).toBe(0);
  });

  it("treats negative values as zero, both per-slice and in the total", () => {
    const mixed = [
      { label: "a", value: -5 },
      { label: "b", value: 10 },
    ];
    expect(sliceShare(mixed, 0)).toBe(0);
    expect(sliceShare(mixed, 1)).toBe(100);
  });

  it("returns 0 for an out-of-range index and an empty series", () => {
    expect(sliceShare(series, 99)).toBe(0);
    expect(sliceShare([], 0)).toBe(0);
  });
});

describe("hueRamp", () => {
  it("follows the house renderer's accent -> info -> warn -> bad order", () => {
    expect(hueRamp(HOUSE_DARK)).toEqual([
      HOUSE_DARK.accent,
      HOUSE_DARK.info,
      HOUSE_DARK.warn,
      HOUSE_DARK.bad,
    ]);
  });
});

describe("toPieData", () => {
  const donut = chart({
    type: "donut",
    series: [
      { label: "West", value: 18 },
      { label: "East", value: 12 },
      { label: "Central", value: 8 },
      { label: "International", value: 4 },
    ],
  });

  it("carries label, value and share for each slice", () => {
    expect(toPieData(donut)).toEqual([
      { label: "West", value: 18, color: HOUSE_DARK.accent, share: 43 },
      { label: "East", value: 12, color: HOUSE_DARK.info, share: 29 },
      { label: "Central", value: 8, color: HOUSE_DARK.warn, share: 19 },
      { label: "International", value: 4, color: HOUSE_DARK.bad, share: 10 },
    ]);
  });

  it("cycles the four-hue ramp for a fifth slice", () => {
    const wide = chart({
      type: "donut",
      series: [
        { label: "a", value: 1 },
        { label: "b", value: 1 },
        { label: "c", value: 1 },
        { label: "d", value: 1 },
        { label: "e", value: 1 },
      ],
    });
    expect(toPieData(wide, HOUSE_LIGHT).map((s) => s.color)).toEqual([
      HOUSE_LIGHT.accent,
      HOUSE_LIGHT.info,
      HOUSE_LIGHT.warn,
      HOUSE_LIGHT.bad,
      HOUSE_LIGHT.accent,
    ]);
  });

  it("is zero-total safe", () => {
    const empty = chart({
      type: "donut",
      series: [
        { label: "a", value: 0 },
        { label: "b", value: 0 },
      ],
    });
    expect(toPieData(empty).map((s) => s.share)).toEqual([0, 0]);
  });
});
