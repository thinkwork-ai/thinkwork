import type {
  APIGatewayProxyEventV2,
  APIGatewayProxyStructuredResultV2,
} from "aws-lambda";
import { N8N_AGENT_STEP_BRIDGE_ENDPOINT_PATH } from "@thinkwork/plugin-n8n/manifest";
import {
  error,
  handleCors,
  json,
  notFound,
  unauthorized,
} from "../lib/response.js";
import {
  authenticateN8nAgentStepBridgeRequest,
  N8nAgentStepAuthError,
} from "../lib/n8n-agent-step/auth.js";
import {
  N8nAgentStepPayloadError,
  parseN8nAgentStepStartPayload,
} from "../lib/n8n-agent-step/payload.js";
import {
  N8nAgentStepStartError,
  startN8nAgentStepRun,
} from "../lib/n8n-agent-step/start.js";
import { N8nAgentStepContractError } from "../lib/n8n-agent-step/types.js";

export async function handler(
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyStructuredResultV2> {
  const cors = handleCors(event);
  if (cors) return cors;

  if (event.rawPath !== N8N_AGENT_STEP_BRIDGE_ENDPOINT_PATH) {
    return notFound("Route not found");
  }
  if (event.requestContext.http.method !== "POST") {
    return error("Method not allowed", 405);
  }

  let body: unknown;
  try {
    body = parseJsonBody(event);
  } catch {
    return error("Invalid JSON body", 400);
  }

  try {
    const auth = await authenticateN8nAgentStepBridgeRequest(
      event.headers ?? {},
    );
    const headers = lowerCaseHeaders(event.headers ?? {});
    const parsedPayload = parseN8nAgentStepStartPayload(body);
    const payload = {
      ...parsedPayload,
      requestId:
        parsedPayload.requestId ??
        headers["x-request-id"] ??
        event.requestContext.requestId ??
        null,
    };
    const started = await startN8nAgentStepRun(auth, payload);
    return json(
      {
        ok: true,
        ...started,
      },
      202,
    );
  } catch (caught) {
    if (caught instanceof N8nAgentStepAuthError) {
      return unauthorized("Unauthorized");
    }
    if (caught instanceof N8nAgentStepPayloadError) {
      return error(caught.message, caught.statusCode);
    }
    if (caught instanceof N8nAgentStepContractError) {
      return error(caught.message, 400);
    }
    if (caught instanceof N8nAgentStepStartError) {
      return error(caught.message, caught.statusCode);
    }
    console.error("[n8n-agent-step-bridge] request failed:", caught);
    return error("Internal server error", 500);
  }
}

function parseJsonBody(event: APIGatewayProxyEventV2): unknown {
  const raw = event.body
    ? event.isBase64Encoded
      ? Buffer.from(event.body, "base64").toString("utf8")
      : event.body
    : "{}";
  return JSON.parse(raw);
}

function lowerCaseHeaders(
  headers: Record<string, string | undefined>,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(headers)
      .filter(([, value]) => typeof value === "string")
      .map(([key, value]) => [key.toLowerCase(), value as string]),
  );
}
