/**
 * chat-agent-finalize — HTTP endpoint that the Strands runtime POSTs to
 * at end-of-turn so the post-AgentCore bookkeeping can run without
 * chat-agent-invoke holding a Lambda open for the full turn duration
 * (plan 2026-05-22-006).
 *
 * POST /api/threads/{threadId}/finalize
 *   Authorization: Bearer <API_AUTH_SECRET>
 *   body: FinalizePayload (see ../lib/chat-finalize/types.ts)
 *
 *   → 200 { ok: true, idempotent: false, messageId: "..." }    -- finalized just now
 *   → 200 { ok: true, idempotent: true }                       -- already finalized (retry)
 *   → 400 { ok: false, error, code: "BAD_REQUEST" }            -- shape failure / path mismatch
 *   → 401 { ok: false, error, code: "UNAUTHORIZED" }           -- bearer missing/wrong
 *   → 404 { ok: false, error, code: "TURN_NOT_FOUND" }         -- thread_turn_id doesn't exist
 *   → 500 { ok: false, error, code: "INTERNAL" }               -- unhandled failure
 *
 * Service-endpoint auth pattern (Bearer API_AUTH_SECRET) — same shape
 * as routine-step-callback / sandbox-quota-check. Idempotency is keyed
 * on `thread_turns.finalized_at` plus a non-terminal
 * `context_snapshot.workspace_reconcile` claim. Reconcile failures leave
 * finalized_at unset so callback retries can re-enter the reconcile seam.
 */

import type {
  APIGatewayProxyEventV2,
  APIGatewayProxyStructuredResultV2,
} from "aws-lambda";
import { eq } from "drizzle-orm";
import { getDb } from "@thinkwork/database-pg";
import { threadTurns } from "@thinkwork/database-pg/schema";
import { extractBearerToken, validateApiSecret } from "../lib/auth.js";
import {
  processFinalize,
  toFinalizeResponse,
} from "../lib/chat-finalize/process-finalize.js";
import { validateChangedFiles } from "../lib/chat-finalize/reconcile.js";
import type { FinalizePayload } from "../lib/chat-finalize/types.js";
import {
  DESKTOP_FINALIZE_TOKEN_PREFIX,
  verifyDesktopFinalizeToken,
} from "../lib/desktop-runtime/sidecar-credentials.js";

const db = getDb();

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function json(
  statusCode: number,
  body: unknown,
): APIGatewayProxyStructuredResultV2 {
  return {
    statusCode,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  };
}

function badRequest(reason: string): APIGatewayProxyStructuredResultV2 {
  return json(400, { ok: false, error: reason, code: "BAD_REQUEST" });
}

export async function handler(
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyStructuredResultV2> {
  // ---- Auth -----------------------------------------------------------
  const token = extractBearerToken(event);
  if (!token) {
    return json(401, {
      ok: false,
      error: "Missing or invalid Bearer token",
      code: "UNAUTHORIZED",
    });
  }
  if (
    !validateApiSecret(token) &&
    !token.startsWith(DESKTOP_FINALIZE_TOKEN_PREFIX)
  ) {
    return json(401, {
      ok: false,
      error: "Missing or invalid Bearer token",
      code: "UNAUTHORIZED",
    });
  }

  // ---- Method gate ----------------------------------------------------
  if (event.requestContext.http.method !== "POST") {
    return json(405, {
      ok: false,
      error: "Method not allowed",
      code: "METHOD_NOT_ALLOWED",
    });
  }

  // ---- Path param + body parse ----------------------------------------
  const pathThreadId = event.pathParameters?.threadId;
  if (!pathThreadId || !UUID_RE.test(pathThreadId)) {
    return badRequest("Missing or invalid threadId path parameter");
  }

  let payload: FinalizePayload;
  try {
    payload = JSON.parse(event.body || "{}") as FinalizePayload;
  } catch {
    return badRequest("Invalid JSON body");
  }

  if (!payload.thread_turn_id || !UUID_RE.test(payload.thread_turn_id)) {
    return badRequest("Missing or invalid thread_turn_id");
  }
  if (!payload.tenant_id || !UUID_RE.test(payload.tenant_id)) {
    return badRequest("Missing or invalid tenant_id");
  }
  if (!payload.agent_id || !UUID_RE.test(payload.agent_id)) {
    return badRequest("Missing or invalid agent_id");
  }
  if (!payload.thread_id || !UUID_RE.test(payload.thread_id)) {
    return badRequest("Missing or invalid thread_id");
  }
  if (payload.thread_id !== pathThreadId) {
    return badRequest("Body thread_id does not match path threadId");
  }
  if (payload.status !== "completed" && payload.status !== "failed") {
    return badRequest(`Invalid status: ${payload.status}`);
  }
  if (typeof payload.duration_ms !== "number" || payload.duration_ms < 0) {
    return badRequest("Missing or invalid duration_ms");
  }
  const changedFiles = validateChangedFiles(payload.changed_files);
  if (!changedFiles.ok) {
    return json(400, {
      ok: false,
      error: "Invalid changed_files",
      code: "BAD_REQUEST",
      details: changedFiles.errors,
    });
  }
  payload.changed_files = changedFiles.changedFiles;

  // ---- Turn lookup ----------------------------------------------------
  const [turn] = await db
    .select({
      id: threadTurns.id,
      tenant_id: threadTurns.tenant_id,
      thread_id: threadTurns.thread_id,
      context_snapshot: threadTurns.context_snapshot,
    })
    .from(threadTurns)
    .where(eq(threadTurns.id, payload.thread_turn_id))
    .limit(1);

  if (!turn) {
    return json(404, {
      ok: false,
      error: "thread_turn_id not found",
      code: "TURN_NOT_FOUND",
    });
  }
  // Tenant + thread pin: defense in depth against forged callbacks
  // referencing a turn under a different tenant.
  if (
    turn.tenant_id !== payload.tenant_id ||
    (turn.thread_id !== null && turn.thread_id !== payload.thread_id)
  ) {
    return badRequest(
      "thread_turn_id is not in the tenant/thread named in the body",
    );
  }

  if (!token || !isAuthorizedFinalizeToken(token, turn.context_snapshot)) {
    return json(401, {
      ok: false,
      error: "Missing or invalid Bearer token",
      code: "UNAUTHORIZED",
    });
  }

  // ---- Run the finalize chain ----------------------------------------
  try {
    const result = await processFinalize(payload);
    return json(200, toFinalizeResponse(result));
  } catch (err) {
    console.error(`[chat-agent-finalize] Internal error:`, err);
    return json(500, {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
      code: "INTERNAL",
    });
  }
}

function isAuthorizedFinalizeToken(
  token: string,
  contextSnapshot: unknown,
): boolean {
  if (validateApiSecret(token)) return true;
  if (!token.startsWith(DESKTOP_FINALIZE_TOKEN_PREFIX)) return false;

  const session = readDesktopRuntimeSession(contextSnapshot);
  if (!session) return false;
  if (Date.parse(session.expires_at) <= Date.now()) return false;
  return verifyDesktopFinalizeToken(token, session.finalize_token_sha256);
}

function readDesktopRuntimeSession(
  contextSnapshot: unknown,
): { finalize_token_sha256: string; expires_at: string } | null {
  if (!contextSnapshot || typeof contextSnapshot !== "object") return null;
  const session = (contextSnapshot as Record<string, unknown>)[
    "desktop_runtime_session"
  ];
  if (!session || typeof session !== "object") return null;
  const finalizeHash = (session as Record<string, unknown>)[
    "finalize_token_sha256"
  ];
  const expiresAt = (session as Record<string, unknown>)["expires_at"];
  if (typeof finalizeHash !== "string" || typeof expiresAt !== "string") {
    return null;
  }
  return { finalize_token_sha256: finalizeHash, expires_at: expiresAt };
}
