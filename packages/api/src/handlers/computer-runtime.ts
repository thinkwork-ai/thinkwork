import type {
  APIGatewayProxyEventV2,
  APIGatewayProxyStructuredResultV2,
} from "aws-lambda";
import { extractBearerToken, validateApiSecret } from "../lib/auth.js";
import {
  error,
  handleCors,
  json,
  notFound,
  unauthorized,
} from "../lib/response.js";
import {
  appendComputerTaskEvent,
  claimNextComputerTask,
  completeComputerTask,
  ComputerNotFoundError,
  ComputerTaskNotFoundError,
  failComputerTask,
  recordComputerHeartbeat,
  resolveComputerRuntimeConfig,
} from "../lib/computers/runtime-api.js";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function handler(
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyStructuredResultV2> {
  const cors = handleCors(event);
  if (cors) return cors;

  const token = extractBearerToken(event);
  if (!token || !validateApiSecret(token)) return unauthorized();

  try {
    return await route(event);
  } catch (err) {
    if (err instanceof BadRequestError) return error(err.message, 400);
    if (err instanceof ComputerNotFoundError) return notFound(err.message);
    if (err instanceof ComputerTaskNotFoundError) return notFound(err.message);
    console.error("[computer-runtime] request failed", err);
    return error("Internal server error", 500);
  }
}

async function route(
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyStructuredResultV2> {
  const method = event.requestContext.http.method;
  const path = event.rawPath.replace(/\/+$/, "");

  if (method === "GET" && path === "/api/computers/runtime/config") {
    const tenantId = validUuid(
      event.queryStringParameters?.tenantId,
      "tenantId",
    );
    const computerId = validUuid(
      event.queryStringParameters?.computerId,
      "computerId",
    );
    return json(await resolveComputerRuntimeConfig({ tenantId, computerId }));
  }

  const body = parseBody(event);
  if (method === "POST" && path === "/api/computers/runtime/heartbeat") {
    const tenantId = validUuid(body.tenantId, "tenantId");
    const computerId = validUuid(body.computerId, "computerId");
    const runtimeStatus = requiredString(body.runtimeStatus, "runtimeStatus");
    return json(
      await recordComputerHeartbeat({
        tenantId,
        computerId,
        runtimeStatus,
        runtimeVersion: optionalString(body.runtimeVersion),
        workspaceRoot: optionalString(body.workspaceRoot),
      }),
    );
  }

  if (method === "POST" && path === "/api/computers/runtime/tasks/claim") {
    const tenantId = validUuid(body.tenantId, "tenantId");
    const computerId = validUuid(body.computerId, "computerId");
    const task = await claimNextComputerTask({ tenantId, computerId });
    return json({ task });
  }

  const taskEventMatch = path.match(
    /^\/api\/computers\/runtime\/tasks\/([^/]+)\/events$/,
  );
  if (method === "POST" && taskEventMatch) {
    const tenantId = validUuid(body.tenantId, "tenantId");
    const computerId = validUuid(body.computerId, "computerId");
    const taskId = validUuid(taskEventMatch[1], "taskId");
    return json(
      await appendComputerTaskEvent({
        tenantId,
        computerId,
        taskId,
        eventType: requiredString(body.eventType, "eventType"),
        level: optionalString(body.level) ?? "info",
        payload: body.payload,
      }),
      201,
    );
  }

  const completeMatch = path.match(
    /^\/api\/computers\/runtime\/tasks\/([^/]+)\/complete$/,
  );
  if (method === "POST" && completeMatch) {
    const tenantId = validUuid(body.tenantId, "tenantId");
    const computerId = validUuid(body.computerId, "computerId");
    return json(
      await completeComputerTask({
        tenantId,
        computerId,
        taskId: validUuid(completeMatch[1], "taskId"),
        output: body.output,
      }),
    );
  }

  const failMatch = path.match(
    /^\/api\/computers\/runtime\/tasks\/([^/]+)\/fail$/,
  );
  if (method === "POST" && failMatch) {
    const tenantId = validUuid(body.tenantId, "tenantId");
    const computerId = validUuid(body.computerId, "computerId");
    return json(
      await failComputerTask({
        tenantId,
        computerId,
        taskId: validUuid(failMatch[1], "taskId"),
        error: body.error ?? { message: "Task failed" },
      }),
    );
  }

  return error("Not found", 404);
}

function parseBody(event: APIGatewayProxyEventV2): Record<string, any> {
  if (!event.body) return {};
  try {
    return JSON.parse(event.body);
  } catch {
    throw new BadRequestError("Request body must be JSON");
  }
}

function validUuid(value: unknown, name: string): string {
  if (typeof value !== "string" || !UUID_RE.test(value)) {
    throw new BadRequestError(`${name}: valid UUID required`);
  }
  return value;
}

function requiredString(value: unknown, name: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new BadRequestError(`${name}: required`);
  }
  return value.trim();
}

function optionalString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

class BadRequestError extends Error {}
