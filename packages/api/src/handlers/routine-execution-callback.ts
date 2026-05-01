/**
 * routine-execution-callback — dual-mode lifecycle handler for SFN
 * executions (Plan 2026-05-01-005 §U9). Two entry shapes:
 *
 *   1. POST /api/routines/execution (Bearer API_AUTH_SECRET) — used by
 *      Task wrappers, the bridge, or anything that already speaks the
 *      callback contract.
 *   2. EventBridge direct invoke — the rule in
 *      `terraform/modules/app/routines-stepfunctions/main.tf` routes
 *      SFN `Step Functions Execution Status Change` events to this
 *      Lambda. The handler detects the EventBridge event shape and
 *      translates SFN-side casing (`SUCCEEDED`) to the lowercase
 *      schema-side enum (`succeeded`).
 *
 * Idempotency: the UPDATE is gated to `WHERE sfn_execution_arn = $1
 * AND status NOT IN (terminal states except the incoming status)`.
 * EventBridge double-delivery of the same terminal event becomes a
 * no-op UPDATE (zero rows affected, but `{ updated: true }` is still
 * the right caller signal — the row is in the desired state).
 *
 * Lifecycle ordering: a stale `running` event arriving after a
 * `succeeded` event must NOT regress the row. Terminal statuses
 * (succeeded / failed / cancelled / timed_out) lock the row out of
 * further status mutation; only LLM cost + finished_at can still be
 * recorded if missing.
 */

import type {
  APIGatewayProxyEventV2,
  APIGatewayProxyStructuredResultV2,
} from "aws-lambda";
import { eq, and, sql } from "drizzle-orm";
import { schema } from "@thinkwork/database-pg";
import { db } from "../lib/db.js";
import { extractBearerToken, validateApiSecret } from "../lib/auth.js";
import { error, json, unauthorized } from "../lib/response.js";

const { routineExecutions } = schema;

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ALLOWED_STATUSES = new Set([
  "running",
  "succeeded",
  "failed",
  "cancelled",
  "awaiting_approval",
  "timed_out",
]);

/** Terminal statuses lock the row out of further status changes — a
 * stale `running` event from EventBridge must not regress to running
 * after the execution already succeeded/failed. */
const TERMINAL_STATUSES = new Set([
  "succeeded",
  "failed",
  "cancelled",
  "timed_out",
]);

// ---------------------------------------------------------------------------
// EventBridge SFN-state-change shape — keys mirror the AWS event payload.
// ---------------------------------------------------------------------------

interface SfnEventBridgeEvent {
  source: string;
  "detail-type": string;
  detail: {
    executionArn: string;
    status: string; // SUCCEEDED | FAILED | TIMED_OUT | ABORTED | RUNNING
    startDate?: number; // unix-ms
    stopDate?: number; // unix-ms
    output?: string; // JSON string when SFN returned an output
    error?: string;
    cause?: string;
  };
}

function isEventBridgeEvent(event: unknown): event is SfnEventBridgeEvent {
  return (
    typeof event === "object" &&
    event !== null &&
    "source" in event &&
    (event as { source?: string }).source === "aws.states" &&
    "detail" in event
  );
}

const SFN_TO_SCHEMA_STATUS: Record<string, string> = {
  RUNNING: "running",
  SUCCEEDED: "succeeded",
  FAILED: "failed",
  TIMED_OUT: "timed_out",
  ABORTED: "cancelled",
};

/** Translate an EventBridge SFN-state-change event into the body shape
 * the rest of the handler already speaks. Exported for unit tests. */
export function eventBridgeToBody(
  event: SfnEventBridgeEvent,
): Record<string, unknown> {
  const detail = event.detail;
  const status = SFN_TO_SCHEMA_STATUS[detail.status] ?? detail.status;
  let outputJson: unknown = null;
  if (detail.output) {
    try {
      outputJson = JSON.parse(detail.output);
    } catch {
      outputJson = { raw: detail.output };
    }
  }
  return {
    executionArn: detail.executionArn,
    status,
    startedAt:
      typeof detail.startDate === "number"
        ? new Date(detail.startDate).toISOString()
        : undefined,
    finishedAt:
      typeof detail.stopDate === "number"
        ? new Date(detail.stopDate).toISOString()
        : undefined,
    errorCode: detail.error,
    errorMessage: detail.cause,
    outputJson,
  };
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export async function handler(
  event: APIGatewayProxyEventV2 | SfnEventBridgeEvent,
): Promise<APIGatewayProxyStructuredResultV2 | { updated: boolean }> {
  // EventBridge direct-invoke path: translate to the internal body shape
  // and run the same UPDATE logic. EventBridge ignores the API Gateway
  // response shape — return a small JSON object instead.
  if (isEventBridgeEvent(event)) {
    const body = eventBridgeToBody(event);
    const shape = shapeExecutionCallback(body);
    if (!shape.ok) {
      console.warn(
        `[routine-execution-callback] EventBridge shape rejected: ${shape.error} arn=${event.detail.executionArn}`,
      );
      return { updated: false };
    }
    return updateRoutineExecution(shape.value);
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
  if (event.rawPath !== "/api/routines/execution") {
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

  const shape = shapeExecutionCallback(body);
  if (!shape.ok) return error(shape.error, 400);
  const result = await updateRoutineExecution(shape.value);
  if (result.updated) return json(result, 200);
  return json(result, 404);
}

// ---------------------------------------------------------------------------
// Shared UPDATE logic — exercised by both the APIGW and EventBridge paths.
// ---------------------------------------------------------------------------

interface UpdateResult {
  updated: boolean;
  reason?: "not_found" | "idempotent";
}

async function updateRoutineExecution(
  row: ShapedExecutionUpdate,
): Promise<UpdateResult> {
  // Build the SET clause defensively. UPDATE only fields the caller
  // actually supplied so a partial event doesn't NULL-out values
  // already recorded by an earlier callback (e.g., started_at written
  // by the trigger resolver, then the EventBridge SUCCEEDED callback
  // arrives without started_at).
  const setClause: Record<string, unknown> = {
    status: row.status,
  };
  if (row.started_at !== null) setClause.started_at = row.started_at;
  if (row.finished_at !== null) setClause.finished_at = row.finished_at;
  if (row.total_llm_cost_usd_cents !== null) {
    setClause.total_llm_cost_usd_cents = row.total_llm_cost_usd_cents;
  }
  if (row.error_code !== null) setClause.error_code = row.error_code;
  if (row.error_message !== null) {
    setClause.error_message = row.error_message;
  }
  if (row.output_json !== null) setClause.output_json = row.output_json;

  try {
    // Conditional UPDATE: only mutate the row if the current status is
    // NOT terminal OR the incoming status matches the current status
    // (idempotent re-delivery of the same terminal). Terminal locks
    // out-of-order EventBridge re-delivery from regressing.
    const updated = await db
      .update(routineExecutions)
      .set(setClause)
      .where(
        and(
          eq(routineExecutions.sfn_execution_arn, row.sfn_execution_arn),
          sql`(${routineExecutions.status} NOT IN ('succeeded','failed','cancelled','timed_out')
                OR ${routineExecutions.status} = ${row.status})`,
        ),
      )
      .returning({ id: routineExecutions.id });

    if (updated.length === 0) {
      // Either the row doesn't exist (out-of-band SFN execution) or
      // it's already terminal in a different state. Verify which by
      // selecting:
      const existing = await db
        .select({ id: routineExecutions.id, status: routineExecutions.status })
        .from(routineExecutions)
        .where(eq(routineExecutions.sfn_execution_arn, row.sfn_execution_arn));
      if (existing.length === 0) {
        return { updated: false, reason: "not_found" };
      }
      // Row exists but is terminal in another status — log and treat as
      // success so EventBridge doesn't retry-storm.
      console.warn(
        `[routine-execution-callback] no-op: arn=${row.sfn_execution_arn} already terminal status=${existing[0].status}, incoming=${row.status}`,
      );
      return { updated: true, reason: "idempotent" };
    }
    return { updated: true };
  } catch (err) {
    console.error("[routine-execution-callback] UPDATE failed:", err);
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Pure shape + validation — exported for unit tests.
// ---------------------------------------------------------------------------

export type ShapedExecutionUpdate = {
  sfn_execution_arn: string;
  status: string;
  started_at: Date | null;
  finished_at: Date | null;
  total_llm_cost_usd_cents: number | null;
  error_code: string | null;
  error_message: string | null;
  output_json: unknown;
};

export type ShapeResult =
  | { ok: true; value: ShapedExecutionUpdate }
  | { ok: false; error: string };

export function shapeExecutionCallback(
  body: Record<string, unknown>,
): ShapeResult {
  const sfn_execution_arn = asString(body.executionArn);
  if (!sfn_execution_arn) {
    return { ok: false, error: "executionArn: required" };
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
      sfn_execution_arn,
      status,
      started_at: asOptionalDate(body.startedAt),
      finished_at: asOptionalDate(body.finishedAt),
      total_llm_cost_usd_cents: asOptionalNumber(body.totalLlmCostUsdCents),
      error_code: asOptionalString(body.errorCode),
      error_message: asOptionalString(body.errorMessage),
      output_json: body.outputJson ?? null,
    },
  };
}

// Re-export the terminal-status constant so tests can reason about the
// transition matrix without re-defining it.
export { TERMINAL_STATUSES };

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
