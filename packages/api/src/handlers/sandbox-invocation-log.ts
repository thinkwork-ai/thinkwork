/**
 * sandbox-invocation-log — narrow REST endpoint the Strands sandbox tool
 * POSTs to after each execute_code call finishes (plan Unit 11).
 *
 * POST /api/sandbox/invocations
 *   Authorization: Bearer <API_AUTH_SECRET>
 *   body: {
 *     tenant_id, agent_id, user_id,
 *     template_id?, tool_call_id?, session_id?, run_id?,
 *     environment_id,           // "default-public" | "internal-only"
 *     invocation_source?,       // "chat" | "scheduled" | "composition"
 *     started_at?, finished_at?,
 *     duration_ms?, exit_status?,
 *     stdout_bytes?, stderr_bytes?,
 *     stdout_truncated?, stderr_truncated?,
 *     peak_memory_mb?,
 *     outbound_hosts?,          // optional jsonb
 *     executed_code_hash?,      // SHA-256 of user code (not preamble, not tokens)
 *     failure_reason?,
 *   }
 *   → 201 { id } on insert
 *   → 400 on shape failure
 *   → 401 unauthorized
 *
 * Service-endpoint auth pattern (Bearer API_AUTH_SECRET). Fire-and-
 * log-on-failure on the container side — an audit row write failure
 * must not unwind the agent turn.
 */

import type {
  APIGatewayProxyEventV2,
  APIGatewayProxyStructuredResultV2,
} from "aws-lambda";
import { schema } from "@thinkwork/database-pg";
import { db } from "../lib/db.js";
import { extractBearerToken, validateApiSecret } from "../lib/auth.js";
import { error, json, unauthorized } from "../lib/response.js";

const { sandboxInvocations } = schema;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const ALLOWED_ENVIRONMENTS = new Set(["default-public", "internal-only"]);
const ALLOWED_EXIT_STATUSES = new Set([
  "ok",
  "error",
  "timeout",
  "oom",
  "cap_exceeded",
  "provisioning",
  "connection_revoked",
]);
const ALLOWED_SOURCES = new Set(["chat", "scheduled", "composition"]);

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
  if (event.rawPath !== "/api/sandbox/invocations") {
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

  const shape = shapeRow(body);
  if (!shape.ok) return error(shape.error, 400);
  const row = shape.value;

  try {
    const [inserted] = await db
      .insert(sandboxInvocations)
      .values(row)
      .returning({ id: sandboxInvocations.id });
    return json({ id: inserted.id }, 201);
  } catch (err) {
    console.error("[sandbox-invocation-log] INSERT failed:", err);
    return error("Internal server error", 500);
  }
}

// ---------------------------------------------------------------------------
// Pure shape + validation — exported for unit tests.
// ---------------------------------------------------------------------------

export type ShapedRow = {
  tenant_id: string;
  agent_id: string | null;
  user_id: string;
  template_id: string | null;
  tool_call_id: string | null;
  session_id: string | null;
  run_id: string | null;
  environment_id: string;
  invocation_source: string | null;
  started_at: Date;
  finished_at: Date | null;
  duration_ms: number | null;
  exit_status: string | null;
  stdout_bytes: number | null;
  stderr_bytes: number | null;
  stdout_truncated: boolean;
  stderr_truncated: boolean;
  peak_memory_mb: number | null;
  outbound_hosts: unknown;
  executed_code_hash: string | null;
  failure_reason: string | null;
};

export type ShapeResult =
  | { ok: true; value: ShapedRow }
  | { ok: false; error: string };

export function shapeRow(body: Record<string, unknown>): ShapeResult {
  const tenant_id = asString(body.tenant_id);
  if (!tenant_id || !UUID_RE.test(tenant_id)) {
    return { ok: false, error: "tenant_id: valid UUID required" };
  }
  const user_id = asString(body.user_id);
  if (!user_id || !UUID_RE.test(user_id)) {
    return { ok: false, error: "user_id: valid UUID required" };
  }
  const environment_id = asString(body.environment_id);
  if (!environment_id || !ALLOWED_ENVIRONMENTS.has(environment_id)) {
    return {
      ok: false,
      error: `environment_id: must be one of ${[...ALLOWED_ENVIRONMENTS].join(", ")}`,
    };
  }

  const agent_id = asOptionalUuid(body.agent_id);
  if (agent_id === INVALID) {
    return { ok: false, error: "agent_id: must be a UUID when present" };
  }
  const run_id = asOptionalUuid(body.run_id);
  if (run_id === INVALID) {
    return { ok: false, error: "run_id: must be a UUID when present" };
  }

  const exit_status = asOptionalString(body.exit_status);
  if (exit_status !== null && !ALLOWED_EXIT_STATUSES.has(exit_status)) {
    return {
      ok: false,
      error: `exit_status: must be one of ${[...ALLOWED_EXIT_STATUSES].join(", ")}`,
    };
  }

  const invocation_source = asOptionalString(body.invocation_source);
  if (invocation_source !== null && !ALLOWED_SOURCES.has(invocation_source)) {
    return {
      ok: false,
      error: `invocation_source: must be one of ${[...ALLOWED_SOURCES].join(", ")}`,
    };
  }

  const started_at = asOptionalDate(body.started_at) ?? new Date();
  const finished_at = asOptionalDate(body.finished_at);

  return {
    ok: true,
    value: {
      tenant_id,
      agent_id: agent_id === null ? null : agent_id,
      user_id,
      template_id: asOptionalString(body.template_id),
      tool_call_id: asOptionalString(body.tool_call_id),
      session_id: asOptionalString(body.session_id),
      run_id: run_id === null ? null : run_id,
      environment_id,
      invocation_source,
      started_at,
      finished_at,
      duration_ms: asOptionalNumber(body.duration_ms),
      exit_status,
      stdout_bytes: asOptionalNumber(body.stdout_bytes),
      stderr_bytes: asOptionalNumber(body.stderr_bytes),
      stdout_truncated: Boolean(body.stdout_truncated),
      stderr_truncated: Boolean(body.stderr_truncated),
      peak_memory_mb: asOptionalNumber(body.peak_memory_mb),
      outbound_hosts: body.outbound_hosts ?? null,
      executed_code_hash: asOptionalString(body.executed_code_hash),
      failure_reason: asOptionalString(body.failure_reason),
    },
  };
}

const INVALID = Symbol("invalid");

function asString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function asOptionalString(value: unknown): string | null {
  if (value === undefined || value === null || value === "") return null;
  return typeof value === "string" ? value : null;
}

function asOptionalNumber(value: unknown): number | null {
  if (value === undefined || value === null) return null;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  return null;
}

function asOptionalDate(value: unknown): Date | null {
  if (value === undefined || value === null) return null;
  if (typeof value === "string") {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  if (typeof value === "number") {
    return new Date(value);
  }
  return null;
}

function asOptionalUuid(value: unknown): string | null | typeof INVALID {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string") return INVALID;
  return UUID_RE.test(value) ? value : INVALID;
}
