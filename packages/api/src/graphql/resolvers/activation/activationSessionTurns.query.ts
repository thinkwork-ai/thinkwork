import type { GraphQLContext } from "../../context.js";
import { asc, db, eq } from "../../utils.js";
import {
  activationSessionToGraphql,
  activationSessionTurns,
  activationTurnToGraphql,
  assertActivationAccess,
  loadActivationSession,
} from "./shared.js";

export const activationSessionTurns_ = async (
  _parent: unknown,
  args: { sessionId: string },
  ctx: GraphQLContext,
) => {
  const session = await loadActivationSession(args.sessionId);
  await assertActivationAccess(ctx, session);
  void activationSessionToGraphql;
  const turns = await db
    .select()
    .from(activationSessionTurns)
    .where(eq(activationSessionTurns.session_id, args.sessionId))
    .orderBy(asc(activationSessionTurns.turn_index));
  return turns.map(activationTurnToGraphql);
};
