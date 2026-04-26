import type { GraphQLContext } from "../../context.js";
import {
  activationSessionToGraphql,
  assertActivationAccess,
  loadActivationSession,
} from "./shared.js";

export const activationSession = async (
  _parent: unknown,
  args: { sessionId: string },
  ctx: GraphQLContext,
) => {
  const session = await loadActivationSession(args.sessionId);
  await assertActivationAccess(ctx, session);
  return activationSessionToGraphql(session);
};
