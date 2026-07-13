import { describe, it, expect } from "vitest";

import type { OperationContract } from "@thinkwork/capability-contracts";
import {
  authorizeAction,
  type ReloadedAuthorization,
  type PolicyRequest,
} from "../lib/capability-broker/policy.js";

const CONTRACT_HASH = "a".repeat(64);

function operation(
  overrides: Partial<OperationContract> = {},
): OperationContract {
  return {
    operationId: "op.read",
    summary: "Read a thing",
    effect: "read",
    targetScope: { kind: "open_world" },
    reversibility: "reversible",
    idempotency: "idempotent",
    principalModes: ["service"],
    approvalPolicy: "never",
    inputSchema: { type: "object" },
    outputSchema: { type: "object" },
    inputDataClass: "internal",
    outputDataClass: "internal",
    costClass: "low",
    latencyClass: "interactive",
    outputClass: "inline",
    ...overrides,
  };
}

function auth(
  overrides: Partial<ReloadedAuthorization> = {},
): ReloadedAuthorization {
  return {
    operation: operation(),
    currentContractHash: CONTRACT_HASH,
    grant: { allowedEffects: ["read"] },
    binding: {
      readiness: "ready",
      principalMode: "service",
      subjectId: "sp-1",
    },
    approval: { policy: "never", satisfied: true },
    budget: { withinLimits: true },
    ...overrides,
  };
}

const request: PolicyRequest = {
  requestedContractHash: CONTRACT_HASH,
  principal: { mode: "service", subjectId: "sp-1" },
};

describe("capability-broker action-time policy", () => {
  it("allows a fully authorized read and reports the resolved effect", () => {
    const decision = authorizeAction(auth(), request);
    expect(decision.allowed).toBe(true);
    if (decision.allowed) {
      expect(decision.effect).toBe("read");
      expect(decision.decisions.grant).toBe("present");
      expect(decision.decisions.budget).toBe("within_limits");
    }
  });

  it("blocks when the operation no longer resolves (grant/version pulled)", () => {
    const decision = authorizeAction(
      auth({ operation: null, currentContractHash: null }),
      request,
    );
    expect(decision).toMatchObject({
      allowed: false,
      category: "policy_blocked",
      reason: "operation_unavailable",
    });
  });

  it("blocks on contract-hash mismatch even with a valid signature", () => {
    const decision = authorizeAction(
      auth({ currentContractHash: "b".repeat(64) }),
      request,
    );
    expect(decision).toMatchObject({
      allowed: false,
      category: "policy_blocked",
      reason: "contract_mismatch",
    });
  });

  it("blocks when the grant has been removed", () => {
    const decision = authorizeAction(auth({ grant: null }), request);
    expect(decision).toMatchObject({
      allowed: false,
      category: "policy_blocked",
      reason: "grant_removed",
    });
  });

  it("blocks when no binding resolves", () => {
    const decision = authorizeAction(auth({ binding: null }), request);
    expect(decision).toMatchObject({
      allowed: false,
      category: "readiness_blocked",
      reason: "binding_missing",
    });
  });

  it("blocks on principal mismatch with no cross-mode fallback", () => {
    const decision = authorizeAction(
      auth({
        binding: {
          readiness: "ready",
          principalMode: "agent_owner",
          subjectId: "u-9",
        },
      }),
      request,
    );
    expect(decision).toMatchObject({
      allowed: false,
      category: "policy_blocked",
      reason: "principal_mismatch",
    });
  });

  it("blocks when the binding is degraded", () => {
    const decision = authorizeAction(
      auth({
        binding: {
          readiness: "degraded",
          principalMode: "service",
          subjectId: "sp-1",
        },
      }),
      request,
    );
    expect(decision).toMatchObject({
      allowed: false,
      category: "readiness_blocked",
      reason: "binding_degraded",
    });
  });

  it("blocks when the binding is revoked", () => {
    const decision = authorizeAction(
      auth({
        binding: {
          readiness: "revoked",
          principalMode: "service",
          subjectId: "sp-1",
        },
      }),
      request,
    );
    expect(decision).toMatchObject({
      allowed: false,
      category: "readiness_blocked",
      reason: "binding_revoked",
    });
  });

  it("blocks an operation with an unknown classification (fail closed)", () => {
    const decision = authorizeAction(
      auth({ operation: operation({ costClass: "unknown" }) }),
      request,
    );
    expect(decision).toMatchObject({
      allowed: false,
      category: "policy_blocked",
      reason: "unknown_classification",
    });
  });

  it("blocks a credential-classified operation (never executable in v1)", () => {
    const decision = authorizeAction(
      auth({ operation: operation({ outputDataClass: "credential" }) }),
      request,
    );
    expect(decision).toMatchObject({
      allowed: false,
      category: "policy_blocked",
      reason: "unknown_classification",
    });
  });

  it("blocks a forbidden effect not covered by the grant", () => {
    const decision = authorizeAction(
      auth({
        operation: operation({ effect: "delete" }),
        grant: { allowedEffects: ["read"] },
      }),
      request,
    );
    expect(decision).toMatchObject({
      allowed: false,
      category: "policy_blocked",
      reason: "forbidden_effect",
    });
  });

  it("blocks when approval is required but not satisfied", () => {
    const decision = authorizeAction(
      auth({
        operation: operation({ approvalPolicy: "always" }),
        approval: { policy: "always", satisfied: false },
      }),
      request,
    );
    expect(decision).toMatchObject({
      allowed: false,
      category: "approval_required",
      reason: "approval_required",
    });
  });

  it("allows when a required approval is satisfied", () => {
    const decision = authorizeAction(
      auth({
        operation: operation({ approvalPolicy: "once" }),
        approval: { policy: "once", satisfied: true },
      }),
      request,
    );
    expect(decision.allowed).toBe(true);
  });

  it("blocks when the budget is exhausted", () => {
    const decision = authorizeAction(
      auth({ budget: { withinLimits: false, reason: "day_cap_reached" } }),
      request,
    );
    expect(decision).toMatchObject({
      allowed: false,
      category: "budget_exhausted",
      reason: "day_cap_reached",
    });
  });
});
