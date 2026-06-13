/**
 * AgentCore Evaluations adapter — engine #2 skeleton behind the
 * ScoringEngine contract (Trust Core U10).
 *
 * Implements the contract over the currently-stubbed built-in evaluator
 * path ("economy mode"): every selected evaluator id comes back as a
 * skipped stub with source:"agentcore", exactly the rows the
 * pre-contract worker persisted into eval_results.evaluator_results.
 *
 * ACTIVATION IS DEFERRED (its own follow-up PR, with cost controls):
 * this module makes NO AgentCore Evaluations API calls and must not
 * import any bedrock-agentcore SDK. The existing
 * EVAL_AGENTCORE_EVALUATORS env gate stays the activation switch —
 * with the gate off OR on, today's behavior is identical (skipped
 * stubs); the gate-on branch only marks where real evaluator
 * invocation lands.
 */
import type {
  EngineScoringInput,
  EngineScoringResult,
  EvalEvaluatorResult,
  ScoringEngine,
} from "@thinkwork/evals-core";

export const EVAL_AGENTCORE_ENGINE_ID = "agentcore";

export function agentCoreEvaluatorsEnabled(
  value = process.env.EVAL_AGENTCORE_EVALUATORS,
): boolean {
  return ["1", "true", "enabled", "always", "full"].includes(
    (value ?? "disabled").toLowerCase(),
  );
}

function skippedBuiltInEvaluator(evaluatorId: string): EvalEvaluatorResult {
  return {
    evaluator_id: evaluatorId,
    source: "agentcore",
    value: null,
    label: "skipped",
    explanation:
      "Skipped by eval-worker economy mode. Computer-task eval execution currently uses in-house scoring only.",
    skipped: true,
  };
}

export function createAgentCoreScoringEngine(): ScoringEngine {
  return {
    id: EVAL_AGENTCORE_ENGINE_ID,
    async score(input: EngineScoringInput): Promise<EngineScoringResult> {
      const evaluatorIds = input.evaluatorIds ?? [];
      if (agentCoreEvaluatorsEnabled()) {
        // ACTIVATION SEAM (deferred): real AgentCore Evaluations calls
        // land here in the activation PR. Until then the gate-on path
        // returns the same skipped stubs as gate-off — persisted shapes
        // must not change ahead of activation.
      }
      return {
        verdicts: evaluatorIds.map(skippedBuiltInEvaluator),
        assertions: [],
      };
    },
  };
}
