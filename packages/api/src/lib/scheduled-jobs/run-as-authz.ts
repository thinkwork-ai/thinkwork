/**
 * Run-as authorization for scheduled/wakeup jobs (THINK-302 U7 — R28, KTD-14).
 *
 * A scheduled or wakeup turn may run AS a specific user so it composes that
 * user's (and the run-in-space's) capability scopes. Because run-as grants a
 * job the target user's capabilities, WHO may set it and WHETHER it still
 * holds at dispatch are security decisions — centralized here as two pure
 * functions so the GraphQL mutation (save-time) and the dispatcher
 * (dispatch-time) cannot drift.
 *
 * Save-time (`authorizeRunAsAssignment`): an ordinary member may set run-as
 * to THEMSELF only; assigning any OTHER user requires a tenant operator. The
 * target must be an active member of the same tenant, and — when the job runs
 * in a private space — a member of that space. Fail-closed.
 *
 * Dispatch-time (`revalidateRunAsAtDispatch`): re-runs the membership/active
 * checks at fire time. A stale run-as (user deactivated, or removed from a
 * required private space) does NOT silently keep the grant and does NOT
 * substitute another identity — the turn drops to root + sub-agent only and
 * surfaces a visible downgrade.
 *
 * Both functions take already-resolved facts (membership, roles, space
 * visibility) so they are pure and unit-testable; the DB reads live in the
 * caller.
 */

export type RunAsTargetMembership = {
  /** The run-as user is an active member of the job's tenant. */
  isActiveTenantMember: boolean;
  /**
   * The job's run-in-space is private (access-controlled). When false the
   * space is public/open and space membership is not required.
   */
  runInSpaceIsPrivate: boolean;
  /** The run-as user is a member of the job's run-in-space. */
  isRunInSpaceMember: boolean;
};

export interface AuthorizeRunAsInput {
  /** The user id being assigned as run-as (null clears run-as). */
  runAsUserId: string | null;
  /** The actor performing the save. */
  actor: { userId: string; isTenantOperator: boolean };
  /** Resolved facts about the target; required when runAsUserId is non-null. */
  target?: RunAsTargetMembership;
}

export type AuthorizeRunAsResult = { ok: true } | { ok: false; reason: string };

export function authorizeRunAsAssignment(
  input: AuthorizeRunAsInput,
): AuthorizeRunAsResult {
  // Clearing run-as is always allowed (the job degrades to root-only).
  if (input.runAsUserId === null) return { ok: true };

  const assigningSelf = input.runAsUserId === input.actor.userId;
  if (!assigningSelf && !input.actor.isTenantOperator) {
    return {
      ok: false,
      reason: "assigning run-as to another user requires a tenant operator",
    };
  }

  const target = input.target;
  if (!target) {
    // A non-null run-as with no resolved target facts is unverifiable →
    // fail closed.
    return { ok: false, reason: "run-as target membership is unresolved" };
  }
  if (!target.isActiveTenantMember) {
    return {
      ok: false,
      reason: "run-as user must be an active member of the tenant",
    };
  }
  if (target.runInSpaceIsPrivate && !target.isRunInSpaceMember) {
    return {
      ok: false,
      reason: "run-as user must be a member of the job's private run-in-space",
    };
  }
  return { ok: true };
}

export interface RevalidateRunAsInput {
  /** The job's stored run-as user (null = already root-only). */
  runAsUserId: string | null;
  /** Re-resolved facts at dispatch time; required when runAsUserId is set. */
  target?: RunAsTargetMembership;
}

export type RunAsDispatchDecision =
  | { runAsUserId: string; downgraded: false }
  | { runAsUserId: null; downgraded: boolean; reason?: string };

/**
 * Decide the effective run-as identity at dispatch. Returns the stored user
 * only if it STILL passes the membership/active checks; otherwise drops to
 * root-only (`runAsUserId: null`) with `downgraded: true` and a reason for the
 * visible warning. Never substitutes a different identity.
 */
export function revalidateRunAsAtDispatch(
  input: RevalidateRunAsInput,
): RunAsDispatchDecision {
  if (input.runAsUserId === null) {
    return { runAsUserId: null, downgraded: false };
  }
  const target = input.target;
  if (!target || !target.isActiveTenantMember) {
    return {
      runAsUserId: null,
      downgraded: true,
      reason:
        "run-as user is no longer an active member of the tenant — running root-only",
    };
  }
  if (target.runInSpaceIsPrivate && !target.isRunInSpaceMember) {
    return {
      runAsUserId: null,
      downgraded: true,
      reason:
        "run-as user is no longer a member of the run-in-space — running root-only",
    };
  }
  return { runAsUserId: input.runAsUserId, downgraded: false };
}
