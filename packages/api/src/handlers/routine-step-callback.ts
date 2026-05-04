/**
 * routine-step-callback — narrow REST endpoint Task wrappers and the
 * EventBridge SFN-state-change rule POST to in order to populate
 * `routine_step_events` (Plan 2026-05-01-005 §U9).
 *
 * POST /api/routines/step
 *   Authorization: Bearer <API_AUTH_SECRET>
 *   body: {
 *     tenantId, executionArn, nodeId, recipeType,
 *     status,                 // running | succeeded | failed | cancelled | timed_out | awaiting_approval
 *     startedAt?, finishedAt?,
 *     inputJson?, outputJson?, errorJson?,
 *     llmCostUsdCents?, retryCount?,
 *     stdoutS3Uri?, stderrS3Uri?, stdoutPreview?, truncated?
 *   }
 *   → 201 { id, deduped: false }            -- new row inserted
 *   → 200 { id: null, deduped: true }       -- idempotent re-delivery
 *   → 404 { error: "execution not found" }  -- no routine_executions row for executionArn
 *   → 400 on shape failure
 *   → 401 on bad Bearer
 *
 * Service-endpoint auth pattern (Bearer API_AUTH_SECRET) — same shape as
 * sandbox-quota-check / sandbox-invocation-log. CloudWatch / EventBridge
 * may double-deliver; idempotency is enforced by the partial unique
 * index on (execution_id, node_id, status, started_at) WHERE started_at
 * IS NOT NULL (migration 0056). The handler relies on ON CONFLICT DO
 * NOTHING so the second delivery is a no-op DB insert.
 *
 * Caller passes `executionArn` (the SFN execution ARN, which is what
 * Task wrappers + EventBridge rules naturally have). The handler
 * resolves it to the `routine_executions.id` UUID PK before inserting
 * — this keeps the FK referential and avoids forcing every caller to
 * remember the row UUID separately.
 */

import type {
  APIGatewayProxyEventV2,
  APIGatewayProxyStructuredResultV2,
} from "aws-lambda";
import { eq, sql } from "drizzle-orm";
import { schema } from "@thinkwork/database-pg";
import { db } from "../lib/db.js";
import { extractBearerToken, validateApiSecret } from "../lib/auth.js";
import { error, json, unauthorized } from "../lib/response.js";

const { routineStepEvents, routineExecutions } = schema;

// ---------------------------------------------------------------------------
// Constants — single source of truth for allowed enums.
// ---------------------------------------------------------------------------

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** SFN state names are bounded to printable ASCII without `/` per the
 * AWS ASL spec; reject anything that could path-traverse downstream
 * S3-keying logic. Mirrors the constraint in
 * `packages/lambda/routine-task-python.ts`. */
const NODE_ID_RE = /^[A-Za-z0-9_.-]{1,80}$/;

const ALLOWED_STATUSES = new Set([
  "running",
  "succeeded",
  "failed",
  "cancelled",
  "timed_out",
  "awaiting_approval",
]);

/** v0 recipe vocabulary. Matches the recipe-catalog ids in
 * `packages/api/src/lib/routines/recipe-catalog.ts`. */
const ALLOWED_RECIPES = new Set([
  "http_request",
  "aurora_query",
  "transform_json",
  "set_variable",
  "slack_send",
  "email_send",
  "inbox_approval",
  "python",
  "typescript",
  "agent_invoke",
  "tool_invoke",
  "routine_invoke",
  "choice",
  "wait",
  "map",
  "sequence",
  "fail",
]);

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

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
  if (event.rawPath !== "/api/routines/step") {
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

  const shape = shapeStepCallback(body);
  if (!shape.ok) return error(shape.error, 400);
  const shaped = shape.value;

  // Resolve sfn_execution_arn → routine_executions.id. Caller doesn't
  // know the row UUID (Task wrappers + EventBridge only carry the ARN).
  const [execution] = await db
    .select({
      id: routineExecutions.id,
      tenant_id: routineExecutions.tenant_id,
    })
    .from(routineExecutions)
    .where(eq(routineExecutions.sfn_execution_arn, shaped.execution_arn));
  if (!execution) {
    // Out-of-band SFN execution or pre-insert race — caller can retry.
    return error(
      `routine_executions row not found for executionArn=${shaped.execution_arn}`,
      404,
    );
  }
  // Cross-tenant guard: the caller-supplied tenantId must match the
  // execution's tenant. A malformed ASL or compromised callback caller
  // could otherwise pin step events onto a foreign tenant.
  if (execution.tenant_id !== shaped.tenant_id) {
    return error("tenantId does not match execution's tenant", 403);
  }

  const row = {
    tenant_id: shaped.tenant_id,
    execution_id: execution.id,
    node_id: shaped.node_id,
    recipe_type: shaped.recipe_type,
    status: shaped.status,
    started_at: shaped.started_at,
    finished_at: shaped.finished_at,
    input_json: shaped.input_json,
    output_json: shaped.output_json,
    error_json: shaped.error_json,
    llm_cost_usd_cents: shaped.llm_cost_usd_cents,
    retry_count: shaped.retry_count,
    stdout_s3_uri: shaped.stdout_s3_uri,
    stderr_s3_uri: shaped.stderr_s3_uri,
    stdout_preview: shaped.stdout_preview,
    truncated: shaped.truncated,
  };

  try {
    // ON CONFLICT DO NOTHING against the partial unique index added in
    // migration 0056. .returning() yields zero rows when the conflict
    // path fires — the second EventBridge / Lambda-retry delivery.
    const inserted = await db
      .insert(routineStepEvents)
      .values(row)
      .onConflictDoNothing({
        target: [
          routineStepEvents.execution_id,
          routineStepEvents.node_id,
          routineStepEvents.status,
          routineStepEvents.started_at,
        ],
        // Partial-index predicate matches migration 0056 — required so PG
        // routes the conflict check to idx_routine_step_events_dedup
        // (which is partial on `WHERE started_at IS NOT NULL`).
        where: sql`${routineStepEvents.started_at} IS NOT NULL`,
      })
      .returning({ id: routineStepEvents.id });

    if (inserted.length === 0) {
      return json({ id: null, deduped: true }, 200);
    }
    return json({ id: inserted[0].id, deduped: false }, 201);
  } catch (err) {
    console.error("[routine-step-callback] INSERT failed:", err);
    return error("Internal server error", 500);
  }
}

// ---------------------------------------------------------------------------
// Pure shape + validation — exported for unit tests.
// ---------------------------------------------------------------------------

export type ShapedStepEvent = {
  tenant_id: string;
  execution_arn: string;
  node_id: string;
  recipe_type: string;
  status: string;
  started_at: Date | null;
  finished_at: Date | null;
  input_json: unknown;
  output_json: unknown;
  error_json: unknown;
  llm_cost_usd_cents: number | null;
  retry_count: number;
  stdout_s3_uri: string | null;
  stderr_s3_uri: string | null;
  stdout_preview: string | null;
  truncated: boolean;
};

export type ShapeResult =
  | { ok: true; value: ShapedStepEvent }
  | { ok: false; error: string };

export function shapeStepCallback(body: Record<string, unknown>): ShapeResult {
  const tenant_id = asString(body.tenantId);
  if (!tenant_id || !UUID_RE.test(tenant_id)) {
    return { ok: false, error: "tenantId: valid UUID required" };
  }
  const execution_arn = asString(body.executionArn);
  if (!execution_arn) {
    return { ok: false, error: "executionArn: required" };
  }
  const node_id = asString(body.nodeId);
  if (!node_id || !NODE_ID_RE.test(node_id)) {
    return {
      ok: false,
      error: "nodeId: 1-80 chars [A-Za-z0-9_.-] required",
    };
  }
  const recipe_type = asString(body.recipeType);
  if (!recipe_type || !ALLOWED_RECIPES.has(recipe_type)) {
    return {
      ok: false,
      error: `recipeType: must be one of ${[...ALLOWED_RECIPES].join(", ")}`,
    };
  }
  const status = asString(body.status);
  if (!status || !ALLOWED_STATUSES.has(status)) {
    return {
      ok: false,
      error: `status: must be one of ${[...ALLOWED_STATUSES].join(", ")}`,
    };
  }

  return {
    ok: true,
    value: {
      tenant_id,
      execution_arn,
      node_id,
      recipe_type,
      status,
      started_at: asOptionalDate(body.startedAt),
      finished_at: asOptionalDate(body.finishedAt),
      input_json: body.inputJson ?? null,
      output_json: body.outputJson ?? null,
      error_json: body.errorJson ?? null,
      llm_cost_usd_cents: asOptionalNumber(body.llmCostUsdCents),
      retry_count: asOptionalNumber(body.retryCount) ?? 0,
      stdout_s3_uri: asOptionalString(body.stdoutS3Uri),
      stderr_s3_uri: asOptionalString(body.stderrS3Uri),
      stdout_preview: asOptionalString(body.stdoutPreview),
      truncated: Boolean(body.truncated),
    },
  };
}

// ---------------------------------------------------------------------------
// Coercion helpers
// ---------------------------------------------------------------------------

function asString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
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
