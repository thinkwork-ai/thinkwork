import { describe, expect, it } from "vitest";

import { validateChartMessagePart } from "./part.js";
import { validateChartDirectiveData } from "./validate.js";

const funnel = {
  type: "funnel",
  title: "Pipeline by stage",
  qualifier: "open deals",
  series: [
    { label: "Contacted", value: 12 },
    { label: "Qualified", value: 8 },
    { label: "Negotiation", value: 4 },
    { label: "Won", value: 3 },
  ],
  caption: "Numo ($50k) is the highest-value deal in Negotiation",
};

describe("validateChartDirectiveData", () => {
  it("accepts a well-formed funnel and trims the title", () => {
    const result = validateChartDirectiveData({
      ...funnel,
      title: "  Pipeline by stage ",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.title).toBe("Pipeline by stage");
      expect(result.data.series).toHaveLength(4);
      expect(result.data.caption).toBe(funnel.caption);
    }
  });

  it("rejects unknown types with the supported-type list", () => {
    const result = validateChartDirectiveData({ ...funnel, type: "area" });
    expect(result).toMatchObject({ ok: false });
    if (!result.ok) expect(result.error).toContain("Supported types:");
  });

  it("rejects empty, oversized, and malformed series", () => {
    expect(validateChartDirectiveData({ ...funnel, series: [] }).ok).toBe(
      false,
    );
    expect(
      validateChartDirectiveData({
        ...funnel,
        series: Array.from({ length: 25 }, (_, i) => ({
          label: `p${i}`,
          value: i,
        })),
      }).ok,
    ).toBe(false);
    const bad = validateChartDirectiveData({
      ...funnel,
      series: [
        { label: "ok", value: 1 },
        { label: "nope", value: Infinity },
      ],
    });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.error).toContain("series[1]");
  });

  it("rejects non-finite max and non-object roots", () => {
    expect(validateChartDirectiveData({ ...funnel, max: NaN }).ok).toBe(false);
    expect(validateChartDirectiveData("nope").ok).toBe(false);
    expect(validateChartDirectiveData(null).ok).toBe(false);
    expect(validateChartDirectiveData([funnel]).ok).toBe(false);
  });
});

describe("validateChartMessagePart", () => {
  it("accepts a well-formed part", () => {
    const part = validateChartMessagePart({
      type: "data-chart",
      id: "chart-1",
      data: funnel,
    });
    expect(part).not.toBeNull();
    expect(part?.id).toBe("chart-1");
    expect(part?.data.type).toBe("funnel");
  });

  it("rejects wrong type tag, blank id, and invalid data", () => {
    expect(
      validateChartMessagePart({
        type: "data-json-render",
        id: "x",
        data: funnel,
      }),
    ).toBeNull();
    expect(
      validateChartMessagePart({ type: "data-chart", id: "  ", data: funnel }),
    ).toBeNull();
    expect(
      validateChartMessagePart({
        type: "data-chart",
        id: "x",
        data: { ...funnel, series: [] },
      }),
    ).toBeNull();
    expect(validateChartMessagePart(null)).toBeNull();
  });
});
