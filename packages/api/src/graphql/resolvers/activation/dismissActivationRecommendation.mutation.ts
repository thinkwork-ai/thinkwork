import type { GraphQLContext } from "../../context.js";
import { db, eq } from "../../utils.js";
import {
  activationSessionToGraphql,
  activationSessions,
  assertActivationAccess,
  loadActivationSession,
} from "./shared.js";

export const dismissActivationRecommendation = async (
  _parent: unknown,
  args: { input: { sessionId: string; itemId: string } },
  ctx: GraphQLContext,
) => {
  const session = await loadActivationSession(args.input.sessionId);
  await assertActivationAccess(ctx, session);
  const states =
    typeof session.layer_states === "object" && session.layer_states !== null
      ? (session.layer_states as Record<string, any>)
      : {};
  const dismissed = Array.isArray(states.dismissedRecommendations)
    ? states.dismissedRecommendations
    : [];
  const [updated] = await db
    .update(activationSessions)
    .set({
      layer_states: {
        ...states,
        dismissedRecommendations: [...dismissed, args.input.itemId],
      },
      updated_at: new Date(),
      last_active_at: new Date(),
    })
    .where(eq(activationSessions.id, session.id))
    .returning();
  return activationSessionToGraphql(updated);
};
