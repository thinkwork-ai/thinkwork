import type { GraphQLContext } from "../../context.js";
import { db, eq } from "../../utils.js";
import {
  activationSessionToGraphql,
  activationSessions,
  activationSessionTurns,
  assertActivationAccess,
  fallbackAgentMessage,
  invokeActivationRuntime,
  loadActivationSession,
  nextTurnIndex,
} from "./shared.js";

export const submitActivationTurn = async (
  _parent: unknown,
  args: { input: { sessionId: string; layerId: string; message: string } },
  ctx: GraphQLContext,
) => {
  const session = await loadActivationSession(args.input.sessionId);
  await assertActivationAccess(ctx, session);
  const userTurnIndex = await nextTurnIndex(session.id);
  await db.insert(activationSessionTurns).values({
    session_id: session.id,
    layer_id: args.input.layerId,
    turn_index: userTurnIndex,
    role: "user",
    content: args.input.message,
  });

  const runtimeResult = await invokeActivationRuntime({
    action: "turn",
    sessionId: session.id,
    userId: session.user_id,
    tenantId: session.tenant_id,
    layerId: args.input.layerId,
    message: args.input.message,
  });
  const agentMessage =
    typeof runtimeResult?.message === "string"
      ? runtimeResult.message
      : fallbackAgentMessage(args.input.layerId);
  await db.insert(activationSessionTurns).values({
    session_id: session.id,
    layer_id: args.input.layerId,
    turn_index: userTurnIndex + 1,
    role: "agent",
    content: agentMessage,
  });
  const [updated] = await db
    .update(activationSessions)
    .set({
      last_agent_message: agentMessage,
      updated_at: new Date(),
      last_active_at: new Date(),
    })
    .where(eq(activationSessions.id, session.id))
    .returning();
  return activationSessionToGraphql(updated);
};
