/**
 * System Workflow execution lifecycle callback.
 *
 * EventBridge invokes this handler for Step Functions Standard execution
 * status changes. The shape mirrors routine-execution-callback but writes
 * to the platform-owned system_workflow_runs table.
 */

import type {
  APIGatewayProxyEventV2,
  APIGatewayProxyStructuredResultV2,
} from "aws-lambda";
import { extractBearerToken, validateApiSecret } from "../lib/auth.js";
import { error, json, unauthorized } from "../lib/response.js";
import {
  updateSystemWorkflowRunFromExecution,
  type SystemWorkflowRunStatus,
} from "../lib/system-workflows/events.js";

interface SfnEventBridgeEvent {
  source: string;
  "detail-type": string;
  detail: {
    executionArn: string;
    status: string;
    startDate?: number;
    stopDate?: number;
    output?: string;
    error?: string;
    cause?: string;
  };
}

const SFN_TO_SYSTEM_WORKFLOW_STATUS: Record<string, SystemWorkflowRunStatus> = {
  RUNNING: "running",
  SUCCEEDED: "succeeded",
  FAILED: "failed",
  TIMED_OUT: "timed_out",
  ABORTED: "cancelled",
};

function isEventBridgeEvent(event: unknown): event is SfnEventBridgeEvent {
  return (
    typeof event === "object" &&
    event !== null &&
    "source" in event &&
    (event as { source?: string }).source === "aws.states" &&
    "detail" in event
  );
}

function parseOutput(output: string | undefined): unknown {
  if (!output) return undefined;
  try {
    return JSON.parse(output);
  } catch {
    return { raw: output };
  }
}

export function eventBridgeToSystemWorkflowUpdate(event: SfnEventBridgeEvent) {
  const detail = event.detail;
  const status = SFN_TO_SYSTEM_WORKFLOW_STATUS[detail.status];
  if (!status) {
    return { ok: false as const, error: `Unsupported status ${detail.status}` };
  }
  return {
    ok: true as const,
    value: {
      executionArn: detail.executionArn,
      status,
      startedAt:
        typeof detail.startDate === "number"
          ? new Date(detail.startDate)
          : undefined,
      finishedAt:
        typeof detail.stopDate === "number"
          ? new Date(detail.stopDate)
          : undefined,
      outputJson: parseOutput(detail.output),
      errorCode: detail.error ?? null,
      errorMessage: detail.cause ?? null,
    },
  };
}

export async function handler(
  event: APIGatewayProxyEventV2 | SfnEventBridgeEvent,
): Promise<
  APIGatewayProxyStructuredResultV2 | { updated: boolean; reason?: string }
> {
  if (isEventBridgeEvent(event)) {
    const shaped = eventBridgeToSystemWorkflowUpdate(event);
    if (!shaped.ok) {
      console.warn(`[system-workflow-execution-callback] ${shaped.error}`);
      return { updated: false, reason: "invalid_event" };
    }
    return updateSystemWorkflowRunFromExecution(shaped.value);
  }

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
  if (event.rawPath !== "/api/system-workflows/execution") {
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

  const shaped = shapeHttpBody(body);
  if (!shaped.ok) return error(shaped.error, 400);
  const result = await updateSystemWorkflowRunFromExecution(shaped.value);
  return json(result, result.updated ? 200 : 404);
}

function shapeHttpBody(body: Record<string, unknown>) {
  const executionArn =
    typeof body.executionArn === "string" ? body.executionArn : "";
  const status = typeof body.status === "string" ? body.status : "";
  if (!executionArn)
    return { ok: false as const, error: "executionArn is required" };
  if (
    !Object.values(SFN_TO_SYSTEM_WORKFLOW_STATUS).includes(
      status as SystemWorkflowRunStatus,
    )
  ) {
    return { ok: false as const, error: "status is invalid" };
  }
  return {
    ok: true as const,
    value: {
      executionArn,
      status: status as SystemWorkflowRunStatus,
      startedAt:
        typeof body.startedAt === "string"
          ? new Date(body.startedAt)
          : undefined,
      finishedAt:
        typeof body.finishedAt === "string"
          ? new Date(body.finishedAt)
          : undefined,
      outputJson: body.outputJson,
      errorCode: typeof body.errorCode === "string" ? body.errorCode : null,
      errorMessage:
        typeof body.errorMessage === "string" ? body.errorMessage : null,
    },
  };
}
