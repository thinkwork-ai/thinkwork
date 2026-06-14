/**
 * Per-tenant skill-update gate threshold (Skill Tests & Evals U6).
 *
 * A skill UPDATE whose candidate version scores BELOW this threshold has
 * its workspace swap DEFERRED: the candidate is scored against a transient
 * staging dataset and the swap is HELD until an operator applies it via
 * `applySkillUpdate` once the candidate passes (or overrides). A gate
 * ROW's PRESENCE = the gate is enabled for the tenant; no row = no gate
 * (nothing blocks). Initial install is never gated; unrated skills (no
 * bundled cases) are never gated (R9). Per-tenant single threshold in v1
 * (per-skill thresholds are deferred).
 *
 * LEAF MODULE: imports only the schema table (`evalSkillGate`) and the
 * db/operator re-exports from `graphql/utils.js`. It MUST NOT pull
 * `agentcore-direct.ts`, `resolve-agent-runtime-config.ts`, or
 * `oauth-token.ts` — `workspace-files.ts` and the evaluations resolver
 * import this, and a heavy transitive chain here breaks partially-mocked
 * test suites (the "No X export defined on the … mock" failure mode).
 */

import { evalSkillGate } from "@thinkwork/database-pg/schema";
import { db, eq, sql } from "../../graphql/utils.js";

/** A gate threshold must be a fraction in [0, 1] (eval pass_rate scale). */
function assertValidThreshold(threshold: number): void {
  if (
    typeof threshold !== "number" ||
    !Number.isFinite(threshold) ||
    threshold < 0 ||
    threshold > 1
  ) {
    throw new Error(
      `Skill-eval gate threshold must be a number in [0, 1]; got ${threshold}.`,
    );
  }
}

/**
 * Read the tenant's skill-update gate threshold. `null` = no gate row =
 * nothing blocks. The DB stores `numeric(5,4)` (returned as a string by
 * the driver) so it's coerced to a number here.
 */
export async function getSkillEvalGateThreshold(
  tenantId: string,
): Promise<number | null> {
  const [row] = await db
    .select({ threshold: evalSkillGate.threshold })
    .from(evalSkillGate)
    .where(eq(evalSkillGate.tenant_id, tenantId))
    .limit(1);
  if (!row || row.threshold == null) return null;
  return Number(row.threshold);
}

/**
 * Set or clear the tenant's skill-update gate threshold. A finite
 * threshold in [0, 1] UPSERTs the row (enabling the gate); `null` DELETEs
 * it (disabling the gate). Out-of-range thresholds throw — the caller
 * surfaces a BAD_USER_INPUT error rather than persisting a nonsense gate.
 */
export async function setSkillEvalGateThreshold(
  tenantId: string,
  threshold: number | null,
): Promise<void> {
  if (threshold === null) {
    await db.delete(evalSkillGate).where(eq(evalSkillGate.tenant_id, tenantId));
    return;
  }
  assertValidThreshold(threshold);
  // numeric(5,4) — store as a fixed-precision string so the CHECK and the
  // read path see the same scale as eval_runs.pass_rate.
  const value = threshold.toFixed(4);
  await db
    .insert(evalSkillGate)
    .values({ tenant_id: tenantId, threshold: value })
    .onConflictDoUpdate({
      target: evalSkillGate.tenant_id,
      set: { threshold: value, updated_at: sql`now()` },
    });
}
