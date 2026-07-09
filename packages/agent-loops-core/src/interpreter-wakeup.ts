/**
 * Pure wakeup-payload builder for the shared workflow interpreter
 * (THINK-219). The step-dispatch Lambda enqueues one agent wakeup per agent
 * step; this builds the payload it stores. No DB, no AWS — mirrors the shape
 * of buildAgentLoopWakeupPayload (run-ledger.ts) so the Pi runtime reads a
 * familiar goalMode block.
 */

import { DEFAULT_AGENT_LOOP_GOAL_TOKEN_BUDGET } from "./run-ledger";

export interface WorkflowStepWakeupPayload {
  message: string;
  threadId: null;
  spaceId: string | null;
  goalMode: {
    enabled: true;
    action: "start";
    objective: string;
    /**
     * Pi's goal_run_id is per-iteration and DISTINCT from the workflow run id:
     * `${workflowRunId}:${iteration}`. Each interpreter iteration is its own
     * goal run — this resolves the identity question so a rerun of the same
     * workflow run never collides with a prior iteration's goal state.
     */
    goalRunId: string;
    resolvedBudget: { tokenBudget: number };
  };
  workflowRun: {
    runId: string;
    workflowName: string | null;
    stepId: string;
    iteration: number;
    policySummary: {
      exitSignal: string | null;
      maxIterations: number | null;
    };
  };
  /**
   * THINK-227 U2 (KTD2): compat block for the bound-document emission reader.
   * The turn's context_snapshot spreads the wakeup payload verbatim, and the
   * emission enforcement reads `context_snapshot.agentLoop.documentId` — the
   * same slot the legacy agent-loop payload carries. Present only when the
   * workflow's source automation has a document binding, so unbound workflow
   * payloads are unchanged.
   */
  agentLoop?: {
    documentId: string;
  };
}

export function buildWorkflowStepWakeupPayload(input: {
  workflowRunId: string;
  workflowName?: string | null;
  stepId: string;
  iteration: number;
  objective: string;
  tokenBudget?: number | null;
  exitSignal?: string | null;
  maxIterations?: number | null;
  spaceId?: string | null;
  /** THINK-227 U2: the bound document's artifact id, resolved from the source
   * automation's live target_spec at dispatch. Null/absent when unbound. */
  documentId?: string | null;
}): WorkflowStepWakeupPayload {
  return {
    message: input.objective,
    threadId: null,
    spaceId: input.spaceId ?? null,
    goalMode: {
      enabled: true,
      action: "start",
      objective: input.objective,
      goalRunId: `${input.workflowRunId}:${input.iteration}`,
      resolvedBudget: {
        tokenBudget: input.tokenBudget ?? DEFAULT_AGENT_LOOP_GOAL_TOKEN_BUDGET,
      },
    },
    workflowRun: {
      runId: input.workflowRunId,
      workflowName: input.workflowName ?? null,
      stepId: input.stepId,
      iteration: input.iteration,
      policySummary: {
        exitSignal: input.exitSignal ?? null,
        maxIterations: input.maxIterations ?? null,
      },
    },
    // KTD2 compat block: present only when bound, so unbound workflow payloads
    // are byte-identical to the pre-THINK-227 shape.
    ...(input.documentId
      ? { agentLoop: { documentId: input.documentId } }
      : {}),
  };
}
