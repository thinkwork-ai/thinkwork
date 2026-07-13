/**
 * approveRoutineProposal (THINK-280 U6).
 *
 * Operator-only, EXACT single-use approval: the client passes the
 * fingerprint it reviewed; the domain lib consumes it through a conditional
 * UPDATE ... WHERE payload_fingerprint = <reviewed> AND status='submitted'
 * (fail-closed on stale/decided), creates the Inbox linkage, and triggers
 * the atomic bundle commit + hermetic validation via the injected promoter.
 *
 * The promoter is the SINGLE deterministic-routines Git publisher (no second
 * publisher). A service caller with no user identity cannot ghost-approve —
 * operator approval stamps a specific admin user id (repair auto-publish,
 * the only machine path, is a separate lib entry, never this resolver).
 */

import type { GraphQLContext } from "../../context.js";
import { db } from "../../utils.js";
import { requireAdminOrServiceCaller } from "../core/authz.js";
import { resolveRuntimeActor } from "../capabilities/capabilityRuntime.shared.js";
import { approveRoutineProposal as approveRoutineProposalLib } from "../../../lib/capabilities/routine-proposal.js";
import { createDefaultRoutineProposalPromoter } from "../../../lib/capabilities/routine-promoter.js";
import { routineProposalToGql } from "./routineProposal.shared.js";
import type { RoutineProposalPromoter } from "../../../lib/capabilities/routine-proposal.js";

/** Injectable for tests; production uses the lambda-backed promoter. */
let promoterOverride: RoutineProposalPromoter | null = null;
export function __setRoutinePromoterForTest(
  promoter: RoutineProposalPromoter | null,
): void {
  promoterOverride = promoter;
}

export async function approveRoutineProposal(
  _parent: unknown,
  args: {
    input: {
      tenantId: string;
      proposalId: string;
      reviewedFingerprint: string;
    };
  },
  ctx: GraphQLContext,
): Promise<Record<string, unknown>> {
  const { input } = args;
  await requireAdminOrServiceCaller(
    ctx,
    input.tenantId,
    "routines:approve_promotion",
  );
  const actor = await resolveRuntimeActor(ctx);
  // Operator approval stamps a specific admin identity — an identity-less
  // service caller cannot approve a promotion.
  if (!actor.userId) {
    return { outcome: "rejected", reason: "admin_identity_required" };
  }

  const promoter = promoterOverride ?? createDefaultRoutineProposalPromoter();
  const result = await approveRoutineProposalLib(
    db,
    {
      tenantId: input.tenantId,
      proposalId: input.proposalId,
      reviewedFingerprint: input.reviewedFingerprint,
      adminUserId: actor.userId,
    },
    { promoter },
  );

  return {
    outcome: result.outcome,
    reason: result.reason ?? null,
    proposal: result.proposal ? routineProposalToGql(result.proposal) : null,
    promotionOutcome: result.promotion?.outcome ?? null,
    promotedCommitSha: result.promotion?.commitSha ?? null,
    validatedSha: result.promotion?.validatedSha ?? null,
    hermetic: result.promotion?.hermetic
      ? JSON.stringify(result.promotion.hermetic)
      : null,
  };
}
