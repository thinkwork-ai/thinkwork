/**
 * Desktop runtime session preparation endpoint.
 *
 * POST /api/desktop/runtime-session
 *
 * Cognito-authenticated desktop clients call this to prepare a local Pi
 * sidecar turn. The API validates tenant/thread/Space/agent access, creates
 * the thread_turn row, and returns the invocation envelope the Electron shell
 * can hand to the local sidecar. It deliberately returns a per-turn finalizer
 * token, not the backend service secret used by managed AgentCore runs.
 */

import type {
  APIGatewayProxyEventV2,
  APIGatewayProxyStructuredResultV2,
} from "aws-lambda";
import { authenticate } from "../lib/cognito-auth.js";
import { error, handleCors, json, unauthorized } from "../lib/response.js";
import {
  DesktopRuntimeSessionError,
  prepareLocalPiRuntimeSession,
  type DesktopRuntimeAttachment,
} from "../lib/desktop-runtime/prepare-local-turn.js";

interface DesktopRuntimeSessionBody {
  agentId?: string;
  threadId?: string;
  messageId?: string;
  userMessage?: string;
  messageAttachments?: DesktopRuntimeAttachment[];
}

function parseBody(event: APIGatewayProxyEventV2): DesktopRuntimeSessionBody {
  try {
    return JSON.parse(event.body || "{}") as DesktopRuntimeSessionBody;
  } catch {
    throw new DesktopRuntimeSessionError(
      "Invalid JSON body",
      400,
      "BAD_REQUEST",
    );
  }
}

export async function handler(
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyStructuredResultV2> {
  const preflight = handleCors(event);
  if (preflight) return preflight;

  if (event.requestContext.http.method !== "POST") {
    return error("Method not allowed", 405);
  }

  const auth = await authenticate(
    event.headers as Record<string, string | undefined>,
  );
  if (!auth || auth.authType !== "cognito" || !auth.email) {
    return unauthorized("Desktop runtime sessions require user auth");
  }

  try {
    const body = parseBody(event);
    if (!body.agentId || !body.threadId || !body.userMessage) {
      throw new DesktopRuntimeSessionError(
        "agentId, threadId, and userMessage are required",
        400,
        "BAD_REQUEST",
      );
    }

    const session = await prepareLocalPiRuntimeSession({
      auth,
      agentId: body.agentId,
      threadId: body.threadId,
      messageId: body.messageId,
      userMessage: body.userMessage,
      messageAttachments: body.messageAttachments,
    });

    return json({
      ok: true,
      session: {
        threadTurnId: session.threadTurnId,
        expiresAt: session.expiresAt,
        finalizeCallbackUrl: session.finalizeCallbackUrl,
        finalizeCallbackSecret: session.finalizeCallbackSecret,
        sidecarCredentials: session.sidecarCredentials,
        invocation: session.invocation,
      },
    });
  } catch (err) {
    if (err instanceof DesktopRuntimeSessionError) {
      return json(
        { ok: false, error: err.message, code: err.code },
        err.statusCode,
      );
    }
    console.error("[desktop-runtime-session] failed to prepare session:", err);
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
