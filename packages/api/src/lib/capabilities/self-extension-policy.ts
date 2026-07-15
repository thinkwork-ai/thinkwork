/**
 * Autonomous capability self-extension — risk classifier (governed autonomy).
 *
 * The single source of truth for the tier an agent-composed capability lands in
 * when an agent extends itself. THINK-280 built the safe substrate (brokered,
 * isolated, evidenced, revocable); this decides WHEN a human reviews:
 *
 *   - `auto`      → the agent may self-admit + self-approve + run with NO human.
 *                   Reserved for public, read-only, no-credential, reversible,
 *                   fully-classified operations — the blast radius is a read of
 *                   public data.
 *   - `review`    → the agent composes and tests the whole capability, but it is
 *                   held for one-click operator approval before its first run
 *                   (credentialed reads, any write, elevated cost/data class).
 *   - `forbidden` → the operation is not eligible for autonomous composition at
 *                   all (fails execution classification: unknown cost/latency/
 *                   output, or a credential data class).
 *
 * FAIL-CLOSED by construction: `forbidden` unless executable; `review` unless
 * PROVABLY `auto`. A missing/malformed field never yields `auto`.
 *
 * Pure and dependency-free so it is trivially testable and reused identically at
 * self-admission (over the whole descriptor) and at self-approval (over each
 * pinned dependency's operation contract).
 */

import {
  operationExecutabilityViolations,
  type CapabilityDescriptor,
  type OperationContract,
} from "@thinkwork/capability-contracts";

export type SelfExtensionTier = "auto" | "review" | "forbidden";

export interface OperationClassification {
  operationId: string;
  tier: SelfExtensionTier;
  /** Human-readable reasons the op is NOT `auto` (or IS `forbidden`). Empty for `auto`. */
  reasons: string[];
}

export interface DescriptorClassification {
  /** The worst tier across all operations (`forbidden` > `review` > `auto`). */
  tier: SelfExtensionTier;
  operations: OperationClassification[];
}

/** Effects that do not change provider state — the only ones eligible for `auto`. */
const READ_ONLY_EFFECTS = new Set(["none", "read"]);
/** Cost classes cheap enough to run without a human budget decision. */
const AUTO_COST_CLASSES = new Set(["free", "low"]);
/** Data classes safe to move without review. Tighter than executability (which
 *  only forbids `credential`); confidential/restricted still warrant a human. */
const AUTO_DATA_CLASSES = new Set(["public", "internal"]);

/**
 * Classify a single operation contract for autonomous self-extension. The
 * `descriptor` is required because the credential requirement lives at the
 * descriptor level (`bindingRequirements.credentialKinds`), not per-operation.
 */
export function classifyOperation(
  op: OperationContract,
  descriptor: Pick<CapabilityDescriptor, "bindingRequirements">,
): OperationClassification {
  // 1. Not executable at all → forbidden (unknown classifications, credential
  //    data class). Reuses the shared fail-closed execution gate.
  const execViolations = operationExecutabilityViolations(op);
  if (execViolations.length > 0) {
    return {
      operationId: op.operationId,
      tier: "forbidden",
      reasons: execViolations,
    };
  }

  // 2. Executable — is it provably AUTO? Collect every reason it is not, so the
  //    UI can explain "held for review because …".
  const reasons: string[] = [];

  if (!READ_ONLY_EFFECTS.has(op.effect)) {
    reasons.push(`effect '${op.effect}' changes provider state`);
  }
  if (op.reversibility !== "reversible") {
    reasons.push(`reversibility '${op.reversibility}' is not reversible`);
  }

  // Credential requirement (descriptor-level). Fail-closed: a missing/malformed
  // credentialKinds array is treated as "requires a credential".
  const credentialKinds = descriptor.bindingRequirements?.credentialKinds;
  if (!Array.isArray(credentialKinds) || credentialKinds.length > 0) {
    reasons.push(
      Array.isArray(credentialKinds)
        ? `requires credential (${credentialKinds.join(", ")})`
        : "credential requirement is unspecified",
    );
  }

  if (!AUTO_COST_CLASSES.has(op.costClass)) {
    reasons.push(`costClass '${op.costClass}' exceeds the auto ceiling`);
  }
  if (!AUTO_DATA_CLASSES.has(op.inputDataClass)) {
    reasons.push(`inputDataClass '${op.inputDataClass}' warrants review`);
  }
  if (!AUTO_DATA_CLASSES.has(op.outputDataClass)) {
    reasons.push(`outputDataClass '${op.outputDataClass}' warrants review`);
  }

  return {
    operationId: op.operationId,
    tier: reasons.length === 0 ? "auto" : "review",
    reasons,
  };
}

const TIER_SEVERITY: Record<SelfExtensionTier, number> = {
  auto: 0,
  review: 1,
  forbidden: 2,
};

/** The worst (most restrictive) tier wins. */
export function worstTier(tiers: SelfExtensionTier[]): SelfExtensionTier {
  let worst: SelfExtensionTier = "auto";
  for (const t of tiers) {
    if (TIER_SEVERITY[t] > TIER_SEVERITY[worst]) worst = t;
  }
  return worst;
}

/**
 * Classify a whole capability descriptor: the tier is the worst across all its
 * operations. A descriptor with no operations is `forbidden` (malformed — never
 * silently `auto`).
 */
export function classifyDescriptor(
  descriptor: CapabilityDescriptor,
): DescriptorClassification {
  const ops = Array.isArray(descriptor.operations) ? descriptor.operations : [];
  if (ops.length === 0) {
    return {
      tier: "forbidden",
      operations: [],
    };
  }
  const operations = ops.map((op) => classifyOperation(op, descriptor));
  return {
    tier: worstTier(operations.map((o) => o.tier)),
    operations,
  };
}

/** Convenience: is this descriptor fully self-admissible with no human? */
export function isAutoAdmissible(descriptor: CapabilityDescriptor): boolean {
  return classifyDescriptor(descriptor).tier === "auto";
}
