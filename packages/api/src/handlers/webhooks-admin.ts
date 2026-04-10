/**
 * Webhook Admin REST Handler — PRD-19
 *
 * Bearer-auth protected CRUD for managing webhook definitions.
 *
 * Routes:
 *   GET    /api/webhooks                       — List webhooks
 *   POST   /api/webhooks                       — Create webhook
 *   GET    /api/webhooks/:id                   — Get webhook detail
 *   PUT    /api/webhooks/:id                   — Update webhook
 *   DELETE /api/webhooks/:id                   — Delete webhook
 *   POST   /api/webhooks/:id/regenerate-token  — Regenerate token
 *   POST   /api/webhooks/:id/test              — Fire a test invocation
 *   GET    /api/webhooks/:id/history           — Invocation history
 */

import type {
	APIGatewayProxyEventV2,
	APIGatewayProxyStructuredResultV2,
} from "aws-lambda";
import { randomBytes } from "node:crypto";
import { eq, and, desc, sql } from "drizzle-orm";
import {
	webhooks,
	webhookIdempotency,
	threadTurns,
	agentWakeupRequests,
	agents,
	routines,
} from "@thinkwork/database-pg/schema";
import { db } from "../lib/db.js";
import { extractBearerToken, validateApiSecret } from "../lib/auth.js";
import { handleCors, json, error, notFound, unauthorized } from "../lib/response.js";
import { ensureThreadForWork } from "../lib/thread-helpers.js";

function generateToken(): string {
	return randomBytes(32).toString("base64url");
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export async function handler(
	event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyStructuredResultV2> {
	if (event.requestContext.http.method === "OPTIONS") return { statusCode: 204, headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "*", "Access-Control-Allow-Headers": "*" }, body: "" };
	const token = extractBearerToken(event);
	if (!token || !validateApiSecret(token)) return unauthorized();

	const method = event.requestContext.http.method;
	const path = event.rawPath;

	try {
		// POST /api/webhooks/:id/regenerate-token
		const regenMatch = path.match(
			/^\/api\/webhooks\/([^/]+)\/regenerate-token$/,
		);
		if (regenMatch) {
			if (method === "POST") return regenerateToken(regenMatch[1], event);
			return error("Method not allowed", 405);
		}

		// POST /api/webhooks/:id/test
		const testMatch = path.match(/^\/api\/webhooks\/([^/]+)\/test$/);
		if (testMatch) {
			if (method === "POST") return testWebhook(testMatch[1], event);
			return error("Method not allowed", 405);
		}

		// GET /api/webhooks/:id/history
		const historyMatch = path.match(
			/^\/api\/webhooks\/([^/]+)\/history$/,
		);
		if (historyMatch) {
			if (method === "GET") return getHistory(historyMatch[1], event);
			return error("Method not allowed", 405);
		}

		// GET/PUT/DELETE /api/webhooks/:id
		const idMatch = path.match(/^\/api\/webhooks\/([^/]+)$/);
		if (idMatch) {
			if (method === "GET") return getWebhook(idMatch[1], event);
			if (method === "PUT") return updateWebhook(idMatch[1], event);
			if (method === "DELETE") return deleteWebhook(idMatch[1], event);
			return error("Method not allowed", 405);
		}

		// GET/POST /api/webhooks
		if (path === "/api/webhooks") {
			if (method === "GET") return listWebhooks(event);
			if (method === "POST") return createWebhook(event);
			return error("Method not allowed", 405);
		}

		return notFound("Route not found");
	} catch (err) {
		console.error("Webhook admin handler error:", err);
		return error("Internal server error", 500);
	}
}

// ---------------------------------------------------------------------------
// CRUD
// ---------------------------------------------------------------------------

async function listWebhooks(
	event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyStructuredResultV2> {
	const tenantId = event.headers["x-tenant-id"];
	if (!tenantId) return error("x-tenant-id header is required");

	const conditions = [eq(webhooks.tenant_id, tenantId)];

	const params = event.queryStringParameters || {};
	if (params.target_type)
		conditions.push(eq(webhooks.target_type, params.target_type));
	if (params.enabled !== undefined)
		conditions.push(eq(webhooks.enabled, params.enabled === "true"));

	const rows = await db
		.select({
			id: webhooks.id,
			name: webhooks.name,
			description: webhooks.description,
			token: webhooks.token,
			target_type: webhooks.target_type,
			agent_id: webhooks.agent_id,
			routine_id: webhooks.routine_id,
			enabled: webhooks.enabled,
			rate_limit: webhooks.rate_limit,
			last_invoked_at: webhooks.last_invoked_at,
			invocation_count: webhooks.invocation_count,
			created_at: webhooks.created_at,
			target_name: sql<string | null>`coalesce(${agents.name}, ${routines.name})`.as("target_name"),
		})
		.from(webhooks)
		.leftJoin(agents, eq(webhooks.agent_id, agents.id))
		.leftJoin(routines, eq(webhooks.routine_id, routines.id))
		.where(and(...conditions))
		.orderBy(desc(webhooks.created_at))
		.limit(100);

	return json(rows);
}

async function getWebhook(
	id: string,
	event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyStructuredResultV2> {
	const tenantId = event.headers["x-tenant-id"];
	if (!tenantId) return error("x-tenant-id header is required");

	const [row] = await db
		.select()
		.from(webhooks)
		.where(and(eq(webhooks.id, id), eq(webhooks.tenant_id, tenantId)));
	if (!row) return notFound("Webhook not found");
	return json(row);
}

async function createWebhook(
	event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyStructuredResultV2> {
	const tenantId = event.headers["x-tenant-id"];
	if (!tenantId) return error("x-tenant-id header is required");

	let body: Record<string, unknown> = {};
	try {
		body = event.body ? JSON.parse(event.body) : {};
	} catch {
		return error("Invalid JSON body");
	}

	if (!body.name || !body.target_type) {
		return error("name and target_type are required");
	}

	const targetType = body.target_type as string;
	if (targetType === "agent" && !body.agent_id) {
		return error("agent_id is required when target_type is agent");
	}
	if (targetType === "routine" && !body.routine_id) {
		return error("routine_id is required when target_type is routine");
	}

	const webhookToken = generateToken();

	const [row] = await db
		.insert(webhooks)
		.values({
			tenant_id: tenantId,
			name: body.name as string,
			description: (body.description as string) || null,
			token: webhookToken,
			target_type: targetType,
			agent_id: (body.agent_id as string) || null,
			routine_id: (body.routine_id as string) || null,
			prompt: (body.prompt as string) || null,
			config: (body.config as Record<string, unknown>) || null,
			enabled: true,
			rate_limit: (body.rate_limit as number) || 60,
			created_by_type: (body.created_by_type as string) || "user",
			created_by_id: (body.created_by_id as string) || null,
		})
		.returning();

	return json(row, 201);
}

async function updateWebhook(
	id: string,
	event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyStructuredResultV2> {
	const tenantId = event.headers["x-tenant-id"];
	if (!tenantId) return error("x-tenant-id header is required");

	let body: Record<string, unknown> = {};
	try {
		body = event.body ? JSON.parse(event.body) : {};
	} catch {
		return error("Invalid JSON body");
	}

	const updates: Record<string, unknown> = { updated_at: new Date() };
	if (body.name !== undefined) updates.name = body.name;
	if (body.description !== undefined) updates.description = body.description;
	if (body.target_type !== undefined) updates.target_type = body.target_type;
	if (body.agent_id !== undefined) updates.agent_id = body.agent_id;
	if (body.routine_id !== undefined) updates.routine_id = body.routine_id;
	if (body.prompt !== undefined) updates.prompt = body.prompt;
	if (body.config !== undefined) updates.config = body.config;
	if (body.enabled !== undefined) updates.enabled = body.enabled;
	if (body.rate_limit !== undefined) updates.rate_limit = body.rate_limit;

	const [updated] = await db
		.update(webhooks)
		.set(updates)
		.where(and(eq(webhooks.id, id), eq(webhooks.tenant_id, tenantId)))
		.returning();

	if (!updated) return notFound("Webhook not found");
	return json(updated);
}

async function deleteWebhook(
	id: string,
	event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyStructuredResultV2> {
	const tenantId = event.headers["x-tenant-id"];
	if (!tenantId) return error("x-tenant-id header is required");

	const [existing] = await db
		.select()
		.from(webhooks)
		.where(and(eq(webhooks.id, id), eq(webhooks.tenant_id, tenantId)));
	if (!existing) return notFound("Webhook not found");

	// Null out webhook_id FK in thread_turns before deleting
	await db
		.update(threadTurns)
		.set({ webhook_id: null })
		.where(eq(threadTurns.webhook_id, id));

	// Idempotency records cascade-delete via FK
	await db.delete(webhooks).where(eq(webhooks.id, id));

	return json({ ok: true, id });
}

// ---------------------------------------------------------------------------
// Regenerate Token
// ---------------------------------------------------------------------------

async function regenerateToken(
	id: string,
	event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyStructuredResultV2> {
	const tenantId = event.headers["x-tenant-id"];
	if (!tenantId) return error("x-tenant-id header is required");

	const newToken = generateToken();

	const [updated] = await db
		.update(webhooks)
		.set({ token: newToken, updated_at: new Date() })
		.where(and(eq(webhooks.id, id), eq(webhooks.tenant_id, tenantId)))
		.returning();

	if (!updated) return notFound("Webhook not found");
	return json(updated);
}

// ---------------------------------------------------------------------------
// Test Webhook
// ---------------------------------------------------------------------------

async function testWebhook(
	id: string,
	event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyStructuredResultV2> {
	const tenantId = event.headers["x-tenant-id"];
	if (!tenantId) return error("x-tenant-id header is required");

	const [webhook] = await db
		.select()
		.from(webhooks)
		.where(and(eq(webhooks.id, id), eq(webhooks.tenant_id, tenantId)));
	if (!webhook) return notFound("Webhook not found");

	const testPayload = { _test: true, timestamp: new Date().toISOString() };

	if (webhook.target_type === "agent" && webhook.agent_id) {
		// Create a thread for tracking
		let threadId: string | undefined;
		try {
			const result = await ensureThreadForWork({
				tenantId: webhook.tenant_id,
				agentId: webhook.agent_id,
				title: `Test: ${webhook.name}`,
				channel: "webhook",
			});
			threadId = result.threadId;
		} catch (err) {
			console.warn("[webhooks-admin] Failed to create thread for test:", err);
		}

		// Insert wakeup request — the wakeup processor creates the thread_turn
		const payload: Record<string, unknown> = {
			webhookPayload: testPayload,
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
				trigger_detail: `webhook_test:${webhook.id}`,
				reason: `Test: ${webhook.name}`,
				payload,
				requested_by_actor_type: "user",
			})
			.returning();

		await db
			.update(webhooks)
			.set({
				last_invoked_at: new Date(),
				invocation_count: sql`${webhooks.invocation_count} + 1`,
			})
			.where(eq(webhooks.id, webhook.id));

		return json({ ok: true, wakeupRequestId: wakeup.id }, 201);
	} else if (webhook.target_type === "routine" && webhook.routine_id) {
		const [turn] = await db
			.insert(threadTurns)
			.values({
				tenant_id: webhook.tenant_id,
				routine_id: webhook.routine_id,
				webhook_id: webhook.id,
				invocation_source: "webhook",
				trigger_detail: `webhook_test:${webhook.id}`,
				status: "queued",
				context_snapshot: testPayload,
			})
			.returning();

		await db
			.update(webhooks)
			.set({
				last_invoked_at: new Date(),
				invocation_count: sql`${webhooks.invocation_count} + 1`,
			})
			.where(eq(webhooks.id, webhook.id));

		return json({ ok: true, turnId: turn.id }, 201);
	}

	return error("Webhook has no valid target configured");
}

// ---------------------------------------------------------------------------
// History
// ---------------------------------------------------------------------------

async function getHistory(
	id: string,
	event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyStructuredResultV2> {
	const tenantId = event.headers["x-tenant-id"];
	if (!tenantId) return error("x-tenant-id header is required");

	const params = event.queryStringParameters || {};
	const limit = Math.min(Number(params.limit) || 50, 200);

	const rows = await db
		.select()
		.from(threadTurns)
		.where(
			and(
				eq(threadTurns.webhook_id, id),
				eq(threadTurns.tenant_id, tenantId),
			),
		)
		.orderBy(desc(threadTurns.created_at))
		.limit(limit);

	return json(rows);
}
