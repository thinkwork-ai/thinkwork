/**
 * Connection sidecar policy — pure types + shadow evaluator (THINK-229 U3).
 *
 * Deliberately free of S3/AWS imports so `mcp-configs.ts` (whose DB-only
 * resolution path must not load the S3 graph) can import it statically.
 * `connection-assignments.ts` re-exports everything here for read-path
 * consumers.
 */

import { getConfig } from "@thinkwork/runtime-config";

/**
 * The signed sidecar policy block (THINK-229 U3 / R10, R12): budgets,
 * audit-retention toggle, and the reserved role tier. Tamper-evident for
 * free — the block is inside the signed sidecar payload. `role_tier` is
 * RESERVED (R9): enforcement ignores it today so a future approval-gated
 * write tier is additive, not a migration.
 */
export interface ConnectionPolicyBlock {
  budgets?: {
    maxQueriesPerRun?: number;
    maxQueriesPerTenantDay?: number;
  };
  retain_sql?: boolean;
  role_tier?: string;
}

/** Parse an untrusted sidecar `policy` value; null when absent/malformed. */
export function parseConnectionPolicyBlock(
  raw: unknown,
): ConnectionPolicyBlock | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const record = raw as Record<string, unknown>;
  const block: ConnectionPolicyBlock = {};
  if (
    record.budgets &&
    typeof record.budgets === "object" &&
    !Array.isArray(record.budgets)
  ) {
    const budgets = record.budgets as Record<string, unknown>;
    const parsed: NonNullable<ConnectionPolicyBlock["budgets"]> = {};
    if (
      typeof budgets.maxQueriesPerRun === "number" &&
      Number.isFinite(budgets.maxQueriesPerRun) &&
      budgets.maxQueriesPerRun > 0
    ) {
      parsed.maxQueriesPerRun = budgets.maxQueriesPerRun;
    }
    if (
      typeof budgets.maxQueriesPerTenantDay === "number" &&
      Number.isFinite(budgets.maxQueriesPerTenantDay) &&
      budgets.maxQueriesPerTenantDay > 0
    ) {
      parsed.maxQueriesPerTenantDay = budgets.maxQueriesPerTenantDay;
    }
    block.budgets = parsed;
  }
  if (typeof record.retain_sql === "boolean") {
    block.retain_sql = record.retain_sql;
  }
  if (typeof record.role_tier === "string" && record.role_tier) {
    block.role_tier = record.role_tier;
  }
  return block;
}

/** One structured shadow-parity record (KTD5 — logged, never thrown). */
export interface ConnectionPolicyParityRecord {
  slug: string;
  parity: "ok" | "fail";
  mismatches: string[];
}

/**
 * Shadow evaluator (THINK-229 U3 / R11, KTD5): compute the policy view
 * from BOTH sources and name every divergence. The row side owns
 * transport-grade state (approved status, server enabled); the sidecar
 * side owns policy (enabled, operations, budgets, retain_sql). Enforcement
 * stays on the row until the env-gated flip, and the flip is gated on
 * clean parity over live traffic AND every provisioned connection
 * carrying a policy block.
 */
export function evaluateConnectionPolicyParity(input: {
  slug: string;
  sidecar: {
    enabled: boolean;
    operations: string[];
    policy: ConnectionPolicyBlock | null;
  };
  row: {
    enabled: boolean;
    status: string;
  };
}): ConnectionPolicyParityRecord {
  const mismatches: string[] = [];

  // A missing policy block is itself a parity FAIL (the un-refreshed
  // sidecar would otherwise read clean in shadow and flip to defaults).
  if (!input.sidecar.policy) {
    mismatches.push("policy_block_missing");
  } else {
    const budgets = input.sidecar.policy.budgets;
    if (!budgets?.maxQueriesPerRun || !budgets?.maxQueriesPerTenantDay) {
      mismatches.push("budgets_incomplete");
    }
    if (
      input.sidecar.policy.role_tier !== undefined &&
      input.sidecar.policy.role_tier !== "reader"
    ) {
      // Reserved vocabulary (R9): only `reader` exists today. Anything
      // else is a forward-schema value this build does not understand.
      mismatches.push(
        `role_tier_unrecognized:${input.sidecar.policy.role_tier}`,
      );
    }
  }

  const rowEffectiveEnabled =
    input.row.enabled && input.row.status === "approved";
  if (input.sidecar.enabled !== rowEffectiveEnabled) {
    mismatches.push(
      `enabled_divergence:sidecar=${input.sidecar.enabled},row=${rowEffectiveEnabled}`,
    );
  }

  return {
    slug: input.slug,
    parity: mismatches.length === 0 ? "ok" : "fail",
    mismatches,
  };
}

/**
 * The env-gated enforcement flip (KTD5). "row" (default) = today's
 * behavior, sidecar policy is shadow-only. "sidecar" = sidecar-derived
 * policy (budgets, retain_sql) flows into dispatch outputs for
 * enforcement (U4 consumes). Never flip before live parity is proven.
 *
 * Resolved through the SSM runtime-config document (getConfig) so the
 * flip is a document edit, not a Lambda-env redeploy — with getConfig's
 * env-wins merge as the test/incident override. The terraform variable
 * `analyst_policy_source` (default "row") feeds the document.
 */
export function resolveAnalystPolicySource(
  env?: NodeJS.ProcessEnv,
): "row" | "sidecar" {
  if (env) return env.ANALYST_POLICY_SOURCE === "sidecar" ? "sidecar" : "row";
  let value = "";
  try {
    value = getConfig("ANALYST_POLICY_SOURCE") || "";
  } catch {
    value = "";
  }
  return value === "sidecar" ? "sidecar" : "row";
}
