import { describe, expect, it } from "vitest";

import {
  isLoopingDefinition,
  readWorkflowDefinition,
  validateWorkflowDefinition,
} from "./workflow-definition.js";

const minimalAgentStep = {
  id: "do-work",
  kind: "agent",
  objective: "Compile the weekly ops report",
};

const validLoopingDefinition = {
  version: 1,
  steps: [minimalAgentStep],
  continuationPolicy: {
    exitSignal: "the report document exists and is shared",
    maxIterations: 5,
  },
};

describe("validateWorkflowDefinition", () => {
  it("accepts a valid minimal looping definition", () => {
    const result = validateWorkflowDefinition(validLoopingDefinition);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.definition.steps).toHaveLength(1);
      expect(isLoopingDefinition(result.definition)).toBe(true);
    }
  });

  it("accepts a policy-less (plain, non-looping) definition", () => {
    const result = validateWorkflowDefinition({
      version: 1,
      steps: [minimalAgentStep],
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(isLoopingDefinition(result.definition)).toBe(false);
  });

  it("rejects an unknown step kind naming the step id", () => {
    const result = validateWorkflowDefinition({
      version: 1,
      steps: [{ id: "mystery", kind: "teleport" }],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors).toEqual([
        expect.objectContaining({
          stepId: "mystery",
          reason: expect.stringContaining('unknown step kind "teleport"'),
        }),
      ]);
    }
  });

  it("rejects an agent step with a missing objective", () => {
    const result = validateWorkflowDefinition({
      version: 1,
      steps: [{ id: "a1", kind: "agent" }],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors[0]).toMatchObject({
        stepId: "a1",
        field: "steps[0].objective",
      });
    }
  });

  it("rejects zero and negative maxIterations", () => {
    for (const maxIterations of [0, -3]) {
      const result = validateWorkflowDefinition({
        version: 1,
        steps: [minimalAgentStep],
        continuationPolicy: { exitSignal: "done", maxIterations },
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.errors[0]?.field).toBe(
          "continuationPolicy.maxIterations",
        );
      }
    }
  });

  it("rejects duplicate step ids", () => {
    const result = validateWorkflowDefinition({
      version: 1,
      steps: [
        minimalAgentStep,
        { ...minimalAgentStep, objective: "second copy" },
      ],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors[0]?.reason).toContain('duplicate step id "do-work"');
    }
  });

  it("requires exactly one of until/durationSeconds on wait steps", () => {
    const neither = validateWorkflowDefinition({
      version: 1,
      steps: [{ id: "w1", kind: "wait" }],
    });
    expect(neither.ok).toBe(false);

    const both = validateWorkflowDefinition({
      version: 1,
      steps: [
        {
          id: "w1",
          kind: "wait",
          until: "2026-07-08T00:00:00Z",
          durationSeconds: 60,
        },
      ],
    });
    expect(both.ok).toBe(false);

    const untilOnly = validateWorkflowDefinition({
      version: 1,
      steps: [{ id: "w1", kind: "wait", until: "2026-07-08T00:00:00Z" }],
    });
    expect(untilOnly.ok).toBe(true);
  });

  it("rejects a wait until without timezone information", () => {
    const result = validateWorkflowDefinition({
      version: 1,
      steps: [{ id: "w1", kind: "wait", until: "2026-07-08T00:00:00" }],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]?.field).toBe("steps[0].until");
  });

  it("collects every error instead of stopping at the first", () => {
    const result = validateWorkflowDefinition({
      version: 2,
      steps: [
        { id: "a1", kind: "agent" },
        { id: "??bad id??", kind: "wait" },
      ],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.length).toBeGreaterThanOrEqual(3);
  });
});

describe("readWorkflowDefinition", () => {
  it("returns the definition for a valid snapshot and null otherwise", () => {
    expect(readWorkflowDefinition(validLoopingDefinition)).not.toBeNull();
    expect(readWorkflowDefinition({})).toBeNull();
    expect(readWorkflowDefinition(null)).toBeNull();
  });
});
