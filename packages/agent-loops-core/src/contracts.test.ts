import { describe, expect, it } from "vitest";

import {
  AGENT_LOOP_PHASE1_JUDGE_MODES,
  AGENT_LOOP_PHASE1_TRIGGER_FAMILIES,
  DEFAULT_LOOP_POLICY,
  normalizeGoalSpec,
  normalizeJudgeSpec,
  normalizeLoopPolicy,
  normalizeTargetSpec,
  normalizeTriggerSpec,
  normalizeWorkerSpec,
  targetSpecFromLegacy,
} from "./contracts";

const ROUTINE_ID = "33333333-3333-4333-8333-333333333333";
const ROUTINE_ID_2 = "44444444-4444-4444-8444-444444444444";

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

  it("accepts webhook and rejects the dead api/app_event/n8n families (THINK-137 U3, R2)", () => {
    expect(normalizeTriggerSpec({ family: "webhook" })).toEqual({
      family: "webhook",
      enabled: true,
      config: {},
    });
    for (const family of ["api", "app_event", "n8n"]) {
      expect(() => normalizeTriggerSpec({ family })).toThrow(
        /Unsupported AgentLoop trigger family/,
      );
    }
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

describe("normalizeTargetSpec (THINK-137 U3)", () => {
  it("accepts an agent_thread target", () => {
    expect(
      normalizeTargetSpec({
        kind: "agent_thread",
        agentThread: {
          instructions: "  Prepare the brief  ",
          completionCriteria: ["A useful brief exists.", ""],
          workerId: "agent-1",
          workerType: "agent",
          threadMode: "new_per_run",
        },
      }),
    ).toEqual({
      kind: "agent_thread",
      agentThread: {
        instructions: "Prepare the brief",
        completionCriteria: ["A useful brief exists."],
        workerId: "agent-1",
        workerType: "agent",
        threadMode: "new_per_run",
      },
    });
  });

  it("requires fixedThreadId when threadMode is fixed", () => {
    expect(() =>
      normalizeTargetSpec({
        kind: "agent_thread",
        agentThread: { instructions: "x", threadMode: "fixed" },
      }),
    ).toThrow(/fixedThreadId is required/);
  });

  it("accepts a routine target and a workflow target", () => {
    expect(
      normalizeTargetSpec({
        kind: "routine",
        routine: { routineId: ROUTINE_ID, input: { late: 2 }, label: "Check" },
      }),
    ).toEqual({
      kind: "routine",
      routine: { routineId: ROUTINE_ID, input: { late: 2 }, label: "Check" },
    });
    expect(
      normalizeTargetSpec({
        kind: "workflow",
        workflow: { routineId: ROUTINE_ID },
        guards: { monthlyCostCapUsd: 25, maxConcurrentRuns: 2 },
      }),
    ).toEqual({
      kind: "workflow",
      workflow: { routineId: ROUTINE_ID },
      guards: { monthlyCostCapUsd: 25, maxConcurrentRuns: 2 },
    });
  });

  it("rejects mixed kinds — routine kind carrying agentThread config", () => {
    expect(() =>
      normalizeTargetSpec({
        kind: "routine",
        routine: { routineId: ROUTINE_ID },
        agentThread: { instructions: "x", threadMode: "new_per_run" },
      }),
    ).toThrow(/must not carry agentThread config/);
  });

  it("rejects an unknown kind with an actionable message", () => {
    expect(() => normalizeTargetSpec({ kind: "bogus" })).toThrow(
      /is not one of agent_thread, routine, workflow/,
    );
  });

  it("rejects a non-object and a routine target with a bad routineId", () => {
    expect(() => normalizeTargetSpec([])).toThrow(/must be an object/);
    expect(() =>
      normalizeTargetSpec({ kind: "routine", routine: { routineId: "nope" } }),
    ).toThrow(/routineId must be a routine id/);
  });
});

describe("targetSpecFromLegacy (THINK-137 U3)", () => {
  it("maps a goal+worker version to an agent_thread target", () => {
    expect(
      targetSpecFromLegacy({
        goalSpec: {
          objective: "Prepare the brief",
          completionCriteria: ["A useful brief exists."],
        },
        workerSpec: { type: "agent", id: "agent-1", toolHints: [], config: {} },
      }),
    ).toEqual({
      kind: "agent_thread",
      agentThread: {
        instructions: "Prepare the brief",
        completionCriteria: ["A useful brief exists."],
        workerId: "agent-1",
        workerType: "agent",
        threadMode: "new_per_run",
      },
    });
  });

  it("maps a routine-only (agentTurn:false) single-action spec to a routine target", () => {
    expect(
      targetSpecFromLegacy({
        goalSpec: { objective: "" },
        workerSpec: { type: "agent", id: "agent-1" },
        routineActionsSpec: {
          actions: [{ routineId: ROUTINE_ID, label: "Check" }],
          agentTurn: false,
        },
      }),
    ).toEqual({
      kind: "routine",
      routine: { routineId: ROUTINE_ID, label: "Check" },
    });
  });

  it("preserves trailing actions of a multi-action routine-only spec under additionalActions", () => {
    const spec = targetSpecFromLegacy({
      routineActionsSpec: {
        actions: [
          { routineId: ROUTINE_ID, label: "First" },
          { routineId: ROUTINE_ID_2, label: "Second" },
        ],
        agentTurn: false,
      },
    });
    expect(spec.kind).toBe("routine");
    expect(spec.routine).toEqual({
      routineId: ROUTINE_ID,
      label: "First",
      additionalActions: [{ routineId: ROUTINE_ID_2, label: "Second" }],
    });
  });

  it("maps a mixed (agentTurn:true + actions) version to agent_thread", () => {
    const spec = targetSpecFromLegacy({
      goalSpec: { objective: "Do the thing", completionCriteria: [] },
      workerSpec: { type: "agent", id: "agent-1" },
      routineActionsSpec: {
        actions: [{ routineId: ROUTINE_ID }],
        agentTurn: true,
      },
    });
    expect(spec.kind).toBe("agent_thread");
  });

  it("round-trips a derived target back through normalizeTargetSpec", () => {
    const derived = targetSpecFromLegacy({
      goalSpec: { objective: "Prepare", completionCriteria: ["done"] },
      workerSpec: { type: "agent_profile", id: "profile-1" },
    });
    expect(normalizeTargetSpec(derived)).toEqual(derived);
  });
});
