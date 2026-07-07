/**
 * Conformance judge sweeper (THINK-189 U4): verdict parsing strictness,
 * prompt truncation, and the sweep lifecycle — complete / retryable-defer /
 * error / attempt cap — against stub deps.
 */
import { describe, expect, it, vi } from "vitest";
import {
  buildConformanceJudgeUserMessage,
  parseConformanceJudgeVerdict,
  CONFORMANCE_DIGEST_PROMPT_MAX_CHARS,
  CONFORMANCE_DIGEST_TRUNCATION_MARKER,
} from "../lib/artifacts/conformance-judge.js";
import type { ConformanceManifestSnapshot } from "../lib/artifacts/document-conformance.js";
import {
  sweepConformanceReports,
  type ConformanceJudgeSweepDeps,
  type PendingConformanceReport,
} from "./document-conformance-judge.js";

const SNAPSHOT: ConformanceManifestSnapshot = {
  sections: [
    {
      id: "pipeline-health",
      title: "Pipeline Health",
      tier: "suggested",
      guidance: "Stage-by-stage funnel with conversion rates.",
      suggestedDirectives: [{ kind: "chart", chartType: "funnel" }],
    },
  ],
  analyses: [
    {
      key: "funnel-conversion",
      op: "funnel_conversion",
      presentation: { directive: "chart", chartType: "funnel" },
    },
  ],
};

function makeReport(
  overrides: Partial<PendingConformanceReport> = {},
): PendingConformanceReport {
  return {
    id: "report-1",
    tenantId: "tenant-1",
    artifactId: "artifact-1",
    digestRevision: "rev-abc",
    manifestSnapshot: SNAPSHOT,
    judgeAttempts: 1,
    ...overrides,
  };
}

function makeDeps(
  reports: PendingConformanceReport[],
  overrides: Partial<ConformanceJudgeSweepDeps> = {},
) {
  const deps: ConformanceJudgeSweepDeps = {
    claimPendingBatch: vi.fn(async () => reports),
    loadDigest: vi.fn(async () => "## Pipeline Health\n\nNarrative.\n"),
    invokeJudge: vi.fn(async () => ({
      thinSections: [],
      assertedNotComputed: [],
    })),
    markComplete: vi.fn(async () => {}),
    markError: vi.fn(async () => {}),
    releaseToPending: vi.fn(async () => {}),
    ...overrides,
  };
  return deps;
}

describe("parseConformanceJudgeVerdict", () => {
  it("accepts the exact schema, including findings (AE3 shape)", () => {
    const verdict = parseConformanceJudgeVerdict(
      `{"thinSections": [{"sectionId": "coaching-notes", "reasoning": "two sentences of filler"}], "assertedNotComputed": [{"sectionId": "pipeline-health", "claim": "conversion improved 40%"}]}`,
    );
    expect(verdict.thinSections).toEqual([
      { sectionId: "coaching-notes", reasoning: "two sentences of filler" },
    ]);
    expect(verdict.assertedNotComputed).toEqual([
      { sectionId: "pipeline-health", claim: "conversion improved 40%" },
    ]);
  });

  it("accepts a clean verdict with empty arrays", () => {
    expect(
      parseConformanceJudgeVerdict(
        `{"thinSections": [], "assertedNotComputed": []}`,
      ),
    ).toEqual({ thinSections: [], assertedNotComputed: [] });
  });

  it("extracts the JSON object out of surrounding prose", () => {
    const verdict = parseConformanceJudgeVerdict(
      `Here is my verdict: {"thinSections": [], "assertedNotComputed": []}`,
    );
    expect(verdict.thinSections).toEqual([]);
  });

  it("rejects extra top-level keys", () => {
    expect(() =>
      parseConformanceJudgeVerdict(
        `{"thinSections": [], "assertedNotComputed": [], "verdict": "pass"}`,
      ),
    ).toThrow(/unexpected key/);
  });

  it("rejects extra keys inside findings and wrong value types", () => {
    expect(() =>
      parseConformanceJudgeVerdict(
        `{"thinSections": [{"sectionId": "x", "reasoning": "y", "score": 1}], "assertedNotComputed": []}`,
      ),
    ).toThrow(/unexpected key/);
    expect(() =>
      parseConformanceJudgeVerdict(
        `{"thinSections": [{"sectionId": 3, "reasoning": "y"}], "assertedNotComputed": []}`,
      ),
    ).toThrow(/string sectionId/);
    expect(() =>
      parseConformanceJudgeVerdict(
        `{"thinSections": "none", "assertedNotComputed": []}`,
      ),
    ).toThrow(/must be an array/);
  });

  it("rejects non-JSON responses", () => {
    expect(() => parseConformanceJudgeVerdict("looks fine to me")).toThrow(
      /No JSON/,
    );
  });
});

describe("buildConformanceJudgeUserMessage", () => {
  it("wraps digest and manifest in delimited tags", () => {
    const msg = buildConformanceJudgeUserMessage({
      digestMarkdown: "## Pipeline Health\n\nBody.",
      manifestSnapshot: SNAPSHOT,
    });
    expect(msg).toContain("<document_digest>\n## Pipeline Health");
    expect(msg).toContain("<plate_manifest>");
    expect(msg).toContain('"funnel-conversion"');
  });

  it("truncates an over-cap digest with a visible marker", () => {
    const huge = "x".repeat(CONFORMANCE_DIGEST_PROMPT_MAX_CHARS + 1000);
    const msg = buildConformanceJudgeUserMessage({
      digestMarkdown: huge,
      manifestSnapshot: SNAPSHOT,
    });
    expect(msg).toContain(CONFORMANCE_DIGEST_TRUNCATION_MARKER);
    expect(msg.length).toBeLessThan(huge.length);
  });
});

describe("sweepConformanceReports", () => {
  it("completes a report with findings (AE3)", async () => {
    const findings = {
      thinSections: [],
      assertedNotComputed: [
        { sectionId: "pipeline-health", claim: "conversion improved 40%" },
      ],
    };
    const deps = makeDeps([makeReport()], {
      invokeJudge: vi.fn(async () => findings),
    });
    const result = await sweepConformanceReports(deps);
    expect(result).toMatchObject({ claimed: 1, completed: 1, errored: 0 });
    expect(deps.markComplete).toHaveBeenCalledWith(
      "report-1",
      expect.objectContaining({ findings }),
    );
  });

  it("completes a clean verdict with empty findings", async () => {
    const deps = makeDeps([makeReport()]);
    const result = await sweepConformanceReports(deps);
    expect(result.completed).toBe(1);
    expect(deps.markComplete).toHaveBeenCalledWith(
      "report-1",
      expect.objectContaining({
        findings: { thinSections: [], assertedNotComputed: [] },
      }),
    );
  });

  it("judges each report against its own pinned digest, not a shared head", async () => {
    const loads: string[] = [];
    const deps = makeDeps(
      [
        makeReport({ id: "r1", digestRevision: "rev-old" }),
        makeReport({ id: "r2", digestRevision: "rev-new" }),
      ],
      {
        loadDigest: vi.fn(async (report) => {
          loads.push(report.digestRevision);
          return `digest for ${report.digestRevision}`;
        }),
        invokeJudge: vi.fn(async ({ digestMarkdown }) => ({
          thinSections: [
            { sectionId: "pipeline-health", reasoning: digestMarkdown },
          ],
          assertedNotComputed: [],
        })),
      },
    );
    await sweepConformanceReports(deps);
    expect(loads).toEqual(["rev-old", "rev-new"]);
    expect(deps.markComplete).toHaveBeenCalledWith(
      "r1",
      expect.objectContaining({
        findings: expect.objectContaining({
          thinSections: [
            {
              sectionId: "pipeline-health",
              reasoning: "digest for rev-old",
            },
          ],
        }),
      }),
    );
  });

  it("a malformed verdict marks the row error with a truncated message, no throw", async () => {
    const deps = makeDeps([makeReport()], {
      invokeJudge: vi.fn(async () => {
        throw new Error(
          `Judge response has unexpected key(s): verdict ${"x".repeat(600)}`,
        );
      }),
    });
    const result = await sweepConformanceReports(deps);
    expect(result.errored).toBe(1);
    expect(deps.markError).toHaveBeenCalledWith(
      "report-1",
      expect.stringContaining("unexpected key"),
    );
  });

  it("a Bedrock throttle defers the row (stays pending, AE4)", async () => {
    const throttle = Object.assign(new Error("Rate exceeded"), {
      name: "ThrottlingException",
    });
    const deps = makeDeps([makeReport()], {
      invokeJudge: vi.fn(async () => {
        throw throttle;
      }),
    });
    const result = await sweepConformanceReports(deps);
    expect(result).toMatchObject({ deferred: 1, errored: 0, completed: 0 });
    expect(deps.releaseToPending).toHaveBeenCalledWith("report-1");
    expect(deps.markError).not.toHaveBeenCalled();
  });

  it("a non-retryable Bedrock error marks the row error", async () => {
    const deps = makeDeps([makeReport()], {
      invokeJudge: vi.fn(async () => {
        throw new Error("ValidationException: model does not exist");
      }),
    });
    const result = await sweepConformanceReports(deps);
    expect(result.errored).toBe(1);
  });

  it("attempt cap reached → error, never invoked (poison row)", async () => {
    const deps = makeDeps([makeReport({ judgeAttempts: 6 })]);
    const result = await sweepConformanceReports(deps, { maxAttempts: 5 });
    expect(result.errored).toBe(1);
    expect(deps.invokeJudge).not.toHaveBeenCalled();
    expect(deps.markError).toHaveBeenCalledWith(
      "report-1",
      expect.stringContaining("attempt cap"),
    );
  });

  it("empty pending set → no judge calls", async () => {
    const deps = makeDeps([]);
    const result = await sweepConformanceReports(deps);
    expect(result).toEqual({
      claimed: 0,
      completed: 0,
      errored: 0,
      deferred: 0,
    });
    expect(deps.invokeJudge).not.toHaveBeenCalled();
  });

  it("one failing row doesn't stop the batch", async () => {
    const deps = makeDeps(
      [makeReport({ id: "r1" }), makeReport({ id: "r2" })],
      {
        loadDigest: vi.fn(async (report) => {
          if (report.id === "r1") throw new Error("NoSuchKey");
          return "digest";
        }),
      },
    );
    const result = await sweepConformanceReports(deps);
    expect(result).toMatchObject({ completed: 1, errored: 1 });
  });
});
