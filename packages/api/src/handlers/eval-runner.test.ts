import { describe, expect, it } from "vitest";
import {
  buildEvalWorkerMessages,
  chunkEvalWorkerMessages,
  evalWorkerMessageGroupIdForMessage,
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
    });
    expect(batches).toHaveLength(12);
    expect(batches.every((batch) => batch.length === 10)).toBe(true);
  });
});
