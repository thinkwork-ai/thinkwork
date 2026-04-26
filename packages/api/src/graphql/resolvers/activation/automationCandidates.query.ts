import type { GraphQLContext } from "../../context.js";
import { and, asc, db, eq } from "../../utils.js";
import {
  activationAutomationCandidateToGraphql,
  activationAutomationCandidates,
  assertActivationAutomationOwner,
  loadActivationSession,
} from "./shared.js";

export const activationAutomationCandidates_ = async (
  _parent: unknown,
  args: { sessionId: string },
  ctx: GraphQLContext,
) => {
  const session = await loadActivationSession(args.sessionId);
  await assertActivationAutomationOwner(ctx, session);

  const rows = await db
    .select()
    .from(activationAutomationCandidates)
    .where(
      and(
        eq(activationAutomationCandidates.session_id, session.id),
        eq(activationAutomationCandidates.user_id, session.user_id),
        eq(activationAutomationCandidates.tenant_id, session.tenant_id),
      ),
    )
    .orderBy(asc(activationAutomationCandidates.created_at));

  return rows.map(activationAutomationCandidateToGraphql);
};
