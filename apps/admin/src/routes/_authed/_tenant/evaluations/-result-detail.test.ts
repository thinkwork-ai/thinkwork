import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import {
  canEditEvalResult,
  deriveEvalFailureMode,
  expectedSummary,
  openEvalResultEditor,
  parseEvaluatorResults,
  sortEvalSpans,
} from "./-result-detail";

describe("evaluation result detail helpers", () => {
  it("classifies a low-scoring evaluator result as judge-fail", () => {
    const result = {
      assertions: [],
      errorMessage: null,
      evaluatorResults: JSON.stringify([
        {
          evaluator_id: "Builtin.Helpfulness",
          value: 0.4,
          explanation: "response lacks specificity",
        },
      ]),
      score: 0.4,
      status: "fail",
    };

    expect(deriveEvalFailureMode(result)).toBe("judge-fail");
    expect(parseEvaluatorResults(result.evaluatorResults)[0]?.explanation).toBe(
      "response lacks specificity",
    );
  });

  it("classifies runner timeouts and assertion-only failures distinctly", () => {
    expect(
      deriveEvalFailureMode({
        assertions: [],
        errorMessage: "AgentCore invocation timeout after 240s",
        evaluatorResults: [],
        score: null,
        status: "error",
      }),
    ).toBe("timeout");

    expect(
      deriveEvalFailureMode({
        assertions: [{ type: "contains", value: "done", passed: false }],
        errorMessage: null,
        evaluatorResults: [],
        score: 0,
        status: "fail",
      }),
    ).toBe("assertion-fail");
  });

  it("summarizes assertions and sorts spans chronologically", () => {
    expect(
      expectedSummary([
        { type: "contains", value: "approved" },
        { type: "llm-rubric", value: "must cite sources" },
      ]),
    ).toBe("contains: approved; llm-rubric: must cite sources");

    expect(
      sortEvalSpans([
        { timestamp: "2026-05-16T14:02:00.000Z", name: "b", attributes: {} },
        { timestamp: "2026-05-16T14:01:00.000Z", name: "a", attributes: {} },
      ]).map((span) => span.name),
    ).toEqual(["a", "b"]);
  });

  it("only offers result-to-edit navigation for persisted test cases", () => {
    expect(canEditEvalResult("test-case-1")).toBe(true);
    expect(canEditEvalResult("")).toBe(false);
    expect(canEditEvalResult(null)).toBe(false);
    expect(canEditEvalResult(undefined)).toBe(false);
  });

  it("opens the result editor only when a result has a test case id", () => {
    const onEdit = vi.fn();

    expect(openEvalResultEditor("test-case-1", onEdit)).toBe(true);
    expect(onEdit).toHaveBeenCalledWith("test-case-1");

    expect(openEvalResultEditor(null, onEdit)).toBe(false);
    expect(openEvalResultEditor("", onEdit)).toBe(false);
    expect(onEdit).toHaveBeenCalledTimes(1);
  });

  it("keeps trace loading lazy in the run-detail sheet", () => {
    const routeSource = readFileSync(
      new URL("./$runId.tsx", import.meta.url),
      "utf8",
    );
    const querySource = readFileSync(
      new URL("../../../../lib/graphql-queries.ts", import.meta.url),
      "utf8",
    );
    const formSource = readFileSync(
      new URL(
        "../../../../components/evaluations/EvalTestCaseForm.tsx",
        import.meta.url,
      ),
      "utf8",
    );

    expect(routeSource).toContain("EvalResultSpansQuery");
    expect(routeSource).toContain("setShowTrace((value) => !value)");
    expect(routeSource).toContain("pause: !traceEnabled");
    expect(routeSource).toContain("EditEvalTestCaseSheet");
    expect(routeSource).toContain("Edit Eval");
    expect(formSource).toContain("onSaved?: () => void");
    expect(formSource).toContain("onCancel?: () => void");
    expect(querySource).toContain("query EvalResultSpans");
  });

  it("keeps scheduled eval provenance visible in the run list", () => {
    const routeSource = readFileSync(
      new URL("./index.tsx", import.meta.url),
      "utf8",
    );
    const querySource = readFileSync(
      new URL("../../../../lib/graphql-queries.ts", import.meta.url),
      "utf8",
    );

    expect(querySource).toContain("scheduledJobId");
    expect(routeSource).toContain(
      'to="/automations/schedules/$scheduledJobId"',
    );
    expect(routeSource).toContain("CalendarClock");
  });
});
