import { describe, expect, it } from "vitest";
import type { DocumentPlate } from "@/gql/graphql";
import {
  applyPlatePreviewResult,
  initialPlatePreviewState,
  parsePlate,
  summarizeDirectives,
} from "./plate-support";

function rawPlate(overrides: Partial<DocumentPlate> = {}): DocumentPlate {
  return {
    __typename: "DocumentPlate",
    slug: "report",
    displayName: "Report",
    useFor: "Board reports",
    eyebrow: "Report",
    titleSuffix: "",
    tokensLight: JSON.stringify({ "--bg": "#fff" }),
    tokensDark: JSON.stringify({ "--bg": "#111" }),
    allowedDirectives: null,
    origin: "platform" as DocumentPlate["origin"],
    hidden: false,
    customized: false,
    overrides: null,
    ...overrides,
  } as DocumentPlate;
}

describe("parsePlate", () => {
  it("parses AWSJSON token maps into objects", () => {
    const plate = parsePlate(rawPlate());
    expect(plate.tokensLight).toEqual({ "--bg": "#fff" });
    expect(plate.tokensDark).toEqual({ "--bg": "#111" });
  });

  it("parses the tenant override delta config", () => {
    const plate = parsePlate(
      rawPlate({
        origin: "tenant" as DocumentPlate["origin"],
        overrides: JSON.stringify({
          displayName: "Custom",
          paletteLight: { "--accent": "#f00" },
          allowedDirectives: ["stats"],
        }),
      }),
    );
    expect(plate.origin).toBe("tenant");
    expect(plate.overrides?.paletteLight).toEqual({ "--accent": "#f00" });
    expect(plate.overrides?.allowedDirectives).toEqual(["stats"]);
  });

  it("treats malformed AWSJSON as empty", () => {
    const plate = parsePlate(rawPlate({ tokensLight: "not json" }));
    expect(plate.tokensLight).toEqual({});
  });
});

describe("summarizeDirectives", () => {
  it("reports all components for null", () => {
    expect(summarizeDirectives(null)).toBe("All components");
  });
  it("reports no components for an empty list", () => {
    expect(summarizeDirectives([])).toBe("No components");
  });
  it("joins a subset", () => {
    expect(summarizeDirectives(["stats", "chart"])).toBe("stats, chart");
  });
});

describe("applyPlatePreviewResult (U7 sequence guard)", () => {
  it("applies the first response", () => {
    const next = applyPlatePreviewResult(initialPlatePreviewState, {
      requestId: 1,
      html: "<p>one</p>",
      diagnostics: [],
    });
    expect(next.html).toBe("<p>one</p>");
    expect(next.appliedRequestId).toBe(1);
  });

  it("keeps the later response when an earlier one resolves afterward", () => {
    // Later request (id 2) lands first…
    const afterLater = applyPlatePreviewResult(initialPlatePreviewState, {
      requestId: 2,
      html: "<p>LATER</p>",
      diagnostics: [],
    });
    // …then the stale earlier request (id 1) resolves out of order.
    const afterStale = applyPlatePreviewResult(afterLater, {
      requestId: 1,
      html: "<p>earlier</p>",
      diagnostics: [],
    });
    expect(afterStale.html).toBe("<p>LATER</p>");
    expect(afterStale.appliedRequestId).toBe(2);
  });

  it("keeps the last-good HTML and surfaces diagnostics on a failure", () => {
    const good = applyPlatePreviewResult(initialPlatePreviewState, {
      requestId: 1,
      html: "<p>GOOD</p>",
      diagnostics: [],
    });
    const failed = applyPlatePreviewResult(good, {
      requestId: 2,
      html: null,
      diagnostics: [{ code: "TOKEN", message: "Unknown token --nope" }],
    });
    expect(failed.html).toBe("<p>GOOD</p>");
    expect(failed.diagnostics).toEqual([
      { code: "TOKEN", message: "Unknown token --nope" },
    ]);
  });

  it("clears diagnostics once a good response returns", () => {
    let state = applyPlatePreviewResult(initialPlatePreviewState, {
      requestId: 1,
      html: null,
      diagnostics: [{ code: "X", message: "bad" }],
    });
    state = applyPlatePreviewResult(state, {
      requestId: 2,
      html: "<p>fixed</p>",
      diagnostics: [],
    });
    expect(state.html).toBe("<p>fixed</p>");
    expect(state.diagnostics).toEqual([]);
  });
});
