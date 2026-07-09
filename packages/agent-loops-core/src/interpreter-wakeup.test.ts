import { describe, expect, it } from "vitest";

import {
  buildAgentLoopWakeupPayload,
  DEFAULT_AGENT_LOOP_GOAL_TOKEN_BUDGET,
} from "./run-ledger";
import {
  boundDocumentIdFromBinding,
  boundDocumentIdFromTargetSpec,
  DEFAULT_LOOP_POLICY,
  normalizeTargetSpec,
} from "./contracts";
import { buildWorkflowStepWakeupPayload } from "./interpreter-wakeup";

describe("buildWorkflowStepWakeupPayload", () => {
  it("embeds the iteration in goalRunId, distinct from the run id", () => {
    const payload = buildWorkflowStepWakeupPayload({
      workflowRunId: "run-1",
      workflowName: "Weekly report",
      stepId: "draft",
      iteration: 3,
      objective: "Draft and share the weekly report",
      tokenBudget: 250_000,
      exitSignal: "the report document exists and is shared",
      maxIterations: 5,
      spaceId: "space-1",
    });

    expect(payload.goalMode.goalRunId).toBe("run-1:3");
    expect(payload.goalMode.goalRunId).not.toBe(payload.workflowRun.runId);
    expect(payload.message).toBe("Draft and share the weekly report");
    expect(payload.goalMode.objective).toBe(
      "Draft and share the weekly report",
    );
    expect(payload.goalMode.resolvedBudget.tokenBudget).toBe(250_000);
    expect(payload.spaceId).toBe("space-1");
    expect(payload.threadId).toBeNull();
  });

  it("carries workflowRun context with the policy summary", () => {
    const payload = buildWorkflowStepWakeupPayload({
      workflowRunId: "run-2",
      workflowName: "Nightly sweep",
      stepId: "sweep",
      iteration: 1,
      objective: "Sweep the queue",
      exitSignal: "queue is empty",
      maxIterations: 10,
    });

    expect(payload.workflowRun).toEqual({
      runId: "run-2",
      workflowName: "Nightly sweep",
      stepId: "sweep",
      iteration: 1,
      policySummary: { exitSignal: "queue is empty", maxIterations: 10 },
    });
  });

  it("defaults the token budget and nullable context", () => {
    const payload = buildWorkflowStepWakeupPayload({
      workflowRunId: "run-3",
      stepId: "step",
      iteration: 1,
      objective: "Do the thing",
    });

    expect(payload.goalMode.resolvedBudget.tokenBudget).toBe(
      DEFAULT_AGENT_LOOP_GOAL_TOKEN_BUDGET,
    );
    expect(payload.workflowRun.workflowName).toBeNull();
    expect(payload.spaceId).toBeNull();
    expect(payload.workflowRun.policySummary).toEqual({
      exitSignal: null,
      maxIterations: null,
    });
  });

  it("emits the agentLoop compat block only when a documentId is supplied (THINK-227 U2)", () => {
    const bound = buildWorkflowStepWakeupPayload({
      workflowRunId: "run-4",
      stepId: "work",
      iteration: 1,
      objective: "Refresh the report",
      documentId: "art-42",
    });
    expect(bound.agentLoop).toEqual({ documentId: "art-42" });

    const unbound = buildWorkflowStepWakeupPayload({
      workflowRunId: "run-5",
      stepId: "work",
      iteration: 1,
      objective: "Do the thing",
    });
    expect("agentLoop" in unbound).toBe(false);
  });
});

// THINK-227 U2 (KTD2) payload parity: both wakeup builders — the legacy
// agent-loop payload and the interpreter step payload — must surface the SAME
// bound artifact id at `agentLoop.documentId`, because the emission reader
// consumes exactly that slot from the turn's context_snapshot on both runners.
describe("bound-document payload parity across builders", () => {
  const spec = normalizeTargetSpec({
    kind: "agent_thread",
    agentThread: {
      instructions: "Refresh the pipeline report",
      threadMode: "new_per_run",
    },
    documentBinding: {
      mode: "create",
      genre: "report",
      title: "Weekly Pipeline Report",
      spaceId: "space-1",
      capturedArtifactId: "art-42",
    },
  });

  it("the two resolvers agree, and both builders emit the same slot", () => {
    const boundId = boundDocumentIdFromTargetSpec(spec);
    expect(boundId).toBe("art-42");
    expect(boundDocumentIdFromBinding(spec.documentBinding)).toBe(boundId);

    const legacy = buildAgentLoopWakeupPayload({
      loop: {
        id: "loop-1",
        tenantId: "tenant-1",
        name: "Weekly Pipeline Report",
        enabled: true,
        lifecycleStatus: "active",
      },
      version: {
        id: "v-1",
        versionStatus: "active",
        goalSpec: { objective: "Refresh", completionCriteria: [] },
        workerSpec: { type: "agent", id: "agent-1", toolHints: [], config: {} },
        loopPolicy: DEFAULT_LOOP_POLICY,
        targetKind: "agent_thread",
        documentBinding: spec.documentBinding,
      },
      trigger: {
        family: "schedule",
        source: "agent_loop_schedule",
        documentId: boundDocumentIdFromBinding(spec.documentBinding),
      },
      runId: "run-1",
      iterationId: "iter-1",
    });

    const interpreter = buildWorkflowStepWakeupPayload({
      workflowRunId: "wfr-1",
      stepId: "work",
      iteration: 1,
      objective: "Refresh",
      documentId: boundDocumentIdFromTargetSpec(spec),
    });

    expect(legacy.agentLoop.documentId).toBe("art-42");
    expect(interpreter.agentLoop?.documentId).toBe("art-42");
    expect(legacy.agentLoop.documentId).toBe(interpreter.agentLoop?.documentId);
  });
});
