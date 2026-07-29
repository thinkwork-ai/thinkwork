/**
 * Per-run dollar budget accumulator for delegated Agent Profile runs
 * (THINK-232).
 *
 * Makes `execution_controls.costBudgetUsd` REAL for any delegated run. The
 * delegation loop owns a per-run spend accumulator in memory and charges it
 * from the final runAgentLoop `result.usage`.
 *
 * runAgentLoop does not expose per-turn usage, so overage is detected
 * POST-HOC: the run already happened, but the verdict is corrected to a
 * structured BUDGET_EXCEEDED fail so the handoff is honest. (A per-turn hook
 * would need pi-agent-core support — out of scope here.)
 *
 * No budget configured → the state is inert: it never flips `exceeded`.
 */

/**
 * Container-local token price fallback map. SOURCE OF TRUTH is
 * packages/api/src/lib/cost-recording.ts (MODEL_PRICING_FALLBACKS +
 * FALLBACK_PRICING). It is DUPLICATED here — not imported — on purpose:
 *   - the container has no DB access and must not depend on @thinkwork/api;
 *   - the API-side cost-recording path remains authoritative for BILLING;
 *   - this copy only GATES the run (fail the delegation, never bill from it).
 * Keep the two in rough sync when Bedrock pricing moves; drift here only
 * changes when a run trips its budget, never what a tenant is charged.
 * Rates are USD per 1e6 tokens. */
export const DELEGATION_MODEL_PRICING_FALLBACKS: Record<
  string,
  { input: number; output: number }
> = {
  "claude-sonnet-4": { input: 3.0, output: 15.0 },
  "claude-sonnet-4-5": { input: 3.0, output: 15.0 },
  "claude-sonnet-4-6": { input: 3.0, output: 15.0 },
  "claude-3-5-haiku": { input: 0.8, output: 4.0 },
  "claude-3-haiku": { input: 0.25, output: 1.25 },
  "kimi-k2": { input: 1.0, output: 3.0 },
  "kimi-k2-instruct": { input: 1.0, output: 3.0 },
  "gpt-oss-20b": { input: 0.05, output: 0.2 },
  "gpt-oss-120b": { input: 0.15, output: 0.6 },
};

export const DELEGATION_FALLBACK_PRICING = {
  inputPerMillion: 3.0,
  outputPerMillion: 15.0,
};

export interface DelegationTokenPricing {
  inputPerMillion: number;
  outputPerMillion: number;
}

/** Substring-match a model id to a fallback price (mirrors cost-recording.ts
 *  `matchFallbackPricing`). Unknown model → conservative fallback pricing. */
export function delegationPricingForModel(
  modelId: string | null | undefined,
): DelegationTokenPricing {
  if (!modelId) return DELEGATION_FALLBACK_PRICING;
  const lower = modelId.toLowerCase();
  for (const [key, pricing] of Object.entries(
    DELEGATION_MODEL_PRICING_FALLBACKS,
  )) {
    if (lower.includes(key)) {
      return {
        inputPerMillion: pricing.input,
        outputPerMillion: pricing.output,
      };
    }
  }
  return DELEGATION_FALLBACK_PRICING;
}

/** Token usage shape the accumulator understands (superset of the aliases
 *  runAgentLoop / pi-ai emit). Only input + output tokens are priced —
 *  cached-read pricing is out of scope for this gate. */
export interface DelegationTokenUsage {
  inputTokens?: number;
  outputTokens?: number;
}

/**
 * Per-run dollar accumulator. The delegation loop, not the model, owns it.
 * `budgetUsd === undefined` → inert.
 */
export class DelegationCostBudgetState {
  spentUsd = 0;
  exceeded = false;
  constructor(readonly budgetUsd: number | undefined) {}

  private get active(): boolean {
    return (
      typeof this.budgetUsd === "number" &&
      Number.isFinite(this.budgetUsd) &&
      this.budgetUsd > 0
    );
  }

  private recomputeExceeded(): void {
    if (this.active && this.spentUsd > (this.budgetUsd as number)) {
      this.exceeded = true;
    }
  }

  /** Charge the run's token cost (end-of-run, post-hoc). */
  addTokenCost(
    usage: DelegationTokenUsage,
    pricing: DelegationTokenPricing,
  ): void {
    if (!this.active) return;
    const input =
      typeof usage.inputTokens === "number" && usage.inputTokens > 0
        ? usage.inputTokens
        : 0;
    const output =
      typeof usage.outputTokens === "number" && usage.outputTokens > 0
        ? usage.outputTokens
        : 0;
    const cost =
      (input / 1_000_000) * pricing.inputPerMillion +
      (output / 1_000_000) * pricing.outputPerMillion;
    this.spentUsd += cost;
    this.recomputeExceeded();
  }
}

export function createDelegationCostBudgetState(
  budgetUsd: number | undefined,
): DelegationCostBudgetState {
  return new DelegationCostBudgetState(budgetUsd);
}
