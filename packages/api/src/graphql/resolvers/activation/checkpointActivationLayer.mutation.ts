import type { GraphQLContext } from "../../context.js";
import { db, eq } from "../../utils.js";
import {
  ACTIVATION_LAYER_ORDER,
  activationSessionToGraphql,
  activationSessions,
  assertActivationAccess,
  loadActivationSession,
  parseAwsJson,
} from "./shared.js";

export const checkpointActivationLayer = async (
  _parent: unknown,
  args: {
    input: {
      sessionId: string;
      layerId: string;
      layerState: string;
      nextLayer?: string | null;
    };
  },
  ctx: GraphQLContext,
) => {
  const session = await loadActivationSession(args.input.sessionId);
  await assertActivationAccess(ctx, session);
  const currentStates =
    typeof session.layer_states === "object" && session.layer_states !== null
      ? (session.layer_states as Record<string, unknown>)
      : {};
  const layerState = parseAwsJson(args.input.layerState, "layerState");
  const layerStates = {
    ...currentStates,
    [args.input.layerId]: {
      ...(typeof layerState === "object" && layerState !== null
        ? layerState
        : {}),
      checkpointed_at: new Date().toISOString(),
    },
  };
  const isRefresh = session.mode === "refresh";
  const isComplete =
    isRefresh ||
    ACTIVATION_LAYER_ORDER.every((layer) => Object.hasOwn(layerStates, layer));
  const [updated] = await db
    .update(activationSessions)
    .set({
      layer_states: layerStates,
      current_layer: args.input.nextLayer ?? session.current_layer,
      status: isComplete ? "ready_for_review" : session.status,
      updated_at: new Date(),
      last_active_at: new Date(),
    })
    .where(eq(activationSessions.id, session.id))
    .returning();
  return activationSessionToGraphql(updated);
};
