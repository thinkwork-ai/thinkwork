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
  checkGoogleWorkspaceConnection,
  claimNextComputerTask,
  cancelComputerTask,
  completeComputerTask,
  ComputerTaskDelegationError,
  ComputerNotFoundError,
  ComputerTaskNotFoundError,
  executeThreadTurnTask,
  failComputerTask,
  loadThreadTurnContext,
  recordComputerHeartbeat,
  recordThreadTurnResponse,
  resolveGoogleWorkspaceCliToken,
  resolveComputerRuntimeConfig,
} from "../lib/computers/runtime-api.js";
import {
  completeRunbookExecutionRun,
  completeRunbookExecutionTask,
  executeRunbookExecutionTask,
  failRunbookExecutionTask,
  loadRunbookExecutionContext,
  recordRunbookExecutionResponse,
  RunbookRuntimeError,
  startRunbookExecutionTask,
} from "../lib/runbooks/runtime-api.js";
import {
  COMPUTER_TASK_TYPES,
  ComputerTaskInputError,
  enqueueComputerTask,
  type ComputerTaskType,
} from "../lib/computers/tasks.js";

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
    if (err instanceof ComputerTaskInputError) return error(err.message, 400);
    if (err instanceof ComputerTaskDelegationError) {
      return error(err.message, err.statusCode);
    }
    if (err instanceof RunbookRuntimeError) {
      return error(err.message, err.statusCode);
    }
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

  if (method === "POST" && path === "/api/computers/runtime/tasks") {
    const tenantId = validUuid(body.tenantId, "tenantId");
    const computerId = validUuid(body.computerId, "computerId");
    const task = await enqueueComputerTask({
      tenantId,
      computerId,
      taskType: validTaskType(body.taskType),
      taskInput: body.input,
      idempotencyKey: optionalString(body.idempotencyKey),
      createdByUserId: optionalUuid(body.createdByUserId, "createdByUserId"),
    });
    return json({ task }, 201);
  }

  if (
    method === "POST" &&
    path === "/api/computers/runtime/google-workspace/check"
  ) {
    const tenantId = validUuid(body.tenantId, "tenantId");
    const computerId = validUuid(body.computerId, "computerId");
    return json(
      await checkGoogleWorkspaceConnection({
        tenantId,
        computerId,
        requesterUserId: optionalUuid(body.requesterUserId, "requesterUserId"),
      }),
    );
  }

  if (
    method === "POST" &&
    path === "/api/computers/runtime/google-workspace/cli-token"
  ) {
    const tenantId = validUuid(body.tenantId, "tenantId");
    const computerId = validUuid(body.computerId, "computerId");
    return json(
      await resolveGoogleWorkspaceCliToken({
        tenantId,
        computerId,
        requesterUserId: optionalUuid(body.requesterUserId, "requesterUserId"),
      }),
    );
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

  const executeThreadTurnMatch = path.match(
    /^\/api\/computers\/runtime\/tasks\/([^/]+)\/execute-thread-turn$/,
  );
  if (method === "POST" && executeThreadTurnMatch) {
    const tenantId = validUuid(body.tenantId, "tenantId");
    const computerId = validUuid(body.computerId, "computerId");
    return json(
      await executeThreadTurnTask({
        tenantId,
        computerId,
        taskId: validUuid(executeThreadTurnMatch[1], "taskId"),
      }),
    );
  }

  const threadTurnContextMatch = path.match(
    /^\/api\/computers\/runtime\/tasks\/([^/]+)\/thread-turn-context$/,
  );
  if (method === "POST" && threadTurnContextMatch) {
    const tenantId = validUuid(body.tenantId, "tenantId");
    const computerId = validUuid(body.computerId, "computerId");
    return json(
      await loadThreadTurnContext({
        tenantId,
        computerId,
        taskId: validUuid(threadTurnContextMatch[1], "taskId"),
      }),
    );
  }

  const threadTurnResponseMatch = path.match(
    /^\/api\/computers\/runtime\/tasks\/([^/]+)\/thread-turn-response$/,
  );
  if (method === "POST" && threadTurnResponseMatch) {
    const tenantId = validUuid(body.tenantId, "tenantId");
    const computerId = validUuid(body.computerId, "computerId");
    return json(
      await recordThreadTurnResponse({
        tenantId,
        computerId,
        taskId: validUuid(threadTurnResponseMatch[1], "taskId"),
        content: bodyString(body.content, "content"),
        model: optionalString(body.model),
        source: optionalString(body.source),
        usage: body.usage,
      }),
    );
  }

  const runbookContextMatch = path.match(
    /^\/api\/computers\/runtime\/tasks\/([^/]+)\/runbook\/context$/,
  );
  if (method === "POST" && runbookContextMatch) {
    const tenantId = validUuid(body.tenantId, "tenantId");
    const computerId = validUuid(body.computerId, "computerId");
    return json(
      await loadRunbookExecutionContext({
        tenantId,
        computerId,
        taskId: validUuid(runbookContextMatch[1], "taskId"),
      }),
    );
  }

  const runbookTaskStartMatch = path.match(
    /^\/api\/computers\/runtime\/tasks\/([^/]+)\/runbook\/tasks\/([^/]+)\/start$/,
  );
  if (method === "POST" && runbookTaskStartMatch) {
    const tenantId = validUuid(body.tenantId, "tenantId");
    const computerId = validUuid(body.computerId, "computerId");
    return json(
      await startRunbookExecutionTask({
        tenantId,
        computerId,
        taskId: validUuid(runbookTaskStartMatch[1], "taskId"),
        runbookTaskId: validUuid(runbookTaskStartMatch[2], "runbookTaskId"),
      }),
    );
  }

  const runbookTaskExecuteMatch = path.match(
    /^\/api\/computers\/runtime\/tasks\/([^/]+)\/runbook\/tasks\/([^/]+)\/execute$/,
  );
  if (method === "POST" && runbookTaskExecuteMatch) {
    const tenantId = validUuid(body.tenantId, "tenantId");
    const computerId = validUuid(body.computerId, "computerId");
    return json(
      await executeRunbookExecutionTask({
        tenantId,
        computerId,
        taskId: validUuid(runbookTaskExecuteMatch[1], "taskId"),
        runbookTaskId: validUuid(runbookTaskExecuteMatch[2], "runbookTaskId"),
      }),
    );
  }

  const runbookTaskCompleteMatch = path.match(
    /^\/api\/computers\/runtime\/tasks\/([^/]+)\/runbook\/tasks\/([^/]+)\/complete$/,
  );
  if (method === "POST" && runbookTaskCompleteMatch) {
    const tenantId = validUuid(body.tenantId, "tenantId");
    const computerId = validUuid(body.computerId, "computerId");
    return json(
      await completeRunbookExecutionTask({
        tenantId,
        computerId,
        taskId: validUuid(runbookTaskCompleteMatch[1], "taskId"),
        runbookTaskId: validUuid(runbookTaskCompleteMatch[2], "runbookTaskId"),
        output: body.output,
      }),
    );
  }

  const runbookTaskFailMatch = path.match(
    /^\/api\/computers\/runtime\/tasks\/([^/]+)\/runbook\/tasks\/([^/]+)\/fail$/,
  );
  if (method === "POST" && runbookTaskFailMatch) {
    const tenantId = validUuid(body.tenantId, "tenantId");
    const computerId = validUuid(body.computerId, "computerId");
    return json(
      await failRunbookExecutionTask({
        tenantId,
        computerId,
        taskId: validUuid(runbookTaskFailMatch[1], "taskId"),
        runbookTaskId: validUuid(runbookTaskFailMatch[2], "runbookTaskId"),
        error: body.error ?? { message: "Runbook task failed" },
      }),
    );
  }

  const runbookCompleteMatch = path.match(
    /^\/api\/computers\/runtime\/tasks\/([^/]+)\/runbook\/complete$/,
  );
  if (method === "POST" && runbookCompleteMatch) {
    const tenantId = validUuid(body.tenantId, "tenantId");
    const computerId = validUuid(body.computerId, "computerId");
    return json(
      await completeRunbookExecutionRun({
        tenantId,
        computerId,
        taskId: validUuid(runbookCompleteMatch[1], "taskId"),
        output: body.output,
      }),
    );
  }

  const runbookResponseMatch = path.match(
    /^\/api\/computers\/runtime\/tasks\/([^/]+)\/runbook\/response$/,
  );
  if (method === "POST" && runbookResponseMatch) {
    const tenantId = validUuid(body.tenantId, "tenantId");
    const computerId = validUuid(body.computerId, "computerId");
    return json(
      await recordRunbookExecutionResponse({
        tenantId,
        computerId,
        taskId: validUuid(runbookResponseMatch[1], "taskId"),
        content: bodyString(body.content, "content"),
        model: optionalString(body.model),
        usage: body.usage,
      }),
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

  const cancelMatch = path.match(
    /^\/api\/computers\/runtime\/tasks\/([^/]+)\/cancel$/,
  );
  if (method === "POST" && cancelMatch) {
    const tenantId = validUuid(body.tenantId, "tenantId");
    const computerId = validUuid(body.computerId, "computerId");
    return json(
      await cancelComputerTask({
        tenantId,
        computerId,
        taskId: validUuid(cancelMatch[1], "taskId"),
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

function optionalUuid(value: unknown, name: string): string | null {
  if (value === undefined || value === null || value === "") return null;
  return validUuid(value, name);
}

function requiredString(value: unknown, name: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new BadRequestError(`${name}: required`);
  }
  return value.trim();
}

function bodyString(value: unknown, name: string): string {
  if (typeof value !== "string") {
    throw new BadRequestError(`${name}: required`);
  }
  return value;
}

function optionalString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function validTaskType(value: unknown): ComputerTaskType {
  const normalized = String(value ?? "").toLowerCase();
  if (COMPUTER_TASK_TYPES.includes(normalized as ComputerTaskType)) {
    return normalized as ComputerTaskType;
  }
  throw new BadRequestError("taskType: unsupported Computer task type");
}

class BadRequestError extends Error {}
