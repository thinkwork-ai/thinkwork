/**
 * POST /api/desktop/workspace-prewarm
 *
 * Cognito-authenticated desktop clients call this from idle UI surfaces
 * such as New Thread. It resolves and renders the user's active workspace
 * without creating a thread_turn, then returns the cache coordinates the
 * local sidecar needs to hydrate files in the background.
 */

import type {
  APIGatewayProxyEventV2,
  APIGatewayProxyStructuredResultV2,
} from "aws-lambda";
import { authenticate } from "../lib/cognito-auth.js";
import { error, handleCors, json, unauthorized } from "../lib/response.js";
import {
  DesktopRuntimeSessionError,
  prepareLocalPiWorkspacePrewarm,
} from "../lib/desktop-runtime/prepare-local-turn.js";

interface DesktopWorkspacePrewarmBody {
  agentId?: string;
  spaceId?: string;
}

function parseBody(event: APIGatewayProxyEventV2): DesktopWorkspacePrewarmBody {
  try {
    return JSON.parse(event.body || "{}") as DesktopWorkspacePrewarmBody;
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
    return unauthorized("Desktop workspace prewarm requires user auth");
  }

  try {
    const body = parseBody(event);
    if (!body.agentId || !body.spaceId) {
      throw new DesktopRuntimeSessionError(
        "agentId and spaceId are required",
        400,
        "BAD_REQUEST",
      );
    }

    const session = await prepareLocalPiWorkspacePrewarm({
      auth,
      agentId: body.agentId,
      spaceId: body.spaceId,
    });

    return json({ ok: true, session });
  } catch (err) {
    if (err instanceof DesktopRuntimeSessionError) {
      return json(
        { ok: false, error: err.message, code: err.code },
        err.statusCode,
      );
    }
    console.error("[desktop-workspace-prewarm] failed to prepare:", err);
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
