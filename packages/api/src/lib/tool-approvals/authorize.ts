/**
 * Tool-approval resolution authorization (THINK-302 U11 — R33, KTD-13).
 *
 * The single server-side authority for who may resolve (approve / deny /
 * cancel) a parked tool approval. Every path — web mutation, Slack deep-link
 * resolution, governance-feed operator cancel — passes through this one
 * helper so they cannot drift. Fail-closed: an unclassifiable request
 * requires a tenant operator.
 *
 * This resolution authorization is deliberately DISTINCT from the
 * question-answer template's "any thread participant" rule (R33): a gated
 * tool call can execute a dangerous side effect, so resolution demands the
 * requesting user themself or elevated authority — never any bystander.
 *
 * Ships pure + inert: no live caller until U11b wires the mutation.
 */

export type ApprovalAction = "approve" | "deny" | "cancel";

/** Elevated when the gated call can do real damage; standard otherwise. */
export type ApprovalTier = "elevated" | "standard" | "unclassifiable";

export interface ApprovalClassificationInput {
  /** Winning definition's approval policy from the manifest entry. */
  approval?: "never" | "once" | "always";
  /** Capability class of the gated call. */
  class?: string;
  /** Winning scope of the grant (`agent:…` | `space:…` | `user:…`). */
  sourceScope?: string;
  /** Whether the granted operation surface includes any non-read operation. */
  hasNonReadOperation?: boolean;
  /** Set when the manifest entry could not be resolved (missing/unknown). */
  unresolved?: boolean;
}

/**
 * KTD-13 classification. Elevated when ANY of:
 *   - the definition carries `approval: always`;
 *   - the class is `mcp` or `connection` with any non-read operation granted;
 *   - the winning scope is a space or user grant of an `mcp`/`connection`
 *     capability.
 * Everything else gated (`approval: once` on read-only skills/tools) is
 * standard. An unresolved entry is unclassifiable (operator-only, fail-closed).
 */
export function classifyApproval(
  input: ApprovalClassificationInput,
): ApprovalTier {
  if (input.unresolved) return "unclassifiable";
  const klass = input.class;
  const isSideEffectClass = klass === "mcp" || klass === "connection";
  const scopeIsSpaceOrUser =
    input.sourceScope?.startsWith("space:") ||
    input.sourceScope?.startsWith("user:");

  if (input.approval === "always") return "elevated";
  if (isSideEffectClass && input.hasNonReadOperation) return "elevated";
  if (isSideEffectClass && scopeIsSpaceOrUser) return "elevated";
  return "standard";
}

export interface ResolverIdentity {
  userId: string;
  /** Tenant-level role, from the caller's membership. */
  isTenantOperator: boolean;
  /**
   * Whether the caller is an admin of the thread's space. Deferred matrix
   * cell (KTD-13 open question) — default NOT sufficient for any tier.
   */
  isSpaceAdmin?: boolean;
}

export interface AuthorizeToolApprovalInput {
  action: ApprovalAction;
  tier: ApprovalTier;
  /** The parked turn's server-resolved calling user (the `once` subject). */
  requestingUserId: string | null;
  resolver: ResolverIdentity;
  /**
   * Deferred matrix decision (default false): may a space admin resolve
   * STANDARD-tier approvals in their space? Elevated/unclassifiable never.
   */
  allowSpaceAdminStandard?: boolean;
}

export interface AuthorizeResult {
  authorized: boolean;
  reason: string;
}

/**
 * The shared authorization gate. Deny is available to anyone who could
 * approve; cancel additionally to the requesting user (R32 escape hatch).
 * All checks fail closed.
 */
export function authorizeToolApprovalResolution(
  input: AuthorizeToolApprovalInput,
): AuthorizeResult {
  const { resolver, tier, requestingUserId, action } = input;
  const isRequester =
    requestingUserId !== null && resolver.userId === requestingUserId;

  // Unclassifiable → operator only, for every action (fail-closed).
  if (tier === "unclassifiable") {
    return resolver.isTenantOperator
      ? {
          authorized: true,
          reason: "operator (unclassifiable → operator-only)",
        }
      : {
          authorized: false,
          reason: "unclassifiable approval requires a tenant operator",
        };
  }

  // Cancel is the escape hatch: the requesting user may always cancel their
  // own parked call, plus anyone who could approve at this tier (R32).
  if (action === "cancel" && isRequester) {
    return { authorized: true, reason: "requester cancel (R32)" };
  }

  // Tenant operators may resolve any classifiable tier.
  if (resolver.isTenantOperator) {
    return { authorized: true, reason: "tenant operator" };
  }

  if (tier === "elevated") {
    // v1: elevated → tenant operator only (space admin explicitly NOT
    // sufficient — the deferred KTD-13 open question).
    return {
      authorized: false,
      reason: "elevated approval requires a tenant operator in v1",
    };
  }

  // Standard tier: the requesting user themself, or (deferred, default off)
  // a space admin.
  if (isRequester) {
    return { authorized: true, reason: "requesting user (standard tier)" };
  }
  if (input.allowSpaceAdminStandard && resolver.isSpaceAdmin) {
    return {
      authorized: true,
      reason: "space admin (standard tier, opt-in)",
    };
  }
  return {
    authorized: false,
    reason:
      "standard approval requires the requesting user or a tenant operator",
  };
}
