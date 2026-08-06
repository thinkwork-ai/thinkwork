/**
 * Webhook Trigger Handler — PRD-19
 *
 * Public endpoint (no bearer auth — the token IS the auth).
 *
 * Routes:
 *   POST /webhooks/:token  — trigger a webhook by token
 *
 * Every inbound request — success or failure, rate-limited or replayed,
 * task / agent / routine — is recorded exactly once in `webhook_deliveries`
 * via a single INSERT at the end of the handler. The pipeline builds a
 * working `DeliveryRecord` as it runs, then commits it inside a try/catch
 * so a logging failure never masks the underlying response.
 */

import type {
  APIGatewayProxyEventV2,
  APIGatewayProxyStructuredResultV2,
} from "aws-lambda";
import { createHash } from "node:crypto";
import { eq, and, sql } from "drizzle-orm";
import {
  webhooks,
  webhookDeliveries,
  webhookIdempotency,
  threadTurns,
  agentWakeupRequests,
  connectProviders,
} from "@thinkwork/database-pg/schema";
import { db } from "../lib/db.js";
import {
  authStateStoreMode,
  claimReceipt,
  getReceipt,
} from "../lib/auth-state-store.js";
import { json, error, notFound } from "../lib/response.js";
import { startSpaceWebhookThread } from "../lib/spaces/space-webhook-thread-start.js";
import { dispatchAutomationWebhook } from "../lib/webhooks/automation-webhook-dispatch.js";
import { startInterpreterRun } from "../lib/workflows/start-interpreter-run.js";

// ---------------------------------------------------------------------------
// In-memory rate limiter (sliding window, resets on cold start)
// ---------------------------------------------------------------------------

const rateLimitWindow = new Map<string, { count: number; resetAt: number }>();

function checkRateLimit(webhookId: string, limit: number): boolean {
  const now = Date.now();
  const entry = rateLimitWindow.get(webhookId);
  if (!entry || now >= entry.resetAt) {
    rateLimitWindow.set(webhookId, { count: 1, resetAt: now + 60_000 });
    return true;
  }
  if (entry.count >= limit) return false;
  entry.count++;
  return true;
}

// ---------------------------------------------------------------------------
// Idempotency receipts (THINK-644)
//
// `webhook_idempotency` is a receipt table wearing a domain table's clothes: a
// row records "delivery already handled", nothing reads it but the dedupe check
// below, and nothing ever deletes it. It has no retention — rows survive until
// the parent webhook is dropped (FK cascade) — so a chatty provider that sends
// an `X-Idempotency-Key` grows the primary Aurora cluster forever. That is the
// exact shape the THINK-643 DynamoDB store exists for, so when
// `AUTH_STATE_STORE=dynamo` the check and the write move there and DynamoDB TTL
// does the retention Postgres never had.
//
// TTL = 7 days. There is no Postgres retention to match, so the number is
// chosen from what the receipts are *for*: provider retry windows. Stripe,
// GitHub, Linear and Slack all abandon a delivery well inside 72h, so 7 days is
// better than 2x the longest window any real caller retries across, while still
// bounding the store. Deduplication past that point was never a promise the
// Postgres table made in practice either — it just never cleaned up.
// ---------------------------------------------------------------------------

const WEBHOOK_RECEIPT_KIND = "webhook";
const WEBHOOK_RECEIPT_TTL_SECONDS = 7 * 24 * 60 * 60;

/** Mirrors the Postgres unique index: (webhook_id, idempotency_key). */
function webhookReceiptKey(webhookId: string, idempotencyKey: string): string {
  return `${webhookId}:${idempotencyKey}`;
}

/**
 * Look for a prior receipt for this delivery.
 *
 * Returns null when this key has not been seen, or the recorded turn id when it
 * has. `turnId` is deliberately `string | null` on both paths: the Postgres
 * column is nullable, so a hit with no turn id must stay a hit — collapsing the
 * two into one nullable return would make an existing-but-null row read as
 * "never seen" and re-dispatch the delivery.
 */
async function findWebhookReceipt(
  webhookId: string,
  idempotencyKey: string,
): Promise<{ turnId: string | null } | null> {
  if (authStateStoreMode() === "dynamo") {
    const receipt = await getReceipt(
      WEBHOOK_RECEIPT_KIND,
      webhookReceiptKey(webhookId, idempotencyKey),
    );
    return receipt ? { turnId: receipt.value?.turnId ?? null } : null;
  }
  const [existing] = await db
    .select()
    .from(webhookIdempotency)
    .where(
      and(
        eq(webhookIdempotency.webhook_id, webhookId),
        eq(webhookIdempotency.idempotency_key, idempotencyKey),
      ),
    );
  return existing ? { turnId: existing.turn_id } : null;
}

/**
 * Record the delivery as handled.
 *
 * Placed exactly where the Postgres INSERT was — after the wakeup/turn exists,
 * not at the check above. A receipt is a record of work *done*: claiming before
 * dispatch would mean a delivery that 500s leaves a receipt behind, and every
 * retry of it would then be answered "already handled" for the whole TTL. The
 * conditional write is still worth having: two concurrent deliveries of the
 * same key both dispatch (as they do on Postgres today), but the loser gets a
 * clean `duplicate` instead of the unique-violation 500 Postgres raises.
 */
async function writeWebhookReceipt(
  webhookId: string,
  idempotencyKey: string,
  turnId: string,
): Promise<void> {
  if (authStateStoreMode() === "dynamo") {
    await claimReceipt(
      WEBHOOK_RECEIPT_KIND,
      webhookReceiptKey(webhookId, idempotencyKey),
      WEBHOOK_RECEIPT_TTL_SECONDS,
      { turnId },
    );
    return;
  }
  await db.insert(webhookIdempotency).values({
    webhook_id: webhookId,
    idempotency_key: idempotencyKey,
    turn_id: turnId,
  });
}

// ---------------------------------------------------------------------------
// Header redaction — whitelist safe headers, never store Authorization /
// cookies / API keys even if a misconfigured provider sends them.
// ---------------------------------------------------------------------------

const HEADER_WHITELIST = new Set([
  "content-type",
  "content-length",
  "user-agent",
  "x-forwarded-for",
  "x-request-id",
  "x-idempotency-key",
]);

const HEADER_PREFIX_WHITELIST = ["x-linear-", "x-hub-signature", "x-github-"];

function redactHeaders(
  headers: Record<string, string>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) {
    const key = k.toLowerCase();
    if (HEADER_WHITELIST.has(key)) {
      out[key] = v;
      continue;
    }
    if (HEADER_PREFIX_WHITELIST.some((p) => key.startsWith(p))) {
      // Signature headers get reduced to a 16-char prefix for debug only.
      if (key.endsWith("-signature")) {
        out[key] = typeof v === "string" ? v.slice(0, 16) : "";
      } else {
        out[key] = v;
      }
    }
  }
  return out;
}

function extractSignaturePrefix(
  headers: Record<string, string>,
): string | undefined {
  for (const [k, v] of Object.entries(headers)) {
    if (k.toLowerCase().endsWith("-signature") && typeof v === "string") {
      return v.slice(0, 16);
    }
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Delivery record accumulator
// ---------------------------------------------------------------------------

type SignatureStatus =
  | "verified"
  | "invalid"
  | "missing"
  | "skipped_dev"
  | "not_required";

type ResolutionStatus =
  | "ok"
  | "unverified"
  | "unresolved_token"
  | "unresolved_connection"
  | "rate_limited"
  | "invalid_body"
  | "ignored"
  | "error";

interface DeliveryRecord {
  webhook_id?: string;
  tenant_id?: string;
  target_type?: string;
  provider_id?: string;
  provider_name?: string;
  provider_event_id?: string;
  external_task_id?: string;
  provider_user_id?: string;
  normalized_kind?: string;

  received_at: Date;
  source_ip?: string;
  body_preview?: string;
  body_sha256?: string;
  body_size_bytes?: number;
  headers_safe?: Record<string, string>;
  signature_prefix?: string;

  signature_status: SignatureStatus;
  resolution_status: ResolutionStatus;
  thread_id?: string;
  thread_created?: boolean;
  status_code?: number;
  error_message?: string;
  start_ms: number;

  is_replay?: boolean;
}

const BODY_PREVIEW_MAX = 8 * 1024;

async function recordDelivery(record: DeliveryRecord): Promise<void> {
  try {
    await db.insert(webhookDeliveries).values({
      webhook_id: record.webhook_id,
      tenant_id: record.tenant_id,
      target_type: record.target_type,
      provider_id: record.provider_id,
      provider_name: record.provider_name,
      provider_event_id: record.provider_event_id,
      external_task_id: record.external_task_id,
      provider_user_id: record.provider_user_id,
      normalized_kind: record.normalized_kind,
      received_at: record.received_at,
      source_ip: record.source_ip,
      body_preview: record.body_preview,
      body_sha256: record.body_sha256,
      body_size_bytes: record.body_size_bytes,
      headers_safe: record.headers_safe,
      signature_prefix: record.signature_prefix,
      signature_status: record.signature_status,
      resolution_status: record.resolution_status,
      thread_id: record.thread_id,
      thread_created: record.thread_created,
      status_code: record.status_code,
      error_message: record.error_message,
      duration_ms: Date.now() - record.start_ms,
      is_replay: record.is_replay ?? false,
    });
  } catch (err) {
    console.error(
      "[webhooks] delivery_log_failed:",
      (err as Error).message ?? err,
    );
  }
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export async function handler(
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyStructuredResultV2> {
  const method = event.requestContext.http.method;
  const path = event.rawPath;

  if (method !== "POST") return error("Method not allowed", 405);

  const tokenMatch = path.match(/^\/webhooks\/([^/]+)$/);
  if (!tokenMatch) return notFound("Route not found");

  const rawBody = event.body ?? "";
  const lowerHeaders: Record<string, string> = {};
  for (const [k, v] of Object.entries(event.headers || {})) {
    if (typeof v === "string") lowerHeaders[k.toLowerCase()] = v;
  }

  const record: DeliveryRecord = {
    received_at: new Date(),
    source_ip:
      (event.requestContext.http.sourceIp as string | undefined) ||
      lowerHeaders["x-forwarded-for"]?.split(",")[0]?.trim(),
    body_preview:
      rawBody.length > BODY_PREVIEW_MAX
        ? rawBody.slice(0, BODY_PREVIEW_MAX)
        : rawBody,
    body_sha256: rawBody
      ? createHash("sha256").update(rawBody).digest("hex")
      : undefined,
    body_size_bytes: Buffer.byteLength(rawBody, "utf8"),
    headers_safe: redactHeaders(lowerHeaders),
    signature_prefix: extractSignaturePrefix(lowerHeaders),
    signature_status: "not_required",
    resolution_status: "error",
    start_ms: Date.now(),
  };

  let response: APIGatewayProxyStructuredResultV2;
  try {
    response = await triggerByToken(
      tokenMatch[1],
      rawBody,
      lowerHeaders,
      event,
      record,
    );
  } catch (err) {
    console.error("Webhook trigger handler error:", err);
    record.resolution_status = "error";
    record.error_message = (err as Error).message ?? String(err);
    record.status_code = 500;
    response = error("Internal server error", 500);
  }

  await recordDelivery(record);
  return response;
}

// ---------------------------------------------------------------------------
// Dispatch
// ---------------------------------------------------------------------------

async function triggerByToken(
  token: string,
  rawBody: string,
  headers: Record<string, string>,
  event: APIGatewayProxyEventV2,
  record: DeliveryRecord,
): Promise<APIGatewayProxyStructuredResultV2> {
  // 1. Look up webhook by token (unique indexed column, O(1))
  const [webhook] = await db
    .select()
    .from(webhooks)
    .where(and(eq(webhooks.token, token), eq(webhooks.enabled, true)));

  if (!webhook) {
    record.resolution_status = "unresolved_token";
    record.status_code = 404;
    return notFound("Webhook not found");
  }

  record.webhook_id = webhook.id;
  record.tenant_id = webhook.tenant_id;
  const targetType = webhook.target_type.toLowerCase();
  record.target_type = targetType;

  // 2. Rate limit check
  const limit = webhook.rate_limit ?? 60;
  if (!checkRateLimit(webhook.id, limit)) {
    record.resolution_status = "rate_limited";
    record.status_code = 429;
    return {
      statusCode: 429,
      headers: { "Content-Type": "application/json", "Retry-After": "60" },
      body: JSON.stringify({ error: "Rate limit exceeded" }),
    };
  }

  // 3. Idempotency check — see findWebhookReceipt for the store split.
  //
  // The automation branch (THINK-137 U6) does NOT use webhook_idempotency: its
  // load-bearing idempotency is the dispatcher's derived key on agent_loop_runs
  // (header-when-present, else a hash of webhook id + body). The legacy agent /
  // routine branches keep the header-only skip-when-absent behavior (U8 retires
  // them).
  const idempotencyKey = headers["x-idempotency-key"];
  if (
    targetType !== "automation" &&
    targetType !== "workflow" &&
    idempotencyKey
  ) {
    const existing = await findWebhookReceipt(webhook.id, idempotencyKey);
    if (existing) {
      record.resolution_status = "ok";
      record.is_replay = true;
      record.status_code = 200;
      return json({ ok: true, turnId: existing.turnId, deduplicated: true });
    }
  }

  // 4. Parse body
  let parsedBody: Record<string, unknown> = {};
  try {
    parsedBody = rawBody ? JSON.parse(rawBody) : {};
  } catch {
    record.resolution_status = "invalid_body";
    record.status_code = 400;
    return error("Invalid JSON body");
  }

  // 5. Dispatch based on target type

  if (targetType === "automation" && webhook.agent_loop_id) {
    const { response, delivery } = await dispatchAutomationWebhook({
      webhook,
      parsedBody,
      rawBody,
      headerIdempotencyKey: idempotencyKey,
    });
    record.resolution_status = delivery.resolution_status;
    record.status_code = delivery.status_code;
    if (delivery.thread_id !== undefined) record.thread_id = delivery.thread_id;
    if (delivery.thread_created !== undefined) {
      record.thread_created = delivery.thread_created;
    }
    if (delivery.error_message !== undefined) {
      record.error_message = delivery.error_message;
    }
    if (delivery.is_replay !== undefined) record.is_replay = delivery.is_replay;
    return response;
  }
  // workflow (THINK-216): start a shared-interpreter run with the caller
  // payload as the run input (R13/R15 — the generic surface external engines
  // use). Idempotency mirrors the automation branch: header when present,
  // else a deterministic hash of webhook id + raw body, keyed on
  // workflow_runs. The caller receives the run identifier.
  if (targetType === "workflow" && webhook.workflow_id) {
    const derivedKey =
      idempotencyKey ??
      createHash("sha256")
        .update(`${webhook.id}:${rawBody}`)
        .digest("hex")
        .slice(0, 48);
    try {
      const result = await startInterpreterRun({
        tenantId: webhook.tenant_id,
        workflowId: webhook.workflow_id,
        triggerFamily: "webhook",
        triggerSource: `webhook:${webhook.id}`,
        idempotencyKey: `webhook:${webhook.id}:${derivedKey}`,
        actorType: "webhook",
        actorId: webhook.id,
        payload: parsedBody,
        requestedByUserId:
          webhook.created_by_type === "user" ? webhook.created_by_id : null,
        spaceId: webhook.space_id ?? null,
      });
      if (!result.ok) {
        record.resolution_status = "error";
        record.error_message = result.reason;
        record.status_code = 409;
        return {
          statusCode: 409,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ok: false, reason: result.reason }),
        };
      }
      record.resolution_status = "ok";
      record.status_code = 202;
      record.is_replay = !result.created;
      return {
        statusCode: 202,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ok: true,
          runId: result.runId,
          deduplicated: !result.created,
        }),
      };
    } catch (err) {
      record.resolution_status = "error";
      record.error_message = err instanceof Error ? err.message : String(err);
      record.status_code = 500;
      return error("Workflow run failed to start");
    }
  }
  if (targetType === "agent" && webhook.agent_id) {
    return dispatchAgent(webhook, parsedBody, idempotencyKey, record);
  }
  if (targetType === "routine" && webhook.routine_id) {
    return dispatchRoutine(webhook, parsedBody, idempotencyKey, record);
  }

  record.resolution_status = "error";
  record.error_message = "Webhook has no valid target configured";
  record.status_code = 500;
  return error("Webhook has no valid target configured");
}

// ---------------------------------------------------------------------------
// Agent dispatch (existing behavior)
// ---------------------------------------------------------------------------

async function dispatchAgent(
  webhook: typeof webhooks.$inferSelect,
  body: Record<string, unknown>,
  idempotencyKey: string | undefined,
  record: DeliveryRecord,
): Promise<APIGatewayProxyStructuredResultV2> {
  if (!webhook.agent_id) {
    record.resolution_status = "error";
    record.error_message = "Agent webhook missing agent_id";
    record.status_code = 500;
    return error("Webhook has no valid target configured");
  }

  let threadStart: Awaited<ReturnType<typeof startSpaceWebhookThread>>;
  try {
    threadStart = await startSpaceWebhookThread({
      tenantId: webhook.tenant_id,
      agentId: webhook.agent_id,
      spaceId: webhook.space_id ?? undefined,
      webhookId: webhook.id,
      webhookName: webhook.name,
      payload: body,
    });
  } catch (err) {
    console.warn("[webhooks] Failed to start webhook thread:", err);
    record.resolution_status = "error";
    record.error_message = (err as Error).message ?? String(err);
    record.status_code = 500;
    return error("Failed to start webhook thread", 500);
  }

  const payload: Record<string, unknown> = {
    ...threadStart.agentContext,
    threadId: threadStart.threadId,
    threadIdentifier: threadStart.identifier,
    threadNumber: threadStart.number,
    openingMessageContent: threadStart.openingMessageContent,
    workflow: threadStart.workflow,
  };
  if (webhook.prompt) payload.message = webhook.prompt;

  const [wakeup] = await db
    .insert(agentWakeupRequests)
    .values({
      tenant_id: webhook.tenant_id,
      agent_id: webhook.agent_id,
      source: "webhook",
      trigger_detail: `webhook:${webhook.id}`,
      reason: `Webhook: ${webhook.name}`,
      payload,
      requested_by_actor_type: "system",
    })
    .returning();

  if (idempotencyKey) {
    await writeWebhookReceipt(webhook.id, idempotencyKey, wakeup.id);
  }

  await db
    .update(webhooks)
    .set({
      last_invoked_at: new Date(),
      invocation_count: sql`${webhooks.invocation_count} + 1`,
    })
    .where(eq(webhooks.id, webhook.id));

  const warnings = threadStart.warnings;
  record.resolution_status = "ok";
  record.thread_id = threadStart.threadId;
  record.thread_created = true;
  record.status_code = warnings.length > 0 ? 202 : 201;
  record.error_message =
    warnings.length > 0
      ? warnings.map((warning) => warning.message).join("; ")
      : undefined;
  return json(
    {
      ok: true,
      wakeupRequestId: wakeup.id,
      threadId: threadStart.threadId,
      warnings: warnings.length > 0 ? warnings : undefined,
      warning: warnings[0]?.message,
    },
    record.status_code,
  );
}

// ---------------------------------------------------------------------------
// Routine dispatch (existing behavior)
// ---------------------------------------------------------------------------

async function dispatchRoutine(
  webhook: typeof webhooks.$inferSelect,
  body: Record<string, unknown>,
  idempotencyKey: string | undefined,
  record: DeliveryRecord,
): Promise<APIGatewayProxyStructuredResultV2> {
  if (!webhook.routine_id) {
    record.resolution_status = "error";
    record.error_message = "Routine webhook missing routine_id";
    record.status_code = 500;
    return error("Webhook has no valid target configured");
  }

  const [turn] = await db
    .insert(threadTurns)
    .values({
      tenant_id: webhook.tenant_id,
      routine_id: webhook.routine_id,
      webhook_id: webhook.id,
      invocation_source: "webhook",
      trigger_detail: `webhook:${webhook.id}`,
      status: "queued",
      context_snapshot: { ...body, spaceId: webhook.space_id },
    })
    .returning();

  if (idempotencyKey) {
    await writeWebhookReceipt(webhook.id, idempotencyKey, turn.id);
  }

  await db
    .update(webhooks)
    .set({
      last_invoked_at: new Date(),
      invocation_count: sql`${webhooks.invocation_count} + 1`,
    })
    .where(eq(webhooks.id, webhook.id));

  record.resolution_status = "ok";
  record.status_code = 201;
  return json({ ok: true, turnId: turn.id }, 201);
}

// ---------------------------------------------------------------------------
// Task dispatch removed in Phase C — external task webhook ingest is no
// longer part of ThinkWork. Webhooks with target_type="task" now fall
// through to the "no valid target configured" branch.
// ---------------------------------------------------------------------------
