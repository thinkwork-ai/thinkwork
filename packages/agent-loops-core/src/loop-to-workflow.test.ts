import { describe, expect, it } from "vitest";

import { workflowDefinitionFromAgentLoopVersion } from "./loop-to-workflow.js";
import { DEFAULT_LOOP_POLICY } from "./contracts.js";
import {
  DEFAULT_AGENT_LOOP_GOAL_TOKEN_BUDGET,
  type DispatchableAgentLoopVersion,
} from "./run-ledger.js";

function version(
  overrides: Partial<DispatchableAgentLoopVersion> = {},
): DispatchableAgentLoopVersion {
  return {
    id: "v-1",
    versionStatus: "active",
    goalSpec: {
      objective: "Compile the weekly ops report",
      completionCriteria: [],
    },
    workerSpec: { type: "agent", id: "a-1", toolHints: [], config: {} },
    loopPolicy: DEFAULT_LOOP_POLICY,
    targetKind: "agent_thread",
    ...overrides,
  };
}

describe("workflowDefinitionFromAgentLoopVersion", () => {
  it("converts a plain agent_thread automation to a single agent step", () => {
    const definition = workflowDefinitionFromAgentLoopVersion(version());
    expect(definition.steps).toEqual([
      {
        id: "work",
        kind: "agent",
        objective: "Compile the weekly ops report",
        tokenBudget: DEFAULT_AGENT_LOOP_GOAL_TOKEN_BUDGET,
      },
    ]);
    expect(definition.continuationPolicy).toBeUndefined();
  });

  it("folds completion criteria into the objective", () => {
    const definition = workflowDefinitionFromAgentLoopVersion(
      version({
        goalSpec: {
          objective: "Do the thing",
          completionCriteria: ["report exists", "report is shared"],
        },
      }),
    );
    const step = definition.steps[0];
    expect(step.kind).toBe("agent");
    if (step.kind === "agent") {
      expect(step.objective).toContain("Completion criteria:");
      expect(step.objective).toContain("- report exists");
    }
  });

  it("puts bolt-on routine actions BEFORE the agent step, preserving order", () => {
    const definition = workflowDefinitionFromAgentLoopVersion(
      version({
        routineActionsSpec: {
          actions: [
            { routineId: "r-1", input: { a: 1 } },
            { routineId: "r-2" },
          ],
          agentTurn: true,
        },
      }),
    );
    expect(definition.steps.map((s) => s.kind)).toEqual([
      "routine",
      "routine",
      "agent",
    ]);
    expect(definition.steps[0]).toMatchObject({
      id: "routine-1",
      routineId: "r-1",
      input: { a: 1 },
    });
  });

  it("converts a routine-only automation to routine steps with no agent step", () => {
    const definition = workflowDefinitionFromAgentLoopVersion(
      version({
        targetKind: "routine",
        routineActionsSpec: {
          actions: [{ routineId: "r-9" }],
          agentTurn: false,
        },
      }),
    );
    expect(definition.steps).toEqual([
      { id: "routine", kind: "routine", routineId: "r-9" },
    ]);
  });

  it("maps maxIterations > 1 to a continuation policy", () => {
    const definition = workflowDefinitionFromAgentLoopVersion(
      version({
        goalSpec: {
          objective: "Iterate until done",
          completionCriteria: ["the doc is published"],
        },
        loopPolicy: { ...DEFAULT_LOOP_POLICY, maxIterations: 4 },
      }),
    );
    expect(definition.continuationPolicy).toEqual({
      exitSignal: "the doc is published",
      maxIterations: 4,
    });
  });

  it("throws in ThinkWork terms when the conversion cannot validate", () => {
    expect(() =>
      workflowDefinitionFromAgentLoopVersion(
        version({
          goalSpec: { objective: "   ", completionCriteria: [] },
        }),
      ),
    ).toThrow(/does not convert to a valid workflow definition/);
  });
});
