import { describe, expect, it } from "vitest";
import {
  OKF_WIKI_NAVIGATOR_CORPUS,
  OKF_WIKI_NAVIGATOR_CRITERION_IDS,
  OKF_WIKI_NAVIGATOR_PROVIDER_IDS,
  assertValidOkfWikiNavigatorCorpus,
  buildOkfWikiNavigatorComparisonReport,
  okfWikiNavigatorHardRequiredProviders,
  type OkfWikiNavigatorCaseComparison,
  type OkfWikiNavigatorCriterionId,
  type OkfWikiNavigatorProviderId,
} from "./okf-wiki-navigator-corpus.js";

const verdicts = Object.fromEntries(
  OKF_WIKI_NAVIGATOR_CRITERION_IDS.map((id) => [id, "unknown"]),
) as Record<OkfWikiNavigatorCriterionId, "unknown">;

function providerRows(
  overrides: Partial<Record<OkfWikiNavigatorProviderId, string>> = {},
): OkfWikiNavigatorCaseComparison["providerResults"] {
  return OKF_WIKI_NAVIGATOR_PROVIDER_IDS.map((providerId) => ({
    providerId,
    status: (overrides[providerId] ?? "ok") as
      | "ok"
      | "empty"
      | "skipped"
      | "degraded"
      | "failed",
  }));
}

function comparison(
  overrides: Partial<OkfWikiNavigatorCaseComparison> = {},
): OkfWikiNavigatorCaseComparison {
  const testCase = OKF_WIKI_NAVIGATOR_CORPUS.cases[0];
  return {
    caseId: testCase.id,
    query: testCase.question,
    providerResults: providerRows(),
    criteria: { ...verdicts, trace_completeness: "pass" },
    hybridEvidenceSources: ["db_wiki", "okf_navigator"],
    ...overrides,
  };
}

describe("OKF Wiki Navigator comparison corpus", () => {
  it("ships a valid five-provider, seven-criterion corpus", () => {
    assertValidOkfWikiNavigatorCorpus(OKF_WIKI_NAVIGATOR_CORPUS);

    expect(OKF_WIKI_NAVIGATOR_CORPUS.providers.map((p) => p.id)).toEqual(
      OKF_WIKI_NAVIGATOR_PROVIDER_IDS,
    );
    expect(OKF_WIKI_NAVIGATOR_CORPUS.criteria.map((c) => c.id)).toEqual(
      OKF_WIKI_NAVIGATOR_CRITERION_IDS,
    );
    expect(okfWikiNavigatorHardRequiredProviders()).toEqual([
      "db_wiki",
      "okf_navigator",
      "hybrid_db_okf",
    ]);
  });

  it("covers source redaction, backlinks, freshness, and prompt injection", () => {
    const allText = JSON.stringify(OKF_WIKI_NAVIGATOR_CORPUS).toLowerCase();

    expect(allText).toContain("backlink");
    expect(allText).toContain("freshness");
    expect(allText).toContain("redaction");
    expect(allText).toContain("ignore previous instructions");
  });

  it("builds a report only when every provider has a status row", () => {
    const valid = buildOkfWikiNavigatorComparisonReport({
      generatedAt: "2026-06-22T20:50:00.000Z",
      caseResults: [comparison()],
    });

    expect(valid.summary).toMatchObject({
      caseCount: 1,
      providerRows: OKF_WIKI_NAVIGATOR_PROVIDER_IDS.length,
      hardRequiredProviderFailures: 0,
    });

    expect(() =>
      buildOkfWikiNavigatorComparisonReport({
        generatedAt: "2026-06-22T20:50:00.000Z",
        caseResults: [
          comparison({
            providerResults: providerRows().filter(
              (row) => row.providerId !== "raw_memory",
            ),
          }),
        ],
      }),
    ).toThrow(/missing provider rows: raw_memory/);
  });

  it("requires successful hybrid rows to cite DB wiki and OKF evidence sources", () => {
    expect(() =>
      buildOkfWikiNavigatorComparisonReport({
        generatedAt: "2026-06-22T20:50:00.000Z",
        caseResults: [
          comparison({
            hybridEvidenceSources: ["db_wiki"],
          }),
        ],
      }),
    ).toThrow(/hybrid result must cite db_wiki and okf_navigator/);
  });

  it("summarizes hard-required failures separately from optional degraded providers", () => {
    const report = buildOkfWikiNavigatorComparisonReport({
      generatedAt: "2026-06-22T20:50:00.000Z",
      caseResults: [
        comparison({
          providerResults: providerRows({
            okf_navigator: "failed",
            raw_memory: "skipped",
            knowledge_graph: "degraded",
          }),
        }),
      ],
    });

    expect(report.summary).toMatchObject({
      hardRequiredProviderFailures: 1,
      skippedOrDegradedOptionalProviders: 2,
    });
  });
});
