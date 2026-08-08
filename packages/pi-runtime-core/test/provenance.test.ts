import { describe, expect, it } from "vitest";

import {
  PROVENANCE_PAIR_SCAN_CAP,
  buildProvenanceCorpus,
  decideProvenance,
  extractNumericTokens,
  formatUntracedValues,
  partitionByProvenance,
  tracesToCorpus,
} from "../src/provenance.js";

describe("extractNumericTokens", () => {
  it("pulls plain, decimal, negative and comma-grouped numbers", () => {
    expect(extractNumericTokens("rows: 12, -3.5 and 1,204 total")).toEqual([
      12, -3.5, 1204,
    ]);
  });

  it("ignores numbers glued to identifiers", () => {
    expect(extractNumericTokens("Q3 id_42 2xRevenue")).toEqual([]);
  });

  it("reads a percent as its bare number", () => {
    expect(extractNumericTokens("conversion was 18% this quarter")).toEqual([
      18,
    ]);
  });
});

describe("buildProvenanceCorpus", () => {
  it("dedupes across sources and stringifies objects", () => {
    const corpus = buildProvenanceCorpus([
      { rows: [{ amount: 120 }, { amount: 80 }] },
      "restating 120 and adding 30",
    ]);
    expect(corpus).toEqual([120, 80, 30]);
  });
});

describe("tracesToCorpus", () => {
  const corpus = [120, 80, 30, 12];

  it("matches exactly", () => {
    expect(tracesToCorpus(120, corpus)).toBe(true);
  });

  it("matches after rounding to the presented precision", () => {
    expect(tracesToCorpus(12, [12.4])).toBe(true);
    expect(tracesToCorpus(12.4, [12.42])).toBe(true);
    expect(tracesToCorpus(13, [12.4])).toBe(false);
  });

  it("matches a percentage of two corpus numbers", () => {
    // 30 of 120 = 25%
    expect(tracesToCorpus(25, corpus)).toBe(true);
    // 12 of 120 = 10%
    expect(tracesToCorpus(10, corpus)).toBe(true);
  });

  it("matches deltas, sums and ratios", () => {
    expect(tracesToCorpus(40, corpus)).toBe(true); // 120 - 80
    expect(tracesToCorpus(200, corpus)).toBe(true); // 120 + 80
    expect(tracesToCorpus(1.5, corpus)).toBe(true); // 120 / 80
  });

  it("honours the 0.5% derived tolerance at its edges", () => {
    // 120/80 = 1.5; 1.5069 is ~0.46% off (inside), 1.52 is ~1.3% off (outside)
    expect(tracesToCorpus(1.5069, [120, 80])).toBe(true);
    expect(tracesToCorpus(1.52, [120, 80])).toBe(false);
  });

  it("matches a power-of-ten rescaling of a corpus number", () => {
    // dollars charted as $M, rounded to the chart's precision
    expect(tracesToCorpus(28.7, [28712345])).toBe(true);
    // counts charted as thousands
    expect(tracesToCorpus(6.2, [6155])).toBe(true);
    // fraction charted as basis points
    expect(tracesToCorpus(125, [0.0125])).toBe(true);
    // scaling never invents digits: 29.4 is not a rescaling of 28,712,345
    expect(tracesToCorpus(29.4, [28712345])).toBe(false);
    // zero never scale-matches
    expect(tracesToCorpus(0, [28712345])).toBe(false);
  });

  it("rejects an invented number", () => {
    expect(tracesToCorpus(987654, corpus)).toBe(false);
  });

  it("never traces against an empty corpus", () => {
    expect(tracesToCorpus(1, [])).toBe(false);
  });

  it("caps the derived pair scan for oversized corpora", () => {
    // 1..400 as the corpus; the derivation 401 = 400 + 1 lives beyond the cap
    // so it must NOT trace, while 3 = 1 + 2 (inside the cap) does.
    const big = Array.from({ length: 400 }, (_, i) => i + 1);
    expect(big.length).toBeGreaterThan(PROVENANCE_PAIR_SCAN_CAP);
    expect(tracesToCorpus(3, big)).toBe(true);
    expect(tracesToCorpus(100000.5, big)).toBe(false);
    // Direct matches still consult the WHOLE corpus, cap or no cap.
    expect(tracesToCorpus(399, big)).toBe(true);
  });
});

describe("decideProvenance", () => {
  it("accepts when there is nothing to check", () => {
    const decision = decideProvenance({
      values: [],
      corpus: [],
      alreadyRejected: false,
    });
    expect(decision).toEqual({
      decision: "accept",
      reason: "traced",
      untraced: [],
    });
  });

  it("rejects an empty corpus as no_data_this_turn", () => {
    expect(
      decideProvenance({
        values: [1, 2],
        corpus: [],
        alreadyRejected: false,
      }),
    ).toEqual({ decision: "reject", reason: "no_data_this_turn" });
  });

  it("accepts when at most half the values are untraceable", () => {
    const decision = decideProvenance({
      values: [120, 80, 999],
      corpus: [120, 80],
      alreadyRejected: false,
    });
    expect(decision.decision).toBe("accept");
    expect(decision.reason).toBe("traced");
  });

  it("rejects when most values are untraceable", () => {
    const decision = decideProvenance({
      values: [120, 999, 998],
      corpus: [120],
      alreadyRejected: false,
    });
    expect(decision).toMatchObject({
      decision: "reject",
      reason: "untraced",
      untraced: [999, 998],
      totalValues: 3,
    });
  });

  it("accepts post-rejection so the repair loop terminates", () => {
    for (const corpus of [[] as number[], [120]]) {
      const decision = decideProvenance({
        values: [999, 998],
        corpus,
        alreadyRejected: true,
      });
      expect(decision.decision).toBe("accept");
      expect(decision.reason).toBe("post_rejection");
    }
  });
});

describe("partitionByProvenance / formatUntracedValues", () => {
  it("preserves order and truncates the report to five", () => {
    const { traced, untraced } = partitionByProvenance(
      [120, 901, 902, 903, 904, 905, 906],
      [120],
    );
    expect(traced).toEqual([120]);
    expect(formatUntracedValues(untraced)).toBe("901, 902, 903, 904, 905");
  });
});
