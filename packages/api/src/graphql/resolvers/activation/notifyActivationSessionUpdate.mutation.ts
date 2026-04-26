import { db, eq } from "../../utils.js";
import {
  activationEventFromSession,
  activationSessions,
  parseAwsJson,
} from "./shared.js";

export const notifyActivationSessionUpdate = async (
  _parent: unknown,
  args: {
    sessionId: string;
    userId: string;
    tenantId: string;
    status: string;
    currentLayer: string;
    layerStates: string;
    lastAgentMessage?: string | null;
    eventType: string;
  },
) => {
  const [updated] = await db
    .update(activationSessions)
    .set({
      status: args.status,
      current_layer: args.currentLayer,
      layer_states: parseAwsJson(args.layerStates, "layerStates"),
      last_agent_message: args.lastAgentMessage ?? null,
      updated_at: new Date(),
      last_active_at: new Date(),
    })
    .where(eq(activationSessions.id, args.sessionId))
    .returning();
  if (updated) return activationEventFromSession(updated, args.eventType);
  return {
    sessionId: args.sessionId,
    userId: args.userId,
    tenantId: args.tenantId,
    status: args.status,
    currentLayer: args.currentLayer,
    layerStates: args.layerStates,
    lastAgentMessage: args.lastAgentMessage ?? null,
    eventType: args.eventType,
    updatedAt: new Date().toISOString(),
  };
};
