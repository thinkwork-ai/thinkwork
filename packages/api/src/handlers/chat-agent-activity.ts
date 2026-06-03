/**
 * chat-agent-activity — HTTP endpoint that the Pi runtime POSTs to mid-turn
 * so live agent activity (tool/skill/phase steps in Phase 1, coalesced text
 * deltas in Phase 2) can stream to the Spaces thread UI while the turn is
 * still running (plan 2026-06-03-001).
 *
 * POST /api/threads/{threadId}/activity
 *   Authorization: Bearer <API_AUTH_SECRET>
 *   body: ActivityPayload (one or a small batch of events)
 *
 *   → 200 { ok: true, appended: N }                  -- events persisted + published
 *   → 400 { ok: false, error, code: "BAD_REQUEST" }  -- shape failure / path mismatch
 *   → 401 { ok: false, error, code: "UNAUTHORIZED" } -- bearer missing/wrong
 *   → 404 { ok: false, error, code: "TURN_NOT_FOUND" }
 *   → 500 { ok: false, error, code: "INTERNAL" }
 *
 * Same Bearer(API_AUTH_SECRET) service-endpoint auth as chat-agent-finalize.
 * The durable record is the thread_turn_events row (seq-ordered); the AppSync
 * publish (notifyThreadTurnStep) is best-effort — a dropped notify costs
 * latency, not data, because the client replays via threadTurnEvents(afterSeq).
 * Emit is failure-isolated: the Pi side treats this POST as best-effort and
 * never fails the turn on an error here.
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
  appendThreadTurnEvent,
  drizzleThreadTurnEventStore,
  ThreadTurnEventError,
} from "../lib/thread-turn-events.js";
import { notifyThreadTurnStep } from "../graphql/notify.js";

const db = getDb();

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Cap a single POST so a pathological turn can't flood AppSync in one shot. */
const MAX_EVENTS_PER_REQUEST = 100;

interface ActivityEventInput {
  event_type: string;
  stream?: string;
  level?: string;
  color?: string;
  message?: string;
  payload?: unknown;
}

interface ActivityPayload {
  thread_turn_id: string; // = thread_turns.id (run_id)
  tenant_id: string;
  thread_id: string;
  agent_id?: string;
  events: ActivityEventInput[];
}

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
  if (!token || !validateApiSecret(token)) {
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

  let payload: ActivityPayload;
  try {
    payload = JSON.parse(event.body || "{}") as ActivityPayload;
  } catch {
    return badRequest("Invalid JSON body");
  }

  if (!payload.thread_turn_id || !UUID_RE.test(payload.thread_turn_id)) {
    return badRequest("Missing or invalid thread_turn_id");
  }
  if (!payload.tenant_id || !UUID_RE.test(payload.tenant_id)) {
    return badRequest("Missing or invalid tenant_id");
  }
  if (!payload.thread_id || !UUID_RE.test(payload.thread_id)) {
    return badRequest("Missing or invalid thread_id");
  }
  if (payload.thread_id !== pathThreadId) {
    return badRequest("Body thread_id does not match path threadId");
  }
  if (!Array.isArray(payload.events) || payload.events.length === 0) {
    return badRequest("Missing or empty events array");
  }
  if (payload.events.length > MAX_EVENTS_PER_REQUEST) {
    return badRequest(
      `Too many events in one request (max ${MAX_EVENTS_PER_REQUEST})`,
    );
  }

  // ---- Turn lookup + tenant/thread pin (defense in depth) -------------
  const [turn] = await db
    .select({
      id: threadTurns.id,
      tenant_id: threadTurns.tenant_id,
      thread_id: threadTurns.thread_id,
      agent_id: threadTurns.agent_id,
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
  if (
    turn.tenant_id !== payload.tenant_id ||
    (turn.thread_id !== null && turn.thread_id !== payload.thread_id)
  ) {
    return badRequest(
      "thread_turn_id is not in the tenant/thread named in the body",
    );
  }

  // ---- Append each event (durable, seq-ordered) + best-effort publish --
  const store = drizzleThreadTurnEventStore();
  const agentId = payload.agent_id ?? turn.agent_id ?? null;
  let appended = 0;
  const skipped: Array<{ index: number; reason: string }> = [];

  for (let i = 0; i < payload.events.length; i++) {
    const ev = payload.events[i];
    if (!ev || typeof ev.event_type !== "string" || !ev.event_type) {
      skipped.push({ index: i, reason: "missing event_type" });
      continue;
    }
    try {
      const row = await appendThreadTurnEvent(store, {
        tenantId: payload.tenant_id,
        runId: payload.thread_turn_id,
        agentId,
        eventType: ev.event_type,
        message: ev.message ?? "",
        payload: ev.payload ?? null,
        stream: ev.stream ?? "step",
        level: ev.level ?? undefined,
        color: ev.color ?? undefined,
      });
      appended++;
      // Best-effort publish — a notify failure must NEVER fail the request
      // (the durable append already succeeded; the client replays via
      // threadTurnEvents). createdAt is display-ordering only; seq is the
      // authoritative order.
      await notifyThreadTurnStep({
        runId: payload.thread_turn_id,
        threadId: payload.thread_id,
        tenantId: payload.tenant_id,
        seq: row.seq,
        eventType: ev.event_type,
        stream: ev.stream ?? "step",
        level: ev.level ?? null,
        color: ev.color ?? null,
        message: ev.message ?? null,
        payload:
          ev.payload && typeof ev.payload === "object"
            ? (ev.payload as Record<string, unknown>)
            : null,
        createdAt: new Date().toISOString(),
      }).catch((err) => {
        console.error(
          `[chat-agent-activity] notify failed (best-effort):`,
          err,
        );
      });
    } catch (err) {
      // Oversized payloads (and other per-event faults) are skipped from the
      // LIVE view without failing the request — finalize still carries the
      // complete record (no silent truncation of the finalized view).
      if (err instanceof ThreadTurnEventError) {
        if (err.code === "TURN_NOT_FOUND") {
          return json(404, {
            ok: false,
            error: "thread_turn_id not found",
            code: "TURN_NOT_FOUND",
          });
        }
        skipped.push({ index: i, reason: err.code });
        continue;
      }
      console.error(`[chat-agent-activity] append failed:`, err);
      return json(500, {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
        code: "INTERNAL",
      });
    }
  }

  return json(200, {
    ok: true,
    appended,
    ...(skipped.length > 0 ? { skipped } : {}),
  });
}
