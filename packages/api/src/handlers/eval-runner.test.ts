import { describe, expect, it } from "vitest";
import { selectedTestCaseIdsFromEvent } from "./eval-runner.js";

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
});
