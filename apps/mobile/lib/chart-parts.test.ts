import { describe, expect, it } from "vitest";

import {
  chartTableRows,
  formatChartValue,
  parseChartParts,
  svgViewBoxSize,
} from "./chart-parts";

function chartPart(id: string, title = "Revenue") {
  return {
    type: "data-chart",
    id,
    data: {
      type: "bar",
      title,
      qualifier: "USD, per quarter",
      series: [
        { label: "Q1", value: 1200 },
        { label: "Q2", value: 1830.5 },
      ],
      caption: "Q2 pulled ahead.",
    },
  };
}

describe("parseChartParts", () => {
  it("reads chart parts from an array payload", () => {
    const parts = parseChartParts([
      { type: "text", text: "hello" },
      chartPart("c1"),
    ]);
    expect(parts).toHaveLength(1);
    expect(parts[0].id).toBe("c1");
    expect(parts[0].data.title).toBe("Revenue");
  });

  it("reads chart parts from a JSON-string payload", () => {
    const parts = parseChartParts(JSON.stringify([chartPart("c1")]));
    expect(parts.map((p) => p.id)).toEqual(["c1"]);
  });

  it("returns nothing for non-array / unparseable payloads", () => {
    expect(parseChartParts(undefined)).toEqual([]);
    expect(parseChartParts(null)).toEqual([]);
    expect(parseChartParts("not json")).toEqual([]);
    expect(parseChartParts('{"type":"data-chart"}')).toEqual([]);
  });

  it("drops invalid entries", () => {
    const bad = [
      null,
      "string",
      { type: "data-chart" }, // no id, no data
      { type: "data-chart", id: "", data: chartPart("x").data },
      { type: "data-chart", id: "no-data" },
      {
        type: "data-chart",
        id: "bad-type",
        data: { ...chartPart("x").data, type: "pie" },
      },
      {
        type: "data-chart",
        id: "empty-series",
        data: { ...chartPart("x").data, series: [] },
      },
      chartPart("good"),
    ];
    expect(parseChartParts(bad).map((p) => p.id)).toEqual(["good"]);
  });

  it("dedupes by id, keeping the first occurrence", () => {
    const parts = parseChartParts([
      chartPart("dup", "First"),
      chartPart("dup", "Second"),
      chartPart("other"),
    ]);
    expect(parts.map((p) => p.id)).toEqual(["dup", "other"]);
    expect(parts[0].data.title).toBe("First");
  });

  it("caps at 8 charts per message", () => {
    const many = Array.from({ length: 12 }, (_, i) => chartPart(`c${i}`));
    expect(parseChartParts(many)).toHaveLength(8);
  });
});

describe("formatChartValue", () => {
  it("groups thousands and keeps at most two decimals", () => {
    expect(formatChartValue(1200)).toBe("1,200");
    expect(formatChartValue(1234567)).toBe("1,234,567");
    expect(formatChartValue(1830.5)).toBe("1,831");
    expect(formatChartValue(12.345)).toBe("12.35");
    expect(formatChartValue(0)).toBe("0");
    expect(formatChartValue(-4200)).toBe("-4,200");
  });

  it("renders non-finite values as an em dash", () => {
    expect(formatChartValue(Number.NaN)).toBe("—");
  });
});

describe("chartTableRows", () => {
  it("formats each series point into a label/value row", () => {
    const [part] = parseChartParts([chartPart("c1")]);
    expect(chartTableRows(part.data)).toEqual([
      { label: "Q1", value: "1,200" },
      { label: "Q2", value: "1,831" },
    ]);
  });
});

describe("svgViewBoxSize", () => {
  it("reads width and height from the viewBox", () => {
    expect(svgViewBoxSize('<svg viewBox="0 0 340 220" role="img">')).toEqual({
      width: 340,
      height: 220,
    });
  });

  it("returns null when the viewBox is missing or malformed", () => {
    expect(svgViewBoxSize("<svg>")).toBeNull();
    expect(svgViewBoxSize('<svg viewBox="0 0 340">')).toBeNull();
    expect(svgViewBoxSize('<svg viewBox="0 0 0 220">')).toBeNull();
    expect(svgViewBoxSize('<svg viewBox="a b c d">')).toBeNull();
  });
});
