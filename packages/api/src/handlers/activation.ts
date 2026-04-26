import type {
  APIGatewayProxyEventV2,
  APIGatewayProxyStructuredResultV2,
} from "aws-lambda";
import { eq } from "drizzle-orm";
import { getDb } from "@thinkwork/database-pg";
import { activationSessions } from "@thinkwork/database-pg/schema";
import {
  error,
  forbidden,
  handleCors,
  json,
  notFound,
  unauthorized,
} from "../lib/response.js";

const db = getDb();

type RuntimePayload = {
  sessionId?: string;
  tenantId?: string;
  userId?: string;
  status?: string;
  currentLayer?: string;
  layerStates?: unknown;
  lastAgentMessage?: string | null;
  eventType?: string;
};

export async function handler(
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyStructuredResultV2> {
  const cors = handleCors(event);
  if (cors) return cors;

  if (event.requestContext.http.method !== "POST") {
    return error("Method not allowed", 405);
  }

  const auth = event.headers.authorization ?? event.headers.Authorization;
  const expected = process.env.API_AUTH_SECRET;
  if (!expected || auth !== `Bearer ${expected}`) {
    return unauthorized();
  }

  let payload: RuntimePayload;
  try {
    payload = JSON.parse(event.body || "{}") as RuntimePayload;
  } catch {
    return error("Invalid JSON body", 400);
  }

  if (!payload.sessionId || !payload.tenantId) {
    return error("sessionId and tenantId are required", 400);
  }

  const [session] = await db
    .select()
    .from(activationSessions)
    .where(eq(activationSessions.id, payload.sessionId));
  if (!session) return notFound("Activation session not found");
  if (session.tenant_id !== payload.tenantId) {
    return forbidden("Tenant mismatch for activation session");
  }
  if (payload.userId && payload.userId !== session.user_id) {
    return forbidden("User mismatch for activation session");
  }

  const route = event.rawPath;
  if (
    ![
      "/api/activation/notify",
      "/api/activation/checkpoint",
      "/api/activation/complete",
    ].includes(route)
  ) {
    return notFound("Route not found");
  }

  const layerStates =
    payload.layerStates === undefined
      ? session.layer_states
      : payload.layerStates;
  const status =
    route === "/api/activation/complete"
      ? "ready_for_review"
      : (payload.status ?? session.status);
  const [updated] = await db
    .update(activationSessions)
    .set({
      status,
      current_layer: payload.currentLayer ?? session.current_layer,
      layer_states: layerStates,
      last_agent_message:
        payload.lastAgentMessage === undefined
          ? session.last_agent_message
          : payload.lastAgentMessage,
      updated_at: new Date(),
      last_active_at: new Date(),
    })
    .where(eq(activationSessions.id, session.id))
    .returning();

  return json(
    {
      sessionId: updated.id,
      status: updated.status,
      eventType:
        payload.eventType ??
        (route === "/api/activation/complete" ? "complete" : "notify"),
    },
    204,
  );
}
