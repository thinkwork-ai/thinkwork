import { describe, expect, it } from "vitest";

import {
  AGENT_LOOP_PHASE1_JUDGE_MODES,
  AGENT_LOOP_PHASE1_TRIGGER_FAMILIES,
  DEFAULT_LOOP_POLICY,
  normalizeGoalSpec,
  normalizeJudgeSpec,
  normalizeLoopPolicy,
  normalizeTriggerSpec,
  normalizeWorkerSpec,
} from "./contracts";

describe("AgentLoop contracts", () => {
  it("accepts the Phase 1 manual/schedule trigger families", () => {
    expect(AGENT_LOOP_PHASE1_TRIGGER_FAMILIES).toEqual(["manual", "schedule"]);
    expect(normalizeTriggerSpec({ family: "manual" })).toEqual({
      family: "manual",
      enabled: true,
      config: {},
    });
    expect(
      normalizeTriggerSpec({
        family: "schedule",
        enabled: false,
        scheduleId: "sched_123",
        config: { expression: "rate(7 days)" },
      }),
    ).toEqual({
      family: "schedule",
      enabled: false,
      scheduleId: "sched_123",
      config: { expression: "rate(7 days)" },
    });
  });

  it("rejects unsupported Phase 1 trigger families", () => {
    expect(() => normalizeTriggerSpec({ family: "webhook" })).toThrow(
      /Unsupported AgentLoop trigger family/,
    );
  });

  it("normalizes goal and worker specs with bounded strings", () => {
    expect(
      normalizeGoalSpec({
        objective: "  Check open tasks  ",
        completionCriteria: ["  summarize blockers ", "recommend next step"],
        context: { project: "THNK" },
      }),
    ).toEqual({
      objective: "Check open tasks",
      completionCriteria: ["summarize blockers", "recommend next step"],
      context: { project: "THNK" },
    });

    expect(
      normalizeWorkerSpec({
        type: "agent_profile",
        id: "profile-1",
        label: "  Ops Agent ",
        toolHints: ["github", "", "linear"],
      }),
    ).toEqual({
      type: "agent_profile",
      id: "profile-1",
      label: "Ops Agent",
      toolHints: ["github", "linear"],
      config: {},
    });
  });

  it("rejects empty or oversized goal specs before persistence", () => {
    expect(() => normalizeGoalSpec({ objective: "" })).toThrow(
      /objective is required/,
    );
    expect(() =>
      normalizeGoalSpec({
        objective: "x".repeat(5001),
        completionCriteria: ["done"],
      }),
    ).toThrow(/objective must be at most 5000 characters/);
  });

  it("keeps model judges in the shared contract but not in Phase 1 execution", () => {
    expect(AGENT_LOOP_PHASE1_JUDGE_MODES).toEqual([
      "self_check",
      "human_approval",
    ]);
    expect(normalizeJudgeSpec({ mode: "self_check" })).toEqual({
      mode: "self_check",
      criteria: [],
      config: {},
    });
    expect(
      normalizeJudgeSpec(
        { mode: "model_judge", criteria: ["must cite evidence"] },
        { allowFutureModes: true },
      ),
    ).toEqual({
      mode: "model_judge",
      criteria: ["must cite evidence"],
      config: {},
    });
    expect(() => normalizeJudgeSpec({ mode: "model_judge" })).toThrow(
      /not executable in Phase 1/,
    );
  });

  it("normalizes positive loop policy limits and rejects zero budgets", () => {
    expect(normalizeLoopPolicy({})).toEqual(DEFAULT_LOOP_POLICY);
    expect(
      normalizeLoopPolicy({
        maxIterations: "3",
        maxRuntimeMs: "60000",
        maxTokens: 10000,
        costBudgetUsd: 2.5,
        retryBackoffMs: 5000,
        failBehavior: "escalate",
      }),
    ).toEqual({
      ...DEFAULT_LOOP_POLICY,
      maxIterations: 3,
      maxRuntimeMs: 60000,
      maxTokens: 10000,
      costBudgetUsd: 2.5,
      retryBackoffMs: 5000,
      failBehavior: "escalate",
    });

    for (const policy of [
      { maxIterations: 0 },
      { maxRuntimeMs: -1 },
      { maxTokens: "0" },
      { costBudgetUsd: 0 },
    ]) {
      expect(() => normalizeLoopPolicy(policy)).toThrow(/must be positive/);
    }
  });
});
