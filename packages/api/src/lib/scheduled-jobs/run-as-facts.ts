/**
 * Run-as fact resolution (THINK-302 U7 — R28, KTD-14).
 *
 * The authorization decisions live in the pure `run-as-authz` functions; those
 * take already-resolved membership/role/space-visibility facts. This module
 * reads those facts from the database. To stay unit-testable without a live DB
 * (and without brittle ORM mocks), it takes a small set of async reader
 * callbacks — the resolvers/dispatchers supply real Drizzle-backed readers,
 * tests supply plain fakes.
 */

import type { RunAsTargetMembership } from "./run-as-authz.js";

export interface RunAsFactReaders {
  /** True when (tenant, user) has an ACTIVE tenant_members row with owner/admin. */
  isTenantOperator(tenantId: string, userId: string): Promise<boolean>;
  /** True when (tenant, user) has an ACTIVE tenant_members row (any role). */
  isActiveTenantMember(tenantId: string, userId: string): Promise<boolean>;
  /** The space's access_mode, or null when the job has no run-in-space. */
  spaceAccessMode(
    spaceId: string,
  ): Promise<"public" | "private" | null | undefined>;
  /** True when (space, user) has a space_members row. */
  isSpaceMember(spaceId: string, userId: string): Promise<boolean>;
}

/**
 * Resolve the target-membership facts `authorizeRunAsAssignment` /
 * `revalidateRunAsAtDispatch` need for a candidate run-as user. When the job
 * has no run-in-space, the space is treated as non-private (space membership
 * is not required). Reads run only when there is a user to resolve.
 */
export async function resolveRunAsTargetMembership(
  readers: RunAsFactReaders,
  args: { tenantId: string; runAsUserId: string; spaceId: string | null },
): Promise<RunAsTargetMembership> {
  const isActiveTenantMember = await readers.isActiveTenantMember(
    args.tenantId,
    args.runAsUserId,
  );
  let runInSpaceIsPrivate = false;
  let isRunInSpaceMember = false;
  if (args.spaceId) {
    const accessMode = await readers.spaceAccessMode(args.spaceId);
    runInSpaceIsPrivate = accessMode === "private";
    // Only pay for the membership read when it can change the decision.
    isRunInSpaceMember = runInSpaceIsPrivate
      ? await readers.isSpaceMember(args.spaceId, args.runAsUserId)
      : false;
  }
  return { isActiveTenantMember, runInSpaceIsPrivate, isRunInSpaceMember };
}

/**
 * Resolve the full save-time authz inputs: the actor's operator-ness plus the
 * target facts (only when a non-null run-as is being assigned).
 */
export async function resolveRunAsAuthzInputs(
  readers: RunAsFactReaders,
  args: {
    tenantId: string;
    actorUserId: string;
    runAsUserId: string | null;
    spaceId: string | null;
  },
): Promise<{
  actor: { userId: string; isTenantOperator: boolean };
  target?: RunAsTargetMembership;
}> {
  const isTenantOperator = await readers.isTenantOperator(
    args.tenantId,
    args.actorUserId,
  );
  const actor = { userId: args.actorUserId, isTenantOperator };
  if (args.runAsUserId === null) return { actor };
  const target = await resolveRunAsTargetMembership(readers, {
    tenantId: args.tenantId,
    runAsUserId: args.runAsUserId,
    spaceId: args.spaceId,
  });
  return { actor, target };
}
