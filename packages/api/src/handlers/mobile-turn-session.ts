/**
 * Mobile Pi durable turn lifecycle.
 *
 * POST /api/mobile/turn-session
 *
 * The mobile Pi host owns local execution, but the platform owns durable turn
 * identity. This endpoint starts the lease before model/tool work, accepts
 * cheap heartbeats and bounded checkpoints while the app is alive, and lets
 * local mobile finalization race safely against later managed handoff.
 */

import type {
  APIGatewayProxyEventV2,
  APIGatewayProxyStructuredResultV2,
} from "aws-lambda";
import { authenticate } from "../lib/cognito-auth.js";
import { handleCors, json, error, unauthorized } from "../lib/response.js";
import {
  abortMobileTurn,
  backgroundMobileTurn,
  checkpointMobileTurn,
  finalizeLocalMobileTurn,
  heartbeatMobileTurn,
  MobileTurnLifecycleError,
  startMobileTurn,
  type MobileTurnAuth,
} from "../lib/mobile-turns/lifecycle.js";
import {
  validateChangedFiles,
  type ChangedFilePayload,
} from "../lib/chat-finalize/reconcile.js";

interface MobileTurnSessionBody {
  action?: string;
  clientTurnId?: string;
  threadId?: string;
  threadTurnId?: string;
  agentId?: string | null;
  userText?: string;
  assistantText?: string;
  attachments?: unknown[];
  metadata?: Record<string, unknown>;
  latestCheckpointSeq?: number;
  checkpoint?: Record<string, unknown>;
  message?: string;
  safe?: boolean;
  reason?: string;
  toolResults?: unknown[];
  usage?: { inputTokens?: number; outputTokens?: number };
  changedFiles?: ChangedFilePayload[];
  changed_files?: ChangedFilePayload[];
  diagnostics?: Record<string, unknown>;
}

function parseBody(event: APIGatewayProxyEventV2): MobileTurnSessionBody {
  try {
    return JSON.parse(event.body ?? "{}") as MobileTurnSessionBody;
  } catch {
    throw new MobileTurnLifecycleError("Invalid JSON body", 400, "BAD_JSON");
  }
}

function lifecycleAuth(
  auth: Awaited<ReturnType<typeof authenticate>>,
): MobileTurnAuth {
  return {
    email: auth?.email ?? null,
    tenantId: auth?.tenantId ?? null,
  };
}

export async function handler(
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyStructuredResultV2> {
  const preflight = handleCors(event);
  if (preflight) return preflight;

  if (event.requestContext.http.method !== "POST") {
    return error("Method not allowed", 405);
  }

  try {
    const auth = await authenticate(
      event.headers as Record<string, string | undefined>,
    );
    if (!auth || auth.authType !== "cognito" || !auth.email) {
      return unauthorized("Authentication required");
    }

    const body = parseBody(event);
    const turnAuth = lifecycleAuth(auth);

    switch (body.action) {
      case "start":
        return json(
          await startMobileTurn({
            auth: turnAuth,
            clientTurnId: body.clientTurnId ?? "",
            threadId: body.threadId ?? "",
            agentId: body.agentId,
            userText: body.userText ?? "",
            attachments: Array.isArray(body.attachments)
              ? body.attachments.filter(
                  (item): item is Record<string, unknown> =>
                    !!item && typeof item === "object" && !Array.isArray(item),
                )
              : [],
            metadata: body.metadata ?? {},
          }),
        );
      case "heartbeat":
        return json(
          await heartbeatMobileTurn({
            auth: turnAuth,
            threadTurnId: body.threadTurnId ?? "",
            latestCheckpointSeq: body.latestCheckpointSeq,
          }),
        );
      case "checkpoint":
        return json(
          await checkpointMobileTurn({
            auth: turnAuth,
            threadTurnId: body.threadTurnId ?? "",
            checkpoint: body.checkpoint ?? {},
            message: body.message,
            safe: body.safe,
          }),
        );
      case "background":
        return json(
          await backgroundMobileTurn({
            auth: turnAuth,
            threadTurnId: body.threadTurnId ?? "",
            reason: body.reason,
          }),
        );
      case "abort":
        return json(
          await abortMobileTurn({
            auth: turnAuth,
            threadTurnId: body.threadTurnId ?? "",
            reason: body.reason,
          }),
        );
      case "finalize": {
        const changedFiles = validateChangedFiles(
          body.changedFiles ?? body.changed_files,
        );
        if (!changedFiles.ok) {
          return error("Invalid changed_files", 400);
        }
        return json(
          await finalizeLocalMobileTurn({
            auth: turnAuth,
            threadTurnId: body.threadTurnId ?? "",
            assistantText: body.assistantText ?? "",
            toolResults: body.toolResults,
            usage: body.usage,
            changedFiles: changedFiles.changedFiles,
            diagnostics: body.diagnostics,
          }),
        );
      }
      default:
        return error("Unknown mobile turn lifecycle action", 400);
    }
  } catch (err) {
    if (err instanceof MobileTurnLifecycleError) {
      return error(err.message, err.statusCode);
    }
    console.error("[mobile-turn-session] unhandled error", err);
    return error("Mobile turn session failed", 500);
  }
}
