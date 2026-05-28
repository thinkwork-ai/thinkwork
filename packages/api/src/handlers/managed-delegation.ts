/**
 * Desktop managed-delegation endpoint.
 *
 * POST /api/desktop/managed-delegation
 *
 * The Electron sidecar calls this with the parent desktop turn id and its
 * short-lived per-turn finalizer token. The API validates that token against
 * the parent thread_turn context, then dispatches a managed AgentCore worker
 * through the existing chat-agent-invoke setup path.
 */

import type {
  APIGatewayProxyEventV2,
  APIGatewayProxyStructuredResultV2,
} from "aws-lambda";
import type { ManagedDelegationVisibility } from "@thinkwork/pi-runtime-core";
import { error, handleCors, json, unauthorized } from "../lib/response.js";
import {
  ManagedDelegationError,
  runManagedDelegation,
} from "../lib/desktop-runtime/managed-delegation.js";

interface ManagedDelegationBody {
  parentThreadTurnId?: string;
  task?: string;
  visibility?: ManagedDelegationVisibility;
  reason?: string;
  timeoutMs?: number;
}

function parseBody(event: APIGatewayProxyEventV2): ManagedDelegationBody {
  try {
    return JSON.parse(event.body || "{}") as ManagedDelegationBody;
  } catch {
    throw new ManagedDelegationError("Invalid JSON body", 400, "BAD_REQUEST");
  }
}

function bearerToken(event: APIGatewayProxyEventV2): string | null {
  const authorization =
    event.headers.authorization ?? event.headers.Authorization;
  const match = authorization?.match(/^Bearer\s+(.+)$/i);
  return match?.[1] ?? null;
}

export async function handler(
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyStructuredResultV2> {
  const preflight = handleCors(event);
  if (preflight) return preflight;

  if (event.requestContext.http.method !== "POST") {
    return error("Method not allowed", 405);
  }

  const token = bearerToken(event);
  if (!token) {
    return unauthorized("Desktop managed delegation requires sidecar auth");
  }

  try {
    const body = parseBody(event);
    if (!body.parentThreadTurnId || !body.task) {
      throw new ManagedDelegationError(
        "parentThreadTurnId and task are required",
        400,
        "BAD_REQUEST",
      );
    }
    const requestedVisibility = body.visibility ?? "hidden";
    if (requestedVisibility !== "hidden" && requestedVisibility !== "visible") {
      throw new ManagedDelegationError(
        "visibility must be hidden or visible",
        400,
        "BAD_REQUEST",
      );
    }

    const result = await runManagedDelegation({
      parentThreadTurnId: body.parentThreadTurnId,
      finalizeCallbackSecret: token,
      task: body.task,
      requestedVisibility,
      reason: body.reason,
      timeoutMs: body.timeoutMs,
    });

    return json(result);
  } catch (err) {
    if (err instanceof ManagedDelegationError) {
      return json(
        { ok: false, error: err.message, code: err.code },
        err.statusCode,
      );
    }
    console.error("[managed-delegation] failed:", err);
    return json(
      {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
        code: "INTERNAL",
      },
      500,
    );
  }
}
