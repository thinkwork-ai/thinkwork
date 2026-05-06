import type {
  APIGatewayProxyEventV2,
  APIGatewayProxyStructuredResultV2,
} from "aws-lambda";
import { extractBearerToken, validateApiSecret } from "../lib/auth.js";
import { error, handleCors, json, unauthorized } from "../lib/response.js";
import {
  ComputerRuntimeControlError,
  controlComputerRuntime,
  type RuntimeAction,
} from "../lib/computers/runtime-control.js";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ACTIONS = new Set(["provision", "start", "stop", "restart", "status"]);

export async function handler(
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyStructuredResultV2> {
  const cors = handleCors(event);
  if (cors) return cors;
  if (event.requestContext.http.method !== "POST") {
    return error("Method not allowed", 405);
  }

  const token = extractBearerToken(event);
  if (!token || !validateApiSecret(token)) return unauthorized();

  try {
    const body = parseBody(event);
    const action = parseAction(body.action);
    const tenantId = parseUuid(body.tenantId, "tenantId");
    const computerId = parseUuid(body.computerId, "computerId");
    const result = await controlComputerRuntime({
      action,
      tenantId,
      computerId,
    });
    return json({ ok: true, action, result });
  } catch (err) {
    if (err instanceof ComputerRuntimeControlError) {
      return error(err.message, err.statusCode);
    }
    if (err instanceof BadRequestError) return error(err.message, 400);
    console.error("[computer-manager] request failed", err);
    return error("Internal server error", 500);
  }
}

function parseBody(event: APIGatewayProxyEventV2): Record<string, unknown> {
  if (!event.body) return {};
  try {
    const body = JSON.parse(event.body);
    return body && typeof body === "object" && !Array.isArray(body) ? body : {};
  } catch {
    throw new BadRequestError("Request body must be JSON");
  }
}

function parseAction(value: unknown): RuntimeAction {
  if (typeof value !== "string" || !ACTIONS.has(value)) {
    throw new BadRequestError(
      "action must be one of provision, start, stop, restart, status",
    );
  }
  return value as RuntimeAction;
}

function parseUuid(value: unknown, name: string): string {
  if (typeof value !== "string" || !UUID_RE.test(value)) {
    throw new BadRequestError(`${name}: valid UUID required`);
  }
  return value;
}

class BadRequestError extends Error {}
