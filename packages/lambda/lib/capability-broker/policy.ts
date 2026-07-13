/**
 * Capability broker action-time authorization (THINK-280 U3).
 *
 * Pure, exhaustive, fail-closed. The broker RE-AUTHORIZES on every call from
 * freshly reloaded state — the session snapshot is an upper bound, never
 * cached authorization. This function receives the reloaded grant, contract,
 * binding, approval, budget, and principal facts plus the parsed request and
 * returns either an allow (with the resolved effect) or a typed rejection
 * mapped to a {@link BrokerErrorCategory}.
 *
 * Order matters: cheaper structural gates first, credential/readiness before
 * effect, approval and budget last, so the recorded decision trail explains
 * the FIRST reason a call was blocked.
 */

import type {
  BindingReadinessState,
  BrokerErrorCategory,
  OperationContract,
  OperationEffect,
  PrincipalMode,
} from "@thinkwork/capability-contracts";
import { operationExecutabilityViolations } from "@thinkwork/capability-contracts";

export interface PolicyPrincipalSelection {
  mode: PrincipalMode;
  subjectId: string;
}

/**
 * Freshly reloaded authorization state for one operation. Every field is a
 * point-in-time reload; nothing here is trusted from the session snapshot.
 */
export interface ReloadedAuthorization {
  /** The signed operation contract from the current admitted version, or null. */
  operation: OperationContract | null;
  /** Current contract hash (hex) for the operation, or null when unavailable. */
  currentContractHash: string | null;
  /** Grant covering this operation, or null when removed/revoked. */
  grant: { allowedEffects: OperationEffect[] } | null;
  /** Resolved credential binding for the session principal, or null. */
  binding: {
    readiness: BindingReadinessState;
    principalMode: PrincipalMode;
    subjectId: string;
  } | null;
  approval: { policy: "never" | "once" | "always"; satisfied: boolean };
  budget: { withinLimits: boolean; reason?: string };
}

export interface PolicyRequest {
  /** Contract hash carried by the twcap operation reference the caller signed. */
  requestedContractHash: string;
  principal: PolicyPrincipalSelection;
}

export type PolicyDecision =
  | {
      allowed: true;
      effect: OperationEffect;
      decisions: Record<string, string>;
    }
  | {
      allowed: false;
      category: BrokerErrorCategory;
      reason: string;
      decisions: Record<string, string>;
    };

/**
 * Decide whether an authenticated, replay-checked request may dispatch. A
 * valid session signature is necessary but never sufficient — each gate below
 * can still block dispatch.
 */
export function authorizeAction(
  auth: ReloadedAuthorization,
  request: PolicyRequest,
): PolicyDecision {
  const decisions: Record<string, string> = {};

  // 1. The operation must still resolve to an admitted, contracted version.
  if (!auth.operation || !auth.currentContractHash) {
    return {
      allowed: false,
      category: "policy_blocked",
      reason: "operation_unavailable",
      decisions: { operation: "unavailable" },
    };
  }
  decisions.operation = "resolved";

  // 2. The signed contract hash must match the current contract exactly.
  if (request.requestedContractHash !== auth.currentContractHash) {
    return {
      allowed: false,
      category: "policy_blocked",
      reason: "contract_mismatch",
      decisions: { ...decisions, contract: "mismatch" },
    };
  }
  decisions.contract = "match";

  // 3. A grant covering the operation must still exist.
  if (!auth.grant) {
    return {
      allowed: false,
      category: "policy_blocked",
      reason: "grant_removed",
      decisions: { ...decisions, grant: "removed" },
    };
  }
  decisions.grant = "present";

  // 4. A credential binding must resolve, and the session principal must match
  //    it exactly — no cross-mode fallback.
  if (!auth.binding) {
    return {
      allowed: false,
      category: "readiness_blocked",
      reason: "binding_missing",
      decisions: { ...decisions, binding: "missing" },
    };
  }
  const modeMatches =
    auth.binding.principalMode === request.principal.mode &&
    auth.binding.subjectId === request.principal.subjectId &&
    auth.operation.principalModes.includes(request.principal.mode);
  if (!modeMatches) {
    return {
      allowed: false,
      category: "policy_blocked",
      reason: "principal_mismatch",
      decisions: { ...decisions, principal: "mismatch" },
    };
  }
  decisions.principal = "match";

  // 5. The binding must be READY (a degraded/revoked/pending binding blocks).
  if (auth.binding.readiness !== "ready") {
    return {
      allowed: false,
      category: "readiness_blocked",
      reason: `binding_${auth.binding.readiness}`,
      decisions: { ...decisions, readiness: auth.binding.readiness },
    };
  }
  decisions.readiness = "ready";

  // 6. The operation contract must be executable — missing/`unknown`
  //    security-relevant annotations (cost/latency/output) or a `credential`
  //    data class withhold execution (fail closed, U1 semantics).
  const execViolations = operationExecutabilityViolations(auth.operation);
  if (execViolations.length > 0) {
    return {
      allowed: false,
      category: "policy_blocked",
      reason: "unknown_classification",
      decisions: {
        ...decisions,
        classification: execViolations.join(","),
      },
    };
  }
  decisions.classification = "executable";

  // 7. The grant must permit the operation's effect (destructive/data gate).
  if (!auth.grant.allowedEffects.includes(auth.operation.effect)) {
    return {
      allowed: false,
      category: "policy_blocked",
      reason: "forbidden_effect",
      decisions: { ...decisions, effect: `forbidden:${auth.operation.effect}` },
    };
  }
  decisions.effect = auth.operation.effect;

  // 8. Approval, when the contract requires it, must be satisfied.
  if (auth.approval.policy !== "never" && !auth.approval.satisfied) {
    return {
      allowed: false,
      category: "approval_required",
      reason: "approval_required",
      decisions: { ...decisions, approval: "required" },
    };
  }
  decisions.approval =
    auth.approval.policy === "never" ? "not_required" : "satisfied";

  // 9. Budgets must not be exhausted.
  if (!auth.budget.withinLimits) {
    return {
      allowed: false,
      category: "budget_exhausted",
      reason: auth.budget.reason ?? "budget_exhausted",
      decisions: { ...decisions, budget: "exhausted" },
    };
  }
  decisions.budget = "within_limits";

  return { allowed: true, effect: auth.operation.effect, decisions };
}
