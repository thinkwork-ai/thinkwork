import { describe, expect, it } from "vitest";
import {
  buildEvalTrialPlan,
  buildEvalWorkerMessages,
  caseHasLlmRubricAssertion,
  chunkEvalWorkerMessages,
  evalWorkerMessageGroupIdForMessage,
  excludesComputerSurfaceByDefault,
  selectedTestCaseIdsFromEvent,
} from "./eval-runner.js";

describe("selectedTestCaseIdsFromEvent", () => {
  it("reads specific test-case picks from the System Workflow input", () => {
    expect(
      selectedTestCaseIdsFromEvent({
        runId: "eval-run-1",
        input: { testCaseIds: ["tc-1", "", "tc-2", null] },
      }),
    ).toEqual(["tc-1", "tc-2"]);
  });

  it("treats missing or malformed workflow input as an all/category run", () => {
    expect(selectedTestCaseIdsFromEvent({ runId: "eval-run-1" })).toEqual([]);
    expect(
      selectedTestCaseIdsFromEvent({
        runId: "eval-run-1",
        input: { testCaseIds: "tc-1" },
      }),
    ).toEqual([]);
  });

  it("groups FIFO messages by selected Computer so one Computer is evaluated serially", () => {
    expect(
      evalWorkerMessageGroupIdForMessage(
        {
          id: "run-1",
          computer_id: "computer-1",
          agent_id: "agent-1",
        },
        { index: 3 },
      ),
    ).toBe("eval-computer:computer-1");
  });

  it("shards direct AgentCore runs across FIFO message groups", () => {
    expect(
      evalWorkerMessageGroupIdForMessage(
        {
          id: "run-1",
          computer_id: null,
          agent_id: "agent-1",
        },
        { index: 21 },
        20,
      ),
    ).toBe("eval-agentcore:agent-1:1");
  });

  it("excludes Computer-surface cases from direct AgentCore category runs by default", () => {
    expect(
      excludesComputerSurfaceByDefault(
        { computer_id: null, execution_target: "agentcore" },
        [],
      ),
    ).toBe(true);
    expect(
      excludesComputerSurfaceByDefault(
        { computer_id: "computer-1", execution_target: "agentcore" },
        [],
      ),
    ).toBe(false);
    expect(
      excludesComputerSurfaceByDefault(
        { computer_id: null, execution_target: "agentcore" },
        ["tc-1"],
      ),
    ).toBe(false);
    expect(
      excludesComputerSurfaceByDefault(
        { computer_id: null, execution_target: "desktop-pi" },
        [],
      ),
    ).toBe(false);
  });
});

describe("eval-runner dispatch helpers", () => {
  it("fans out a 120-case corpus into 12 SQS batches", () => {
    const cases = Array.from({ length: 120 }, (_, index) => ({
      id: `tc-${index + 1}`,
    }));

    const messages = buildEvalWorkerMessages("run-1", cases);
    const batches = chunkEvalWorkerMessages(messages);

    expect(messages).toHaveLength(120);
    expect(messages[0]).toEqual({
      runId: "run-1",
      testCaseId: "tc-1",
      index: 0,
      trialIndex: 0,
    });
    expect(batches).toHaveLength(12);
    expect(batches.every((batch) => batch.length === 10)).toBe(true);
  });

  it("fans out one message per (case, trial) with a flat unique index across ALL messages", () => {
    const messages = buildEvalWorkerMessages("run-1", [
      { id: "tc-1", trials: 3 },
      { id: "tc-2" },
      { id: "tc-3", trials: 2 },
    ]);

    expect(messages.map((m) => [m.testCaseId, m.trialIndex, m.index])).toEqual([
      ["tc-1", 0, 0],
      ["tc-1", 1, 1],
      ["tc-1", 2, 2],
      ["tc-2", 0, 3],
      ["tc-3", 0, 4],
      ["tc-3", 1, 5],
    ]);
    // `index` feeds the SQS batch entry Id — uniqueness is load-bearing.
    expect(new Set(messages.map((m) => m.index)).size).toBe(messages.length);
  });
});

describe("eval-runner trial plan (U4)", () => {
  it("detects llm-rubric assertions and tolerates malformed shapes", () => {
    expect(
      caseHasLlmRubricAssertion([
        { type: "icontains", value: "x" },
        { type: "llm-rubric", value: "should be polite" },
      ]),
    ).toBe(true);
    expect(caseHasLlmRubricAssertion([{ type: "icontains" }])).toBe(false);
    expect(caseHasLlmRubricAssertion([])).toBe(false);
    expect(caseHasLlmRubricAssertion(null)).toBe(false);
    expect(caseHasLlmRubricAssertion("llm-rubric")).toBe(false);
    expect(caseHasLlmRubricAssertion([null, "llm-rubric"])).toBe(false);
  });

  it("assigns the profile trial count to rubric-bearing cases only (R11)", () => {
    const { plan, expectedResultRows } = buildEvalTrialPlan(
      [
        { id: "rubric", assertions: [{ type: "llm-rubric", value: "r" }] },
        { id: "deterministic", assertions: [{ type: "equals", value: "x" }] },
        { id: "empty", assertions: [] },
      ],
      3,
    );
    expect(plan).toEqual([
      { caseId: "rubric", trials: 3 },
      { caseId: "deterministic", trials: 1 },
      { caseId: "empty", trials: 1 },
    ]);
    expect(expectedResultRows).toBe(5);
  });

  it("clamps degenerate profile trial counts to 1", () => {
    const rubricCase = [
      { id: "rubric", assertions: [{ type: "llm-rubric", value: "r" }] },
    ];
    expect(buildEvalTrialPlan(rubricCase, 0).plan[0].trials).toBe(1);
    expect(buildEvalTrialPlan(rubricCase, Number.NaN).plan[0].trials).toBe(1);
    expect(buildEvalTrialPlan(rubricCase, 1).expectedResultRows).toBe(1);
  });
});
