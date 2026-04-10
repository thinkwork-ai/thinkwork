import type {
	APIGatewayProxyEventV2,
	APIGatewayProxyStructuredResultV2,
} from "aws-lambda";
import { eq, and, desc, gte, lte, sql } from "drizzle-orm";
import { schema } from "@thinkwork/database-pg";
import { db } from "../lib/db.js";
import { extractBearerToken, validateApiSecret } from "../lib/auth.js";
import { json, error, unauthorized } from "../lib/response.js";

const { usageRecords } = schema;

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export async function handler(
	event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyStructuredResultV2> {
	const token = extractBearerToken(event);
	if (!token || !validateApiSecret(token)) return unauthorized();

	const tenantId = event.headers["x-tenant-id"];
	if (!tenantId) return error("Missing x-tenant-id header");

	const method = event.requestContext.http.method;
	const path = event.rawPath;

	try {
		if (path === "/api/usage/summary" && method === "GET") {
			return getUsageSummary(tenantId, event);
		}

		if (path === "/api/usage") {
			if (method === "GET") return listUsage(tenantId, event);
			if (method === "POST") return createUsage(tenantId, event);
			return error("Method not allowed", 405);
		}

		return error("Route not found", 404);
	} catch (err) {
		console.error("Usage handler error:", err);
		return error("Internal server error", 500);
	}
}

// ---------------------------------------------------------------------------
// GET /api/usage
// ---------------------------------------------------------------------------

async function listUsage(
	tenantId: string,
	event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyStructuredResultV2> {
	const params = event.queryStringParameters || {};
	const conditions = [eq(usageRecords.tenant_id, tenantId)];

	if (params.agent_id) {
		conditions.push(eq(usageRecords.agent_id, params.agent_id));
	}
	if (params.model) {
		conditions.push(eq(usageRecords.model, params.model));
	}
	if (params.from) {
		conditions.push(gte(usageRecords.created_at, new Date(params.from)));
	}
	if (params.to) {
		conditions.push(lte(usageRecords.created_at, new Date(params.to)));
	}

	const rows = await db
		.select()
		.from(usageRecords)
		.where(and(...conditions))
		.orderBy(desc(usageRecords.created_at));

	return json(rows);
}

// ---------------------------------------------------------------------------
// GET /api/usage/summary
// ---------------------------------------------------------------------------

async function getUsageSummary(
	tenantId: string,
	event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyStructuredResultV2> {
	const params = event.queryStringParameters || {};
	const conditions = [eq(usageRecords.tenant_id, tenantId)];

	if (params.from) {
		conditions.push(gte(usageRecords.created_at, new Date(params.from)));
	}
	if (params.to) {
		conditions.push(lte(usageRecords.created_at, new Date(params.to)));
	}

	const [summary] = await db
		.select({
			total_input_tokens: sql<number>`coalesce(sum(${usageRecords.input_tokens}), 0)::int`,
			total_output_tokens: sql<number>`coalesce(sum(${usageRecords.output_tokens}), 0)::int`,
			total_tokens: sql<number>`coalesce(sum(${usageRecords.input_tokens} + ${usageRecords.output_tokens}), 0)::int`,
			total_cost_cents: sql<number>`coalesce(sum(${usageRecords.cost_cents}), 0)::int`,
			record_count: sql<number>`count(*)::int`,
		})
		.from(usageRecords)
		.where(and(...conditions));

	return json(summary);
}

// ---------------------------------------------------------------------------
// POST /api/usage
// ---------------------------------------------------------------------------

async function createUsage(
	tenantId: string,
	event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyStructuredResultV2> {
	const body = JSON.parse(event.body || "{}");

	if (!body.model) return error("model is required");
	if (!body.provider) return error("provider is required");
	if (body.input_tokens == null) return error("input_tokens is required");
	if (body.output_tokens == null) return error("output_tokens is required");
	if (body.cost_cents == null) return error("cost_cents is required");

	const [record] = await db
		.insert(usageRecords)
		.values({
			tenant_id: tenantId,
			model: body.model,
			provider: body.provider,
			input_tokens: body.input_tokens,
			output_tokens: body.output_tokens,
			cost_cents: body.cost_cents,
			request_type: body.request_type,
			agent_id: body.agent_id,
			thread_id: body.thread_id,
			metadata: body.metadata,
		})
		.returning();

	return json(record, 201);
}
