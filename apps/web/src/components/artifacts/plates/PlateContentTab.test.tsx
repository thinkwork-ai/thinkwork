/**
 * Content tab (THINK-188 U5/U6): floor governance affordances, divergence +
 * revert (R13), duplicate detection (AE6), and the analysis picker's
 * directive restriction (AE4's UI half).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ThemeProvider } from "@thinkwork/ui";
import { PlateContentTab } from "./PlateContentTab";
import {
  PLATE_DIRECTIVE_KINDS,
  type AnalysisRowState,
  type SectionRowState,
} from "./plate-support";

afterEach(cleanup);

function renderTab(ui: React.ReactElement) {
  return render(<ThemeProvider>{ui}</ThemeProvider>);
}

const FLOOR: SectionRowState = {
  rowKey: "f1",
  title: "Pipeline Health",
  tier: "required-if-material",
  guidance: "Stage-by-stage funnel.",
  suggestedDirectives: [],
  source: "platform",
  baseline: {
    title: "Pipeline Health",
    guidance: "Stage-by-stage funnel.",
    tier: "required-if-material",
    suggestedDirectives: null,
  },
};

const ADDED: SectionRowState = {
  rowKey: "t1",
  title: "Territory Notes",
  tier: "suggested",
  guidance: "Coverage notes.",
  suggestedDirectives: [],
  source: "tenant",
};

const FLOOR_ANALYSIS: AnalysisRowState = {
  rowKey: "a0",
  key: "pipeline-conversion",
  op: "funnel_conversion",
  presentation: { directive: "chart", chartType: "funnel" },
  source: "platform",
};

describe("PlateContentTab — floor governance (R5 UI half)", () => {
  it("floor rows: title disabled with an aria-described explanation, no remove; additions removable", () => {
    renderTab(
      <PlateContentTab
        sections={[FLOOR, ADDED]}
        analyses={[]}
        isPlatform
        allowedDirectives={null}
        onSectionsChange={vi.fn()}
        onAnalysesChange={vi.fn()}
      />,
    );
    const rows = screen.getAllByTestId(/plate-section-row-/);
    expect(rows).toHaveLength(2);
    const floorTitle = screen.getAllByTestId("plate-section-title")[0];
    expect((floorTitle as HTMLInputElement).disabled).toBe(true);
    const describedBy = floorTitle.getAttribute("aria-describedby");
    expect(describedBy).toBeTruthy();
    expect(document.getElementById(describedBy!)?.textContent).toMatch(
      /can't be removed or retitled/,
    );
    // Exactly one remove control — the addition's.
    expect(screen.getAllByTestId("plate-section-remove")).toHaveLength(1);
  });

  it("R13: a diverged floor guidance shows the paused marker and revert restores the baseline", () => {
    const onChange = vi.fn();
    renderTab(
      <PlateContentTab
        sections={[{ ...FLOOR, guidance: "Our own funnel story." }]}
        analyses={[]}
        isPlatform
        allowedDirectives={null}
        onSectionsChange={onChange}
        onAnalysesChange={vi.fn()}
      />,
    );
    expect(
      screen.getByTestId("plate-section-diverged-guidance").textContent,
    ).toMatch(/Customized/);
    fireEvent.click(screen.getByTestId("plate-section-revert-guidance"));
    const rows = onChange.mock.calls.at(-1)![0] as SectionRowState[];
    expect(rows[0].guidance).toBe("Stage-by-stage funnel.");
  });

  it("AE6: duplicate titles flag the offending rows", () => {
    renderTab(
      <PlateContentTab
        sections={[FLOOR, { ...ADDED, title: "Pipeline Health" }]}
        analyses={[]}
        isPlatform
        allowedDirectives={null}
        onSectionsChange={vi.fn()}
        onAnalysesChange={vi.fn()}
      />,
    );
    expect(screen.getAllByTestId("plate-section-duplicate").length).toBe(2);
  });

  it("empty state renders and Add section appends a tenant row", () => {
    const onChange = vi.fn();
    renderTab(
      <PlateContentTab
        sections={[]}
        analyses={[]}
        isPlatform={false}
        allowedDirectives={null}
        onSectionsChange={onChange}
        onAnalysesChange={vi.fn()}
      />,
    );
    expect(screen.getByTestId("plate-sections-empty")).toBeTruthy();
    fireEvent.click(screen.getByTestId("plate-section-add"));
    const rows = onChange.mock.calls.at(-1)![0] as SectionRowState[];
    expect(rows).toHaveLength(1);
    expect(rows[0].source).toBe("tenant");
  });

  it("move buttons reorder additions only; floor order is fixed", () => {
    const second: SectionRowState = {
      ...ADDED,
      rowKey: "t2",
      title: "Wins",
    };
    const onChange = vi.fn();
    renderTab(
      <PlateContentTab
        sections={[FLOOR, ADDED, second]}
        analyses={[]}
        isPlatform
        allowedDirectives={null}
        onSectionsChange={onChange}
        onAnalysesChange={vi.fn()}
      />,
    );
    // Move the last addition up: swaps within additions, floor stays first.
    fireEvent.click(screen.getAllByTestId("plate-section-move-up")[1]);
    const rows = onChange.mock.calls.at(-1)![0] as SectionRowState[];
    expect(rows.map((r) => r.rowKey)).toEqual(["f1", "t2", "t1"]);
  });
});

describe("PlateAnalysisPicker (U6)", () => {
  it("AE4 (UI half): chart presentations are absent on a chart-restricted plate; templates default to stats", () => {
    const onChange = vi.fn();
    renderTab(
      <PlateContentTab
        sections={[]}
        analyses={[]}
        isPlatform={false}
        allowedDirectives={["stats", "verdict-grid"]}
        onSectionsChange={vi.fn()}
        onAnalysesChange={onChange}
      />,
    );
    fireEvent.click(screen.getByTestId("plate-analysis-add"));
    fireEvent.click(
      screen.getByTestId("plate-analysis-template-funnel_conversion"),
    );
    const rows = onChange.mock.calls.at(-1)![0] as AnalysisRowState[];
    // A chart-default template degrades to stats when charts are excluded.
    expect(rows[0].presentation).toEqual({ directive: "stats" });
  });

  it("floor analyses render locked; added ones carry a derived key", () => {
    const onChange = vi.fn();
    renderTab(
      <PlateContentTab
        sections={[]}
        analyses={[FLOOR_ANALYSIS]}
        isPlatform
        allowedDirectives={null}
        onSectionsChange={vi.fn()}
        onAnalysesChange={onChange}
      />,
    );
    expect(screen.queryByTestId("plate-analysis-remove")).toBeNull();
    fireEvent.click(screen.getByTestId("plate-analysis-add"));
    fireEvent.click(screen.getByTestId("plate-analysis-template-ratio_pct"));
    const rows = onChange.mock.calls.at(-1)![0] as AnalysisRowState[];
    expect(rows).toHaveLength(2);
    expect(rows[1].op).toBe("ratio_pct");
    expect(rows[1].source).toBe("tenant");
  });

  it("move buttons reorder tenant analyses; floor rows stay put and unmovable", () => {
    const onChange = vi.fn();
    const tenant = (rowKey: string, key: string): AnalysisRowState => ({
      rowKey,
      key,
      op: "ratio_pct",
      presentation: { directive: "stats" },
      source: "tenant",
    });
    renderTab(
      <PlateContentTab
        sections={[]}
        analyses={[FLOOR_ANALYSIS, tenant("a1", "first"), tenant("a2", "second")]}
        isPlatform={false}
        allowedDirectives={null}
        onSectionsChange={vi.fn()}
        onAnalysesChange={onChange}
      />,
    );
    // Floor row has no move controls; two tenant rows do.
    const ups = screen.getAllByTestId("plate-analysis-move-up");
    expect(ups).toHaveLength(2);
    fireEvent.click(ups[1]);
    const rows = onChange.mock.calls.at(-1)![0] as AnalysisRowState[];
    expect(rows.map((r) => r.key)).toEqual([
      "pipeline-conversion",
      "second",
      "first",
    ]);
  });
});

describe("Plate directive vocabulary", () => {
  it("includes timeline in the picker option source", () => {
    expect(PLATE_DIRECTIVE_KINDS).toContain("timeline");
  });
});

describe("measured section stats (THINK-189 R8)", () => {
  const MEASURED = {
    "pipeline-health": {
      sectionId: "pipeline-health",
      runCount: 10,
      presentCount: 9,
      waivedCount: 1,
      missingCount: 0,
      directiveSuggestedRuns: 10,
      directiveUsedRuns: 6,
      judgedRuns: 7,
      judgedThinRuns: 2,
      assertedNotComputedRuns: 0,
    },
    "territory-notes": {
      sectionId: "territory-notes",
      runCount: 10,
      presentCount: 4,
      waivedCount: 0,
      missingCount: 6,
      directiveSuggestedRuns: 10,
      directiveUsedRuns: 6,
      judgedRuns: 0,
      judgedThinRuns: 0,
      assertedNotComputedRuns: 0,
    },
  };

  it("suggested sections show usage framing; required sections show presence only", () => {
    renderTab(
      <PlateContentTab
        sections={[FLOOR, ADDED]}
        analyses={[]}
        isPlatform
        allowedDirectives={null}
        measured={MEASURED}
        onSectionsChange={() => {}}
        onAnalysesChange={() => {}}
      />,
    );
    // ADDED is suggested-tier → usage framing.
    const suggested = screen.getByTestId(
      "plate-section-measured-territory-notes",
    );
    expect(suggested.textContent).toContain("present in 4/10 runs");
    expect(suggested.textContent).toContain(
      "suggested widgets used in 6/10 runs",
    );
    // FLOOR is required-if-material → presence context, no usage framing.
    const required = screen.getByTestId(
      "plate-section-measured-pipeline-health",
    );
    expect(required.textContent).toContain("present in 9/10 runs");
    expect(required.textContent).toContain("waived in 1");
    expect(required.textContent).not.toContain("widgets used");
  });

  it("no measured data → no stats line (display only, never fabricated)", () => {
    renderTab(
      <PlateContentTab
        sections={[ADDED]}
        analyses={[]}
        isPlatform={false}
        allowedDirectives={null}
        onSectionsChange={() => {}}
        onAnalysesChange={() => {}}
      />,
    );
    expect(
      screen.queryByTestId("plate-section-measured-territory-notes"),
    ).toBeNull();
  });
});
