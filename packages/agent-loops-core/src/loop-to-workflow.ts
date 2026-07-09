/**
 * Automation → Workflow conversion (THINK-216).
 *
 * Maps a dispatchable agent-loop version (the same normalized shape the old
 * dispatcher consumed) onto a canonical workflow definition the shared
 * interpreter executes:
 *
 *   - routine actions (routine-only targets AND agent_thread bolt-ons, which
 *     the old dispatcher ran BEFORE the agent turn) become `routine` steps in
 *     order;
 *   - an agent turn (agentTurn !== false) becomes one `agent` step whose
 *     objective folds in the completion criteria, with the same token budget
 *     the wakeup path used;
 *   - loopPolicy.maxIterations > 1 becomes a continuation policy (in practice
 *     loop-policy is off the product surface, so migrated Automations are
 *     plain single-pass workflows).
 *
 * The result is validated before it is returned — a conversion that cannot
 * produce a valid definition throws with the loop's ThinkWork-level reason.
 */

import type { DispatchableAgentLoopVersion } from "./run-ledger";
import { DEFAULT_AGENT_LOOP_GOAL_TOKEN_BUDGET } from "./run-ledger";
import {
  validateWorkflowDefinition,
  WORKFLOW_DEFINITION_VERSION,
  type WorkflowDefinition,
  type WorkflowStep,
} from "./workflow-definition";

export function workflowDefinitionFromAgentLoopVersion(
  version: DispatchableAgentLoopVersion,
): WorkflowDefinition {
  const steps: WorkflowStep[] = [];

  const actions = version.routineActionsSpec?.actions ?? [];
  actions.forEach((action, index) => {
    steps.push({
      id: actions.length === 1 ? "routine" : `routine-${index + 1}`,
      kind: "routine",
      routineId: action.routineId,
      ...(action.input && Object.keys(action.input).length > 0
        ? { input: action.input }
        : {}),
    });
  });

  const agentTurn = version.routineActionsSpec?.agentTurn !== false;
  if (agentTurn) {
    const criteria = version.goalSpec.completionCriteria.filter((entry) =>
      entry.trim(),
    );
    const objective =
      criteria.length > 0
        ? `${version.goalSpec.objective.trim()}\n\nCompletion criteria:\n${criteria
            .map((entry) => `- ${entry}`)
            .join("\n")}`
        : version.goalSpec.objective.trim();
    steps.push({
      id: "work",
      kind: "agent",
      objective,
      tokenBudget:
        version.loopPolicy.maxTokens ?? DEFAULT_AGENT_LOOP_GOAL_TOKEN_BUDGET,
    });
  }

  const definition: WorkflowDefinition = {
    version: WORKFLOW_DEFINITION_VERSION,
    steps,
    ...(agentTurn && version.loopPolicy.maxIterations > 1
      ? {
          continuationPolicy: {
            exitSignal:
              version.goalSpec.completionCriteria.join("; ").trim() ||
              version.goalSpec.objective.trim(),
            maxIterations: version.loopPolicy.maxIterations,
          },
        }
      : {}),
    // THINK-227 U1: carry the document binding onto the definition so it is
    // self-describing. Dispatch re-resolves the live value from target_spec.
    ...(agentTurn && version.documentBinding
      ? { documentBinding: version.documentBinding }
      : {}),
  };

  const result = validateWorkflowDefinition(definition);
  if (!result.ok) {
    const detail = result.errors
      .map((error) => `${error.field}: ${error.reason}`)
      .join("; ");
    throw new Error(
      `agent-loop version ${version.id} does not convert to a valid workflow definition — ${detail}`,
    );
  }
  return result.definition;
}
