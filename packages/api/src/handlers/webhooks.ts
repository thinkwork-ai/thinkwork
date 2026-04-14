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
import { json, error, notFound } from "../lib/response.js";
import { ensureThreadForWork } from "../lib/thread-helpers.js";
import {
	ingestExternalTaskEvent,
	type IngestResult,
} from "../integrations/external-work-items/ingestEvent.js";
import type { TaskProvider } from "../integrations/external-work-items/types.js";

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

const HEADER_PREFIX_WHITELIST = [
	"x-lastmile-",
	"x-linear-",
	"x-hub-signature",
	"x-github-",
];

function redactHeaders(headers: Record<string, string>): Record<string, string> {
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

function extractSignaturePrefix(headers: Record<string, string>): string | undefined {
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
		body_preview: rawBody.length > BODY_PREVIEW_MAX
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
	record.target_type = webhook.target_type;

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

	// 3. Idempotency check
	const idempotencyKey = headers["x-idempotency-key"];
	if (idempotencyKey) {
		const [existing] = await db
			.select()
			.from(webhookIdempotency)
			.where(
				and(
					eq(webhookIdempotency.webhook_id, webhook.id),
					eq(webhookIdempotency.idempotency_key, idempotencyKey),
				),
			);
		if (existing) {
			record.resolution_status = "ok";
			record.is_replay = true;
			record.status_code = 200;
			return json({ ok: true, turnId: existing.turn_id, deduplicated: true });
		}
	}

	// 4. Parse body (not needed for task branch — it passes rawBody through)
	let parsedBody: Record<string, unknown> = {};
	if (webhook.target_type !== "task") {
		try {
			parsedBody = rawBody ? JSON.parse(rawBody) : {};
		} catch {
			record.resolution_status = "invalid_body";
			record.status_code = 400;
			return error("Invalid JSON body");
		}
	}

	// 5. Dispatch based on target type

	if (webhook.target_type === "agent" && webhook.agent_id) {
		return dispatchAgent(webhook, parsedBody, idempotencyKey, record);
	}
	if (webhook.target_type === "routine" && webhook.routine_id) {
		return dispatchRoutine(webhook, parsedBody, idempotencyKey, record);
	}
	if (webhook.target_type === "task" && webhook.connect_provider_id) {
		return dispatchTask(webhook, rawBody, headers, record);
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

	let threadId: string | undefined;
	try {
		const result = await ensureThreadForWork({
			tenantId: webhook.tenant_id,
			agentId: webhook.agent_id,
			title: webhook.name,
			channel: "webhook",
		});
		threadId = result.threadId;
	} catch (err) {
		console.warn("[webhooks] Failed to create thread:", err);
	}

	const payload: Record<string, unknown> = {
		webhookPayload: body,
		webhookId: webhook.id,
		webhookName: webhook.name,
	};
	if (webhook.prompt) payload.message = webhook.prompt;
	if (threadId) payload.threadId = threadId;

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
		await db.insert(webhookIdempotency).values({
			webhook_id: webhook.id,
			idempotency_key: idempotencyKey,
			turn_id: wakeup.id,
		});
	}

	await db
		.update(webhooks)
		.set({
			last_invoked_at: new Date(),
			invocation_count: sql`${webhooks.invocation_count} + 1`,
		})
		.where(eq(webhooks.id, webhook.id));

	record.resolution_status = "ok";
	record.thread_id = threadId;
	record.status_code = 201;
	return json({ ok: true, wakeupRequestId: wakeup.id }, 201);
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
			context_snapshot: body,
		})
		.returning();

	if (idempotencyKey) {
		await db.insert(webhookIdempotency).values({
			webhook_id: webhook.id,
			idempotency_key: idempotencyKey,
			turn_id: turn.id,
		});
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
// Task dispatch — route inbound external-task events through the adapter
// ingest pipeline. The per-tenant signing secret lives on webhook.config.secret
// and is passed into adapter.verifySignature; when absent, the token in the
// URL is the sole auth (see verifyLastmileSignature).
// ---------------------------------------------------------------------------

async function dispatchTask(
	webhook: typeof webhooks.$inferSelect,
	rawBody: string,
	headers: Record<string, string>,
	record: DeliveryRecord,
): Promise<APIGatewayProxyStructuredResultV2> {
	if (!webhook.connect_provider_id) {
		record.resolution_status = "error";
		record.error_message = "Task webhook missing connect_provider_id";
		record.status_code = 500;
		return error("Webhook has no valid target configured");
	}

	const [provider] = await db
		.select({ id: connectProviders.id, name: connectProviders.name })
		.from(connectProviders)
		.where(eq(connectProviders.id, webhook.connect_provider_id));
	if (!provider) {
		record.resolution_status = "error";
		record.error_message = "connect_providers row not found";
		record.status_code = 500;
		return error("Webhook provider not found", 500);
	}
	record.provider_id = provider.id;
	record.provider_name = provider.name;

	const cfg = (webhook.config as Record<string, unknown> | null) ?? {};
	const secret = typeof cfg.secret === "string" ? cfg.secret : undefined;

	const result: IngestResult = await ingestExternalTaskEvent({
		provider: provider.name as TaskProvider,
		rawBody,
		headers,
		tenantId: webhook.tenant_id,
		secret,
	});

	// Populate delivery fields from the ingest result
	if (result.status === "ok" && result.event) {
		record.external_task_id = result.event.externalTaskId;
		record.provider_user_id = result.event.providerUserId;
		record.normalized_kind = result.event.kind;
		record.thread_id = result.threadId;
		record.thread_created = result.created;
	} else if (result.status === "unresolved_connection") {
		if (result.event) {
			record.external_task_id = result.event.externalTaskId;
			record.provider_user_id = result.event.providerUserId ?? result.providerUserId;
			record.normalized_kind = result.event.kind;
		} else {
			record.provider_user_id = result.providerUserId;
		}
	}

	switch (result.status) {
		case "ignored":
			record.resolution_status = "ignored";
			record.error_message = result.reason;
			record.status_code = 202;
			return json({ ok: false, reason: result.reason }, 202);
		case "unverified":
			record.resolution_status = "unverified";
			record.signature_status = "invalid";
			record.status_code = 401;
			return error("Invalid signature", 401);
		case "unresolved_connection":
			record.resolution_status = "unresolved_connection";
			record.status_code = 202;
			return json(
				{ ok: false, reason: "no matching user connection", providerUserId: result.providerUserId },
				202,
			);
		case "ok":
			record.resolution_status = "ok";
			record.signature_status = secret ? "verified" : "not_required";
			record.status_code = 201;
			await db
				.update(webhooks)
				.set({
					last_invoked_at: new Date(),
					invocation_count: sql`${webhooks.invocation_count} + 1`,
				})
				.where(eq(webhooks.id, webhook.id));
			return json(
				{
					ok: true,
					threadId: result.threadId,
					created: result.created,
					event: { kind: result.event.kind, externalTaskId: result.event.externalTaskId },
				},
				201,
			);
	}
}
