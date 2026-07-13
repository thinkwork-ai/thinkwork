/**
 * createRoutineProposal / rejectRoutineProposal + routineProposal(s) queries
 * (THINK-280 U6).
 *
 * Creation is SIDE-EFFECT-FREE: the resolver is thin authz + AWSJSON
 * tolerance; the domain lib normalizes Python, sanitizes fixtures, computes
 * the fingerprint, validates dependencies, and supersedes the prior open
 * proposal — it never touches Git or execution. Any edit is a fresh row
 * with a fresh fingerprint (AE6).
 */

import type { GraphQLContext } from "../../context.js";
import { and, db, eq } from "../../utils.js";
import { capabilityRoutineProposals } from "@thinkwork/database-pg/schema";
import { requireAdminOrServiceCaller } from "../core/authz.js";
import { resolveRuntimeActor } from "../capabilities/capabilityRuntime.shared.js";
import {
  createRoutineProposal as createRoutineProposalLib,
  rejectRoutineProposal as rejectRoutineProposalLib,
  type CapabilityRoutineProposalRow,
  type RoutineProposalBundle,
} from "../../../lib/capabilities/routine-proposal.js";
import { parseJsonish } from "../capabilities/capabilityRuntime.shared.js";
import { routineProposalToGql } from "./routineProposal.shared.js";

export async function createRoutineProposal(
  _parent: unknown,
  args: {
    input: {
      tenantId: string;
      routineId?: string | null;
      bundle: unknown;
      status?: string | null;
    };
  },
  ctx: GraphQLContext,
): Promise<Record<string, unknown>> {
  const { input } = args;
  await requireAdminOrServiceCaller(
    ctx,
    input.tenantId,
    "routines:propose_promotion",
  );
  const actor = await resolveRuntimeActor(ctx);

  const result = await createRoutineProposalLib(db, {
    tenantId: input.tenantId,
    routineId: input.routineId ?? null,
    bundle: parseJsonish(input.bundle) as RoutineProposalBundle,
    status: input.status === "submitted" ? "submitted" : "draft",
    actor: actor.userId
      ? { type: "user", id: actor.userId }
      : { type: "system" },
  });

  return {
    outcome: result.outcome,
    reason: result.reason ?? null,
    proposal: result.proposal ? routineProposalToGql(result.proposal) : null,
  };
}

export async function rejectRoutineProposal(
  _parent: unknown,
  args: { tenantId: string; proposalId: string; reason?: string | null },
  ctx: GraphQLContext,
): Promise<Record<string, unknown>> {
  await requireAdminOrServiceCaller(
    ctx,
    args.tenantId,
    "routines:reject_promotion",
  );
  const actor = await resolveRuntimeActor(ctx);
  const result = await rejectRoutineProposalLib(db, {
    tenantId: args.tenantId,
    proposalId: args.proposalId,
    adminUserId: actor.userId,
    reason: args.reason ?? null,
  });
  return {
    outcome: result.outcome,
    reason: result.reason ?? null,
    proposal: result.proposal ? routineProposalToGql(result.proposal) : null,
  };
}

export async function routineProposal(
  _parent: unknown,
  args: { id: string },
  ctx: GraphQLContext,
): Promise<Record<string, unknown> | null> {
  const [row] = (await db
    .select()
    .from(capabilityRoutineProposals)
    .where(eq(capabilityRoutineProposals.id, args.id))
    .limit(1)) as CapabilityRoutineProposalRow[];
  if (!row) return null;
  await requireAdminOrServiceCaller(ctx, row.tenant_id, "routines:read");
  return routineProposalToGql(row);
}

export async function routineProposals(
  _parent: unknown,
  args: { tenantId: string; routineId?: string | null; status?: string | null },
  ctx: GraphQLContext,
): Promise<Record<string, unknown>[]> {
  await requireAdminOrServiceCaller(ctx, args.tenantId, "routines:read");
  const rows = (await db
    .select()
    .from(capabilityRoutineProposals)
    .where(
      and(
        eq(capabilityRoutineProposals.tenant_id, args.tenantId),
        ...(args.routineId
          ? [eq(capabilityRoutineProposals.routine_id, args.routineId)]
          : []),
        ...(args.status
          ? [eq(capabilityRoutineProposals.status, args.status)]
          : []),
      ),
    )) as CapabilityRoutineProposalRow[];
  return rows
    .sort(
      (a, b) =>
        (b.created_at?.getTime?.() ?? 0) - (a.created_at?.getTime?.() ?? 0),
    )
    .map(routineProposalToGql);
}
