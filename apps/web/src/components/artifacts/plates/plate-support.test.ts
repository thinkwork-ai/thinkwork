import { describe, expect, it } from "vitest";
import type { DocumentPlate } from "@/gql/graphql";
import {
  applyPlatePreviewResult,
  initialPlatePreviewState,
  parsePlate,
  summarizeDirectives,
  buildContractPayload,
  duplicateSectionRowKeys,
  headingSlugClient,
  parseContractSections,
  PLATE_ANALYSIS_TEMPLATES,
  sectionRowsFromContract,
  type SectionRowState,
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

describe("content contract helpers (THINK-188)", () => {
  const floorRow = (over: Partial<SectionRowState> = {}): SectionRowState => ({
    rowKey: "r1",
    title: "Pipeline Health",
    tier: "required-if-material",
    guidance: "Stage-by-stage funnel.",
    suggestedDirectives: [{ kind: "chart", chartType: "funnel" }],
    source: "platform",
    baseline: {
      title: "Pipeline Health",
      guidance: "Stage-by-stage funnel.",
      tier: "required-if-material",
      suggestedDirectives: [{ kind: "chart", chartType: "funnel" }],
    },
    ...over,
  });
  const addedRow = (over: Partial<SectionRowState> = {}): SectionRowState => ({
    rowKey: "r2",
    title: "Territory Notes",
    tier: "suggested",
    guidance: "Coverage notes.",
    suggestedDirectives: [],
    source: "tenant",
    ...over,
  });

  it("headingSlugClient matches the server transform on the pinned cases", () => {
    // Same literals pinned server-side (KTD6) — drift breaks one side loudly.
    expect(headingSlugClient("Pipeline Health")).toBe("pipeline-health");
    expect(headingSlugClient("Quota Attainment")).toBe("quota-attainment");
    expect(headingSlugClient("  Q3 — Wins & Losses!  ")).toBe("q3-wins-losses");
    expect(headingSlugClient("")).toBe("section");
    expect(headingSlugClient("A".repeat(80))).toHaveLength(64);
  });

  it("duplicateSectionRowKeys flags title collisions across floor and additions (AE6)", () => {
    const rows = [floorRow(), addedRow({ title: "Pipeline Health" })];
    const dupes = duplicateSectionRowKeys(rows);
    expect(dupes.has("r1")).toBe(true);
    expect(dupes.has("r2")).toBe(true);
    expect(duplicateSectionRowKeys([floorRow(), addedRow()]).size).toBe(0);
  });

  it("buildContractPayload (platform): only diverged floor fields become overrides; additions ride sections", () => {
    const rows = [
      floorRow({ guidance: "Our fiscal-year funnel story.", tier: "required" }),
      floorRow({
        rowKey: "r3",
        title: "Coaching Notes",
        baseline: {
          title: "Coaching Notes",
          guidance: "Behaviors to keep or change.",
          tier: "required",
          suggestedDirectives: null,
        },
        guidance: "Behaviors to keep or change.",
        tier: "required",
        suggestedDirectives: [],
      }),
      addedRow(),
    ];
    const payload = buildContractPayload(rows, [], true);
    expect(JSON.parse(payload.sectionOverrides!)).toEqual({
      "pipeline-health": {
        guidance: "Our fiscal-year funnel story.",
        tier: "required",
      },
    });
    expect(JSON.parse(payload.sections!)).toEqual([
      {
        id: "territory-notes",
        title: "Territory Notes",
        tier: "suggested",
        guidance: "Coverage notes.",
      },
    ]);
  });

  it("buildContractPayload (tenant): full contract, no overrides key", () => {
    const payload = buildContractPayload(
      [addedRow()],
      [
        {
          rowKey: "a1",
          key: "win-rate",
          op: "ratio_pct",
          presentation: { directive: "stats" },
          source: "tenant",
        },
      ],
      false,
    );
    expect(payload.sectionOverrides).toBeUndefined();
    expect(JSON.parse(payload.sections!)).toHaveLength(1);
    expect(JSON.parse(payload.analyses!)).toEqual([
      {
        key: "win-rate",
        op: "ratio_pct",
        presentation: { directive: "stats" },
      },
    ]);
  });

  it("wipe-guard shape: an untouched platform contract still yields explicit (empty) payload keys", () => {
    const payload = buildContractPayload([floorRow()], [], true);
    expect(payload.sections).toBe("[]");
    expect(payload.analyses).toBe("[]");
    expect(JSON.parse(payload.sectionOverrides!)).toEqual({});
  });

  it("catalog parity pin: templates cover exactly the six registry ops", () => {
    expect(PLATE_ANALYSIS_TEMPLATES.map((t) => t.op)).toEqual([
      "funnel_conversion",
      "ratio_pct",
      "variance_vs_prior",
      "group_count",
      "top_n",
      "trend",
    ]);
  });

  it("parseContractSections degrades junk to [] and keeps annotations", () => {
    expect(parseContractSections(null)).toEqual([]);
    expect(parseContractSections("not json")).toEqual([]);
    expect(parseContractSections('{"a":1}')).toEqual([]);
    const parsed = parseContractSections(
      JSON.stringify([
        {
          id: "pipeline-health",
          title: "Pipeline Health",
          tier: "required-if-material",
          guidance: "g",
          source: "platform",
          overridden: { guidance: true },
          platformBaseline: {
            guidance: "orig",
            tier: "required-if-material",
            suggestedDirectives: null,
          },
        },
        { id: "bad" },
      ]),
    );
    expect(parsed).toHaveLength(1);
    expect(parsed[0].overridden).toEqual({ guidance: true });
    expect(parsed[0].platformBaseline?.guidance).toBe("orig");
  });

  it("sectionRowsFromContract keeps floor baselines; ownAll strips them (clone)", () => {
    const contract = parseContractSections(
      JSON.stringify([
        {
          id: "pipeline-health",
          title: "Pipeline Health",
          tier: "required-if-material",
          guidance: "g",
          source: "platform",
        },
      ]),
    );
    const floorRows = sectionRowsFromContract(contract, false);
    expect(floorRows[0].source).toBe("platform");
    expect(floorRows[0].baseline?.title).toBe("Pipeline Health");
    const owned = sectionRowsFromContract(contract, true);
    expect(owned[0].source).toBe("tenant");
    expect(owned[0].baseline).toBeUndefined();
  });
});
