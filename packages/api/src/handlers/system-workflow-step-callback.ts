/**
 * Narrow service-auth endpoint for System Workflow step events.
 */

import type {
  APIGatewayProxyEventV2,
  APIGatewayProxyStructuredResultV2,
} from "aws-lambda";
import { extractBearerToken, validateApiSecret } from "../lib/auth.js";
import { error, json, unauthorized } from "../lib/response.js";
import {
  findSystemWorkflowRunByExecutionArn,
  recordSystemWorkflowStepEvent,
} from "../lib/system-workflows/events.js";

export async function handler(
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyStructuredResultV2> {
  if (event.requestContext.http.method === "OPTIONS") {
    return {
      statusCode: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST,OPTIONS",
        "Access-Control-Allow-Headers": "*",
      },
      body: "",
    };
  }
  if (event.requestContext.http.method !== "POST") {
    return error("Method not allowed", 405);
  }
  if (event.rawPath !== "/api/system-workflows/steps") {
    return error("Not found", 404);
  }

  const token = extractBearerToken(event);
  if (!token || !validateApiSecret(token)) return unauthorized();

  let body: Record<string, unknown>;
  try {
    body = JSON.parse(event.body || "{}");
  } catch {
    return error("Invalid JSON body", 400);
  }

  const shaped = await shapeStepBody(body);
  if (!shaped.ok) return error(shaped.error, shaped.statusCode ?? 400);
  const result = await recordSystemWorkflowStepEvent(shaped.value);
  return json({ inserted: result.inserted, deduped: result.deduped }, 200);
}

async function shapeStepBody(body: Record<string, unknown>) {
  const runId = typeof body.runId === "string" ? body.runId : null;
  const executionArn =
    typeof body.executionArn === "string" ? body.executionArn : null;
  const nodeId = typeof body.nodeId === "string" ? body.nodeId : "";
  const stepType = typeof body.stepType === "string" ? body.stepType : "";
  const status = typeof body.status === "string" ? body.status : "";

  if (!nodeId) return { ok: false as const, error: "nodeId is required" };
  if (!stepType) return { ok: false as const, error: "stepType is required" };
  if (!status) return { ok: false as const, error: "status is required" };

  if (runId && typeof body.tenantId === "string") {
    return {
      ok: true as const,
      value: {
        tenantId: body.tenantId,
        runId,
        nodeId,
        stepType,
        status,
        startedAt:
          typeof body.startedAt === "string" ? new Date(body.startedAt) : null,
        finishedAt:
          typeof body.finishedAt === "string"
            ? new Date(body.finishedAt)
            : null,
        inputJson: body.inputJson,
        outputJson: body.outputJson,
        errorJson: body.errorJson,
        costUsdCents:
          typeof body.costUsdCents === "number" ? body.costUsdCents : null,
        retryCount: typeof body.retryCount === "number" ? body.retryCount : 0,
        idempotencyKey:
          typeof body.idempotencyKey === "string" ? body.idempotencyKey : null,
      },
    };
  }

  if (!executionArn) {
    return {
      ok: false as const,
      error: "runId+tenantId or executionArn is required",
    };
  }

  const run = await findSystemWorkflowRunByExecutionArn(executionArn);
  if (!run) {
    return {
      ok: false as const,
      error: "System Workflow run not found",
      statusCode: 404,
    };
  }

  return {
    ok: true as const,
    value: {
      tenantId: run.tenant_id,
      runId: run.id,
      nodeId,
      stepType,
      status,
      startedAt:
        typeof body.startedAt === "string" ? new Date(body.startedAt) : null,
      finishedAt:
        typeof body.finishedAt === "string" ? new Date(body.finishedAt) : null,
      inputJson: body.inputJson,
      outputJson: body.outputJson,
      errorJson: body.errorJson,
      costUsdCents:
        typeof body.costUsdCents === "number" ? body.costUsdCents : null,
      retryCount: typeof body.retryCount === "number" ? body.retryCount : 0,
      idempotencyKey:
        typeof body.idempotencyKey === "string" ? body.idempotencyKey : null,
    },
  };
}
