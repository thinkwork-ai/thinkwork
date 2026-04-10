/**
 * Webhook Trigger Handler — PRD-19
 *
 * Public endpoint (no bearer auth — the token IS the auth).
 *
 * Routes:
 *   POST /webhooks/:token  — trigger a webhook by token
 */

import type {
	APIGatewayProxyEventV2,
	APIGatewayProxyStructuredResultV2,
} from "aws-lambda";
import { eq, and, sql } from "drizzle-orm";
import {
	webhooks,
	webhookIdempotency,
	threadTurns,
	agentWakeupRequests,
} from "@thinkwork/database-pg/schema";
import { db } from "../lib/db.js";
import { json, error, notFound } from "../lib/response.js";
import { ensureThreadForWork } from "../lib/thread-helpers.js";

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
// Router
// ---------------------------------------------------------------------------

export async function handler(
	event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyStructuredResultV2> {
	const method = event.requestContext.http.method;
	const path = event.rawPath;

	if (method !== "POST") return error("Method not allowed", 405);

	try {
		// POST /webhooks/:token
		const tokenMatch = path.match(/^\/webhooks\/([^/]+)$/);
		if (tokenMatch) {
			return triggerByToken(tokenMatch[1], event);
		}

		return notFound("Route not found");
	} catch (err) {
		console.error("Webhook trigger handler error:", err);
		return error("Internal server error", 500);
	}
}

// ---------------------------------------------------------------------------
// Trigger
// ---------------------------------------------------------------------------

async function triggerByToken(
	token: string,
	event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyStructuredResultV2> {
	// 1. Look up webhook by token (unique indexed column, O(1))
	const [webhook] = await db
		.select()
		.from(webhooks)
		.where(and(eq(webhooks.token, token), eq(webhooks.enabled, true)));

	if (!webhook) return notFound("Webhook not found");

	// 2. Rate limit check
	const limit = webhook.rate_limit ?? 60;
	if (!checkRateLimit(webhook.id, limit)) {
		return {
			statusCode: 429,
			headers: { "Content-Type": "application/json", "Retry-After": "60" },
			body: JSON.stringify({ error: "Rate limit exceeded" }),
		};
	}

	// 3. Idempotency check
	const idempotencyKey = event.headers["x-idempotency-key"];
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
			return json({ ok: true, turnId: existing.turn_id, deduplicated: true });
		}
	}

	// 4. Parse body
	let body: Record<string, unknown> = {};
	try {
		body = event.body ? JSON.parse(event.body) : {};
	} catch {
		return error("Invalid JSON body");
	}

	// 5. Dispatch based on target type

	if (webhook.target_type === "agent" && webhook.agent_id) {
		// Create a thread to track this webhook execution
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

		// Insert wakeup request — the wakeup processor creates the thread_turn
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

		// Record idempotency key against wakeup request
		if (idempotencyKey) {
			await db.insert(webhookIdempotency).values({
				webhook_id: webhook.id,
				idempotency_key: idempotencyKey,
				turn_id: wakeup.id,
			});
		}

		// Update webhook stats
		await db
			.update(webhooks)
			.set({
				last_invoked_at: new Date(),
				invocation_count: sql`${webhooks.invocation_count} + 1`,
			})
			.where(eq(webhooks.id, webhook.id));

		return json({ ok: true, wakeupRequestId: wakeup.id }, 201);
	} else if (webhook.target_type === "routine" && webhook.routine_id) {
		// Routines still get a thread_turn directly (no wakeup queue)
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

		return json({ ok: true, turnId: turn.id }, 201);
	} else {
		return error("Webhook has no valid target configured");
	}
}
