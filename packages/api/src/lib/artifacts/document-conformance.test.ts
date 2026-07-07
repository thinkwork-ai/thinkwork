/**
 * Conformance recording (THINK-189 U3): row construction, the judgeable
 * predicate, and the content-addressed digest pin the judge sweeper reads.
 */
import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  buildConformanceReportRow,
  buildManifestSnapshot,
  isJudgeable,
  recordDocumentConformance,
  summarizePlateConformance,
  type ConformanceRecordInput,
} from "./document-conformance.js";

const TENANT_ID = "11111111-1111-4111-8111-111111111111";
const ARTIFACT_ID = "22222222-2222-4222-8222-222222222222";

const SNAPSHOT = buildManifestSnapshot({
  sections: [
    {
      id: "pipeline-health",
      title: "Pipeline Health",
      tier: "suggested",
      guidance: "Stage-by-stage funnel.",
      suggestedDirectives: [{ kind: "chart", chartType: "funnel" }],
    },
  ],
  analyses: [
    {
      key: "funnel-conversion",
      op: "funnel_conversion",
      presentation: { directive: "chart", chartType: "funnel" },
      source: "model-supplied",
    },
  ],
});

function makeInput(
  overrides: Partial<ConformanceRecordInput> = {},
): ConformanceRecordInput {
  return {
    tenantId: TENANT_ID,
    artifactId: ARTIFACT_ID,
    plateSlug: "sales-rep-review",
    documentStatus: "draft",
    digestMarkdown: "## Pipeline Health\n\nNarrative.\n",
    sectionFacts: {
      sections: [
        {
          id: "pipeline-health",
          tier: "suggested",
          status: "present",
          bodyChars: 10,
          suggestedDirectives: [
            { kind: "chart", chartType: "funnel", used: false },
          ],
        },
      ],
      analyses: [
        { key: "funnel-conversion", computed: false, sectionId: null },
      ],
    },
    manifestSnapshot: SNAPSHOT,
    ...overrides,
  };
}

describe("buildManifestSnapshot", () => {
  it("keeps only the judge-relevant slice", () => {
    expect(SNAPSHOT.sections).toEqual([
      {
        id: "pipeline-health",
        title: "Pipeline Health",
        tier: "suggested",
        guidance: "Stage-by-stage funnel.",
        suggestedDirectives: [{ kind: "chart", chartType: "funnel" }],
      },
    ]);
    expect(SNAPSHOT.analyses).toEqual([
      {
        key: "funnel-conversion",
        op: "funnel_conversion",
        presentation: { directive: "chart", chartType: "funnel" },
      },
    ]);
  });
});

describe("isJudgeable", () => {
  it("guidance or a declared analysis makes a report judgeable", () => {
    expect(isJudgeable(SNAPSHOT)).toBe(true);
    expect(isJudgeable({ sections: [], analyses: SNAPSHOT.analyses })).toBe(
      true,
    );
    expect(
      isJudgeable({
        sections: [
          {
            id: "x",
            title: "X",
            tier: "suggested",
            guidance: "Something to judge against.",
            suggestedDirectives: [],
          },
        ],
        analyses: [],
      }),
    ).toBe(true);
  });

  it("no guidance and no analyses → not judgeable", () => {
    expect(
      isJudgeable({
        sections: [
          {
            id: "x",
            title: "X",
            tier: "suggested",
            guidance: "  ",
            suggestedDirectives: [],
          },
        ],
        analyses: [],
      }),
    ).toBe(false);
  });
});

describe("buildConformanceReportRow", () => {
  it("stamps the digest-only sha256 as digest_revision and starts pending", () => {
    const input = makeInput();
    const row = buildConformanceReportRow(input);
    expect(row.digest_revision).toBe(
      createHash("sha256").update(input.digestMarkdown).digest("hex"),
    );
    expect(row).toMatchObject({
      tenant_id: TENANT_ID,
      artifact_id: ARTIFACT_ID,
      plate_slug: "sales-rep-review",
      document_status: "draft",
      judge_status: "pending",
    });
    expect(row.sections).toEqual(input.sectionFacts.sections);
    expect(row.analyses).toEqual(input.sectionFacts.analyses);
    expect(row.manifest_snapshot).toEqual(SNAPSHOT);
  });

  it("an unjudgeable manifest starts skipped, never pending", () => {
    const row = buildConformanceReportRow(
      makeInput({
        manifestSnapshot: {
          sections: [
            {
              id: "x",
              title: "X",
              tier: "suggested",
              guidance: "",
              suggestedDirectives: [],
            },
          ],
          analyses: [],
        },
      }),
    );
    expect(row.judge_status).toBe("skipped");
  });
});

describe("recordDocumentConformance", () => {
  it("pins the digest at its content-addressed revision key, then inserts", async () => {
    const writePayload = vi.fn(async () => {});
    const insertReport = vi.fn(async () => {});
    const input = makeInput();
    await recordDocumentConformance(input, { writePayload, insertReport });
    const revision = createHash("sha256")
      .update(input.digestMarkdown)
      .digest("hex");
    expect(writePayload).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: TENANT_ID,
        key: expect.stringContaining(`/content/${revision}.md`),
        body: input.digestMarkdown,
      }),
    );
    expect(insertReport).toHaveBeenCalledWith(
      expect.objectContaining({ digest_revision: revision }),
    );
    // The pin lands before the row exists — a report never references a
    // digest that is not yet durable.
    expect(writePayload.mock.invocationCallOrder[0]).toBeLessThan(
      insertReport.mock.invocationCallOrder[0],
    );
  });

  it("an S3 pin failure propagates (no row without its digest)", async () => {
    const insertReport = vi.fn(async () => {});
    await expect(
      recordDocumentConformance(makeInput(), {
        writePayload: vi.fn(async () => {
          throw new Error("s3 down");
        }),
        insertReport,
      }),
    ).rejects.toThrow("s3 down");
    expect(insertReport).not.toHaveBeenCalled();
  });
});

describe("summarizePlateConformance (THINK-189 U6)", () => {
  type CorpusRow =
    import("./document-conformance.js").ConformanceReportCorpusRow;

  function factRow(overrides: Partial<CorpusRow> = {}): CorpusRow {
    return {
      sections: [
        {
          id: "pipeline-health",
          tier: "suggested",
          status: "present",
          bodyChars: 100,
          suggestedDirectives: [
            { kind: "chart", chartType: "funnel", used: true },
          ],
        },
      ],
      analyses: [
        {
          key: "funnel-conversion",
          computed: true,
          sectionId: "pipeline-health",
        },
      ],
      judgeStatus: "pending",
      judgeFindings: null,
      ...overrides,
    };
  }

  function storeOf(rows: CorpusRow[]) {
    return {
      listByTenantAndPlate: async () => rows,
    };
  }

  it("computes directive usage over run counts (AE2: 6 of 10 used → 60%)", async () => {
    const rows = [
      ...Array.from({ length: 6 }, () => factRow()),
      ...Array.from({ length: 4 }, () =>
        factRow({
          sections: [
            {
              id: "pipeline-health",
              tier: "suggested",
              status: "present",
              bodyChars: 80,
              suggestedDirectives: [
                { kind: "chart", chartType: "funnel", used: false },
              ],
            },
          ],
          analyses: [
            { key: "funnel-conversion", computed: false, sectionId: null },
          ],
        }),
      ),
    ];
    const summary = await summarizePlateConformance(
      TENANT_ID,
      "sales-rep-review",
      storeOf(rows),
    );
    expect(summary.reportCount).toBe(10);
    const section = summary.sections[0];
    expect(section).toMatchObject({
      sectionId: "pipeline-health",
      runCount: 10,
      presentCount: 10,
      directiveSuggestedRuns: 10,
      directiveUsedRuns: 6,
    });
    expect(summary.analyses[0]).toMatchObject({
      key: "funnel-conversion",
      declaredRuns: 10,
      computedRuns: 6,
    });
  });

  it("judge rates carry their own denominator over judged rows only (AE4)", async () => {
    const rows = [
      factRow({
        judgeStatus: "complete",
        judgeFindings: {
          thinSections: [{ sectionId: "pipeline-health" }],
          assertedNotComputed: [],
        },
      }),
      factRow({
        judgeStatus: "complete",
        judgeFindings: { thinSections: [], assertedNotComputed: [] },
      }),
      factRow({ judgeStatus: "pending" }),
      factRow({ judgeStatus: "error" }),
      factRow({ judgeStatus: "skipped" }),
    ];
    const summary = await summarizePlateConformance(
      TENANT_ID,
      "sales-rep-review",
      storeOf(rows),
    );
    expect(summary).toMatchObject({
      reportCount: 5,
      judgedReportCount: 2,
      pendingCount: 1,
      errorCount: 1,
      skippedCount: 1,
    });
    const section = summary.sections[0];
    expect(section.runCount).toBe(5);
    expect(section.judgedRuns).toBe(2);
    expect(section.judgedThinRuns).toBe(1);
  });

  it("empty corpus → empty summary, not an error", async () => {
    const summary = await summarizePlateConformance(
      TENANT_ID,
      "sales-rep-review",
      storeOf([]),
    );
    expect(summary).toEqual({
      plateSlug: "sales-rep-review",
      reportCount: 0,
      judgedReportCount: 0,
      pendingCount: 0,
      errorCount: 0,
      skippedCount: 0,
      sections: [],
      analyses: [],
    });
  });

  it("manifest-version mixing aggregates honestly: sections count only the runs that declared them", async () => {
    const rows = [
      factRow(),
      factRow({
        sections: [
          ...factRow().sections,
          {
            id: "coaching-notes",
            tier: "suggested",
            status: "missing",
            bodyChars: 0,
            suggestedDirectives: [],
          },
        ],
      }),
    ];
    const summary = await summarizePlateConformance(
      TENANT_ID,
      "sales-rep-review",
      storeOf(rows),
    );
    const coaching = summary.sections.find(
      (s) => s.sectionId === "coaching-notes",
    )!;
    expect(coaching.runCount).toBe(1);
    expect(coaching.missingCount).toBe(1);
    const pipeline = summary.sections.find(
      (s) => s.sectionId === "pipeline-health",
    )!;
    expect(pipeline.runCount).toBe(2);
  });
});
