/**
 * tool-executions — runtime→API endpoint for the Pi tool-execution ledger
 * (THINK-324 Wave-3 C17).
 *
 *   POST /api/runtime/tool-executions
 *     Authorization: Bearer <API_AUTH_SECRET>
 *     body: {
 *       tenant_id, thread_id, turn_id,
 *       principal_type, principal_id,
 *       events: [{
 *         event_type: "started" | "completed" | "failed" | "uncertain",
 *         tool_use_id, operation, idempotency_key,
 *         input_preview?,            // started only
 *         output_preview?, error_preview?, provider_request_id?,
 *         duration_ms?, provider_cost_usd?,   // terminal only
 *         policy_revision?, policy_decision_id?, credential_owner_alias?,
 *       }]
 *     }
 *     → 200 { ok: true, appended: N, skipped: M }
 *
 * Same Bearer(API_AUTH_SECRET) service-endpoint auth as manifest-log /
 * chat-agent-activity. The emitter treats this POST as best-effort and never
 * fails the turn on an error here; correspondingly the handler is idempotent
 * (ON CONFLICT DO NOTHING against the paired started/terminal partial unique
 * indices) and skips — rather than fails on — a terminal event whose started
 * row never arrived (the transport is fire-and-forget, so a dropped start
 * must not poison the terminal write).
 */

import type {
  APIGatewayProxyEventV2,
  APIGatewayProxyStructuredResultV2,
} from "aws-lambda";
import { eq } from "drizzle-orm";
import { getDb } from "@thinkwork/database-pg";
import { tenants, toolExecutionEvents } from "@thinkwork/database-pg/schema";
import { extractBearerToken, validateApiSecret } from "../lib/auth.js";
import { error, json, notFound, unauthorized } from "../lib/response.js";
import { enforceTurnAssertion } from "../lib/turn-assertion.js";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_BODY_BYTES = 256 * 1024;
const MAX_EVENTS_PER_REQUEST = 100;
const MAX_TEXT_CHARS = 512;
const MAX_PREVIEW_BYTES = 16 * 1024;

const EVENT_TYPES = new Set(["started", "completed", "failed", "uncertain"]);
const TERMINAL_TYPES = new Set(["completed", "failed", "uncertain"]);
const PRINCIPAL_TYPES = new Set(["user", "service"]);

interface LedgerEventInput {
  event_type: string;
  tool_use_id: string;
  operation: string;
  idempotency_key: string;
  input_preview?: Record<string, unknown> | null;
  output_preview?: Record<string, unknown> | null;
  error_preview?: Record<string, unknown> | null;
  provider_request_id?: string | null;
  duration_ms?: number | null;
  provider_cost_usd?: number | null;
  policy_revision?: string | null;
  policy_decision_id?: string | null;
  credential_owner_alias?: string | null;
}

export async function handler(
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyStructuredResultV2> {
  if (event.requestContext.http.method === "OPTIONS") {
    return {
      statusCode: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST,OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization",
      },
      body: "",
    };
  }

  if (event.requestContext.http.method !== "POST") {
    return error("Method not allowed", 405);
  }
  if (event.rawPath !== "/api/runtime/tool-executions") {
    return notFound("Route not found");
  }

  const token = extractBearerToken(event);
  if (!token || !validateApiSecret(token)) return unauthorized();

  const body = event.body ?? "";
  if (body.length > MAX_BODY_BYTES) {
    return error(
      `body exceeds ${MAX_BODY_BYTES} bytes (got ${body.length})`,
      413,
    );
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(body || "{}") as Record<string, unknown>;
  } catch {
    return error("Invalid JSON body", 400);
  }

  const tenant_id =
    typeof parsed.tenant_id === "string" ? parsed.tenant_id : "";
  const thread_id =
    typeof parsed.thread_id === "string" ? parsed.thread_id : "";
  const turn_id = typeof parsed.turn_id === "string" ? parsed.turn_id : "";
  if (
    !UUID_RE.test(tenant_id) ||
    !UUID_RE.test(thread_id) ||
    !UUID_RE.test(turn_id)
  ) {
    return error("tenant_id / thread_id / turn_id: valid UUIDs required", 400);
  }

  const principal_type =
    typeof parsed.principal_type === "string" ? parsed.principal_type : "";
  if (!PRINCIPAL_TYPES.has(principal_type)) {
    return error("principal_type: must be 'user' or 'service'", 400);
  }
  const principal_id = boundedText(parsed.principal_id);
  if (!principal_id) {
    return error(
      `principal_id: required non-empty string up to ${MAX_TEXT_CHARS} chars`,
      400,
    );
  }

  // Signed-turn identity (THINK-324 C18/C19): when presented, the
  // dispatch-minted assertion must bind to the write target; with
  // TURN_ASSERTION_REQUIRED=true, assertion-less writes are refused.
  const assertion = await enforceTurnAssertion({
    headers: event.headers,
    binding: { tenant_id, thread_id, turn_id },
    surface: "tool-executions",
  });
  if (!assertion.ok) return unauthorized();

  if (!Array.isArray(parsed.events) || parsed.events.length === 0) {
    return error("events: required non-empty array", 400);
  }
  if (parsed.events.length > MAX_EVENTS_PER_REQUEST) {
    return error(`events: max ${MAX_EVENTS_PER_REQUEST} per request`, 400);
  }

  const events: LedgerEventInput[] = [];
  for (const [i, raw] of parsed.events.entries()) {
    const validated = validateEvent(raw);
    if (typeof validated === "string") {
      return error(`events[${i}]: ${validated}`, 400);
    }
    events.push(validated);
  }

  try {
    const db = getDb();

    // Tenant isolation check — same rationale as manifest-log: a compromised
    // runtime secret must not silently forge rows against arbitrary tenants.
    const [tenantRow] = await db
      .select({ id: tenants.id })
      .from(tenants)
      .where(eq(tenants.id, tenant_id))
      .limit(1);
    if (!tenantRow) {
      return notFound("tenant not found");
    }

    let appended = 0;
    let skipped = 0;
    for (const ev of events) {
      const isStarted = ev.event_type === "started";
      try {
        const inserted = await db
          .insert(toolExecutionEvents)
          .values({
            tenant_id,
            thread_id,
            turn_id,
            principal_type,
            principal_id,
            tool_use_id: ev.tool_use_id,
            operation: ev.operation,
            idempotency_key: ev.idempotency_key,
            event_type: ev.event_type,
            input_preview: isStarted ? (ev.input_preview ?? {}) : null,
            output_preview: isStarted ? null : (ev.output_preview ?? null),
            error_preview: isStarted ? null : (ev.error_preview ?? null),
            provider_request_id: isStarted
              ? null
              : (ev.provider_request_id ?? null),
            duration_ms: isStarted ? null : (ev.duration_ms ?? null),
            provider_cost_usd: isStarted
              ? null
              : ev.provider_cost_usd != null
                ? String(ev.provider_cost_usd)
                : null,
            policy_revision: ev.policy_revision ?? null,
            policy_decision_id: ev.policy_decision_id ?? null,
            credential_owner_alias: ev.credential_owner_alias ?? null,
          })
          .onConflictDoNothing()
          .returning({ id: toolExecutionEvents.id });
        if (inserted.length > 0) appended += 1;
        else skipped += 1; // idempotent replay
      } catch (err) {
        // A terminal event whose started row never arrived trips the
        // correlation trigger. The transport is fire-and-forget, so this is
        // expected loss, not an error: skip and keep the batch going.
        if (
          err instanceof Error &&
          err.message.includes("tool_execution_terminal_without_matching_start")
        ) {
          console.warn(
            `[tool-executions] terminal without start skipped: turn=${turn_id} key=${ev.idempotency_key}`,
          );
          skipped += 1;
          continue;
        }
        throw err;
      }
    }

    return json({ ok: true, appended, skipped }, 200);
  } catch (err) {
    console.error("[tool-executions] handler crashed:", err);
    return error("internal server error", 500);
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function boundedText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > MAX_TEXT_CHARS) return null;
  return trimmed;
}

function optionalBoundedText(value: unknown): string | null | "invalid" {
  if (value === undefined || value === null) return null;
  const text = boundedText(value);
  return text ?? "invalid";
}

function optionalPreview(
  value: unknown,
): Record<string, unknown> | null | "invalid" {
  if (value === undefined || value === null) return null;
  if (typeof value !== "object" || Array.isArray(value)) return "invalid";
  const bytes = Buffer.byteLength(JSON.stringify(value), "utf8");
  if (bytes > MAX_PREVIEW_BYTES) {
    return { truncated: true, original_bytes: bytes };
  }
  return value as Record<string, unknown>;
}

/** Validate one ledger event. Returns the normalized event or an error string. */
function validateEvent(raw: unknown): LedgerEventInput | string {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return "must be an object";
  }
  const ev = raw as Record<string, unknown>;

  const event_type = typeof ev.event_type === "string" ? ev.event_type : "";
  if (!EVENT_TYPES.has(event_type)) {
    return "event_type: must be started|completed|failed|uncertain";
  }
  const tool_use_id = boundedText(ev.tool_use_id);
  if (!tool_use_id) return "tool_use_id: required non-empty string";
  const operation = boundedText(ev.operation);
  if (!operation) return "operation: required non-empty string";
  const idempotency_key = boundedText(ev.idempotency_key);
  if (!idempotency_key) return "idempotency_key: required non-empty string";

  const input_preview = optionalPreview(ev.input_preview);
  const output_preview = optionalPreview(ev.output_preview);
  const error_preview = optionalPreview(ev.error_preview);
  if (
    input_preview === "invalid" ||
    output_preview === "invalid" ||
    error_preview === "invalid"
  ) {
    return "previews must be plain objects when set";
  }

  const provider_request_id = optionalBoundedText(ev.provider_request_id);
  const policy_revision = optionalBoundedText(ev.policy_revision);
  const policy_decision_id = optionalBoundedText(ev.policy_decision_id);
  const credential_owner_alias = optionalBoundedText(ev.credential_owner_alias);
  if (
    provider_request_id === "invalid" ||
    policy_revision === "invalid" ||
    policy_decision_id === "invalid" ||
    credential_owner_alias === "invalid"
  ) {
    return `optional text fields must be non-empty strings up to ${MAX_TEXT_CHARS} chars when set`;
  }

  let duration_ms: number | null = null;
  if (ev.duration_ms !== undefined && ev.duration_ms !== null) {
    if (
      typeof ev.duration_ms !== "number" ||
      !Number.isFinite(ev.duration_ms) ||
      ev.duration_ms < 0
    ) {
      return "duration_ms: must be a non-negative number when set";
    }
    duration_ms = Math.round(ev.duration_ms);
  }

  let provider_cost_usd: number | null = null;
  if (ev.provider_cost_usd !== undefined && ev.provider_cost_usd !== null) {
    if (
      typeof ev.provider_cost_usd !== "number" ||
      !Number.isFinite(ev.provider_cost_usd) ||
      ev.provider_cost_usd < 0
    ) {
      return "provider_cost_usd: must be a non-negative number when set";
    }
    provider_cost_usd = ev.provider_cost_usd;
  }

  if (event_type === "started") {
    if (!input_preview) return "started events require input_preview";
    if (
      output_preview ||
      error_preview ||
      provider_request_id ||
      duration_ms !== null ||
      provider_cost_usd !== null
    ) {
      return "started events must not carry terminal fields";
    }
  } else if (TERMINAL_TYPES.has(event_type) && input_preview) {
    return "terminal events must not carry input_preview";
  }

  return {
    event_type,
    tool_use_id,
    operation,
    idempotency_key,
    input_preview,
    output_preview,
    error_preview,
    provider_request_id,
    duration_ms,
    provider_cost_usd,
    policy_revision,
    policy_decision_id,
    credential_owner_alias,
  };
}
