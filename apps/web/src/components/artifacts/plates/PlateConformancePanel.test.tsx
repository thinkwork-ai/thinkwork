import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// The panel calls useQuery even when the summary seam is set (pause=true), so
// a urql client would otherwise be required — stub it to a paused result.
vi.mock("urql", () => ({
  useQuery: () => [{ data: undefined, fetching: false, error: undefined }],
}));

import {
  PlateConformancePanel,
  parseConformanceSummary,
  rateLabel,
  type ConformanceSummary,
} from "./PlateConformancePanel";

afterEach(cleanup);

const SUMMARY: ConformanceSummary = {
  plateSlug: "sales-rep-review",
  reportCount: 10,
  judgedReportCount: 7,
  pendingCount: 2,
  errorCount: 1,
  skippedCount: 0,
  sections: [
    {
      sectionId: "pipeline-health",
      runCount: 10,
      presentCount: 9,
      waivedCount: 0,
      missingCount: 1,
      directiveSuggestedRuns: 10,
      directiveUsedRuns: 6,
      judgedRuns: 7,
      judgedThinRuns: 2,
      assertedNotComputedRuns: 1,
    },
  ],
  analyses: [{ key: "funnel-conversion", declaredRuns: 10, computedRuns: 6 }],
};

function renderPanel(
  props: Partial<React.ComponentProps<typeof PlateConformancePanel>> = {},
) {
  return render(
    <PlateConformancePanel
      tenantId="t1"
      slug="sales-rep-review"
      summary={SUMMARY}
      {...props}
    />,
  );
}

describe("PlateConformancePanel", () => {
  it("renders section rows with rates and run counts (AE2)", () => {
    renderPanel();
    const row = screen.getByTestId("plate-conformance-row-pipeline-health");
    expect(row.textContent).toContain("pipeline-health");
    expect(row.textContent).toContain("90% (9/10)"); // present
    expect(row.textContent).toContain("60% (6/10)"); // directives used
    expect(
      screen.getByTestId("plate-conformance-totals").textContent,
    ).toContain("10 emissions measured");
  });

  it("judge rates present with the explicit judged denominator, never a bare percent", () => {
    renderPanel();
    expect(
      screen.getByTestId("plate-conformance-thin-pipeline-health").textContent,
    ).toBe("2 of 7 judged runs");
  });

  it("zero judged runs → unavailable label, not 0% (AE4)", () => {
    renderPanel({
      summary: {
        ...SUMMARY,
        judgedReportCount: 0,
        sections: [
          { ...SUMMARY.sections[0], judgedRuns: 0, judgedThinRuns: 0 },
        ],
      },
    });
    expect(
      screen.getByTestId("plate-conformance-thin-pipeline-health").textContent,
    ).toBe("Not judged yet");
    expect(
      screen.getByTestId("plate-conformance-totals").textContent,
    ).toContain("quality judging not available yet");
  });

  it("empty corpus → 'not yet measured' state, distinct from 0%", () => {
    renderPanel({ summary: { ...SUMMARY, reportCount: 0, sections: [] } });
    expect(screen.getByTestId("plate-conformance-empty").textContent).toContain(
      "Not yet measured",
    );
  });

  it("query in flight → loading state, no blank panel", () => {
    renderPanel({ summary: undefined, fetching: true });
    expect(screen.getByTestId("plate-conformance-loading")).toBeTruthy();
  });

  it("query error → error message rendered", () => {
    renderPanel({ summary: undefined, errorMessage: "network down" });
    expect(screen.getByTestId("plate-conformance-error").textContent).toContain(
      "network down",
    );
  });

  it("renders analysis computed rates", () => {
    renderPanel();
    const analyses = screen.getByTestId("plate-conformance-analyses");
    expect(analyses.textContent).toContain("funnel-conversion");
    expect(analyses.textContent).toContain("60% (6/10)");
  });
});

describe("parseConformanceSummary", () => {
  it("handles the AWSJSON dual wire shape (strings and objects)", () => {
    const wire = {
      ...SUMMARY,
      sections: JSON.stringify(SUMMARY.sections),
      analyses: JSON.stringify(SUMMARY.analyses),
    };
    expect(parseConformanceSummary(wire)).toEqual(SUMMARY);
    expect(parseConformanceSummary(SUMMARY)).toEqual(SUMMARY);
    expect(parseConformanceSummary(null)).toBeNull();
  });
});

describe("rateLabel", () => {
  it("shows percentage with the raw fraction; em-dash for zero denominators", () => {
    expect(rateLabel(6, 10)).toBe("60% (6/10)");
    expect(rateLabel(0, 3)).toBe("0% (0/3)");
    expect(rateLabel(1, 0)).toBe("—");
  });
});
