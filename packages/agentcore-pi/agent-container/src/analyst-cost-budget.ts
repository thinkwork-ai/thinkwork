/**
 * Analyst per-run dollar budget accumulator (THINK-232).
 *
 * Makes `execution_controls.costBudgetUsd` REAL for delegated analyst runs.
 * The delegation loop owns a per-run spend accumulator in memory, mirroring
 * the per-run query cap (analyst-query-cap.ts). Two cost sources feed it:
 *
 *   1. DB query cost — charged at the tool-wrapper seam after each successful
 *      `query`, from the envelope's `row_count` and `approx_bytes`. When the
 *      accumulator crosses the budget, subsequent query calls fail FAST
 *      (AnalystCostBudgetError), exactly like the query cap.
 *
 *   2. Token cost — charged at run END from the final runAgentLoop
 *      `result.usage`. runAgentLoop does not expose per-turn usage, so token
 *      overage is detected POST-HOC: the run already happened, but the
 *      verdict is corrected to a structured BUDGET_EXCEEDED fail so the
 *      handoff is honest. (A per-turn hook would need pi-agent-core support —
 *      out of scope here.)
 *
 * Asymmetry, restated: query cost fails fast mid-run; token cost is detected
 * at run end. Both flip `exceeded`, and both terminate through the same
 * checkpoints the query cap uses in agent-profile-delegation.ts.
 *
 * No budget configured → the state is inert: it never flips `exceeded`.
 */

/** Provisional DB cost rates (THINK-232). Documented as provisional: these
 *  gate the run only — they are NOT billing-authoritative. Exported for
 *  tests. */
export const ANALYST_DB_COST_PER_MILLION_ROWS = 0.02; // $ per 1e6 rows
export const ANALYST_DB_COST_PER_GB = 0.05; // $ per GiB of result bytes
const BYTES_PER_GB = 1024 * 1024 * 1024;

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
export const ANALYST_MODEL_PRICING_FALLBACKS: Record<
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

export const ANALYST_FALLBACK_PRICING = {
  inputPerMillion: 3.0,
  outputPerMillion: 15.0,
};

export interface AnalystTokenPricing {
  inputPerMillion: number;
  outputPerMillion: number;
}

/** Substring-match a model id to a fallback price (mirrors cost-recording.ts
 *  `matchFallbackPricing`). Unknown model → conservative FALLBACK_PRICING. */
export function analystPricingForModel(
  modelId: string | null | undefined,
): AnalystTokenPricing {
  if (!modelId) return ANALYST_FALLBACK_PRICING;
  const lower = modelId.toLowerCase();
  for (const [key, pricing] of Object.entries(
    ANALYST_MODEL_PRICING_FALLBACKS,
  )) {
    if (lower.includes(key)) {
      return {
        inputPerMillion: pricing.input,
        outputPerMillion: pricing.output,
      };
    }
  }
  return ANALYST_FALLBACK_PRICING;
}

/** Token usage shape the accumulator understands (superset of the aliases
 *  runAgentLoop / pi-ai emit). Only input + output tokens are priced —
 *  cached-read pricing is out of scope for this gate. */
export interface AnalystTokenUsage {
  inputTokens?: number;
  outputTokens?: number;
}

/**
 * Per-run dollar accumulator. Mirrors AnalystQueryCapState's role: the
 * delegation loop, not the model, owns it. `budgetUsd === undefined` → inert.
 */
export class AnalystCostBudgetState {
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

  /** Charge one query's DB cost from its envelope row_count + approx_bytes. */
  addQueryCost(rowCount: number, approxBytes: number): void {
    if (!this.active) return;
    const rows = Number.isFinite(rowCount) && rowCount > 0 ? rowCount : 0;
    const bytes =
      Number.isFinite(approxBytes) && approxBytes > 0 ? approxBytes : 0;
    const rowsCost = (rows / 1_000_000) * ANALYST_DB_COST_PER_MILLION_ROWS;
    const bytesCost = (bytes / BYTES_PER_GB) * ANALYST_DB_COST_PER_GB;
    this.spentUsd += rowsCost + bytesCost;
    this.recomputeExceeded();
  }

  /** Charge the run's token cost (end-of-run, post-hoc). */
  addTokenCost(usage: AnalystTokenUsage, pricing: AnalystTokenPricing): void {
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

export function createAnalystCostBudgetState(
  budgetUsd: number | undefined,
): AnalystCostBudgetState {
  return new AnalystCostBudgetState(budgetUsd);
}

/** Fast-fail thrown when a query is attempted after the cost budget is spent.
 *  Mirrors AnalystQueryCapError: the loop owns the verdict, not the model. */
export class AnalystCostBudgetError extends Error {
  constructor(
    readonly budgetUsd: number,
    readonly spentUsd: number,
  ) {
    super(
      `COST_BUDGET_EXCEEDED: this delegation already spent about ` +
        `$${spentUsd.toFixed(4)} of its $${budgetUsd.toFixed(2)} cost budget. ` +
        "No further queries are allowed in this run — return your findings " +
        "from the data you have.",
    );
    this.name = "AnalystCostBudgetError";
  }
}
