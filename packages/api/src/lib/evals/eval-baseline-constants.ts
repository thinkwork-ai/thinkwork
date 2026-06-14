/**
 * Eval-baseline agent identity constants — leaf module with NO heavy
 * imports (Skill Tests & Evals U3).
 *
 * `eval-baseline-agent.ts` pulls in S3, workspace bootstrap, the catalog
 * installer, and the dataset store. Modules that only need the `source`
 * marker to EXCLUDE the hidden agent from a listing (e.g.
 * `tenantToolInventory.query.ts`) import these constants from here so they
 * don't drag that whole chain — which broke partially-mocked test suites
 * with a `drizzle-orm`/`@thinkwork/database-pg` "missing export" error.
 */

/**
 * `agents.source` value marking the hidden per-tenant eval-baseline agent.
 * Tenant-wide agent listings exclude it; `is_platform_default: false`
 * keeps it out of platform-agent resolution.
 */
export const EVAL_BASELINE_AGENT_SOURCE = "eval-baseline";

/** Reserved per-tenant name for the eval-baseline agent. */
export const EVAL_BASELINE_AGENT_NAME = "Eval Baseline (system)";
