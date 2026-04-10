import type {
	APIGatewayProxyEventV2,
	APIGatewayProxyStructuredResultV2,
} from "aws-lambda";
import { eq, and, desc, gte, lte } from "drizzle-orm";
import { schema } from "@thinkwork/database-pg";
import { db } from "../lib/db.js";
import { extractBearerToken, validateApiSecret } from "../lib/auth.js";
import { handleCors, json, error, unauthorized } from "../lib/response.js";

const { activityLog } = schema;

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
		if (path === "/api/activity") {
			if (method === "GET") return listActivity(tenantId, event);
			if (method === "POST") return createActivity(tenantId, event);
			return error("Method not allowed", 405);
		}

		return error("Route not found", 404);
	} catch (err) {
		console.error("Activity handler error:", err);
		return error("Internal server error", 500);
	}
}

// ---------------------------------------------------------------------------
// GET /api/activity
// ---------------------------------------------------------------------------

async function listActivity(
	tenantId: string,
	event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyStructuredResultV2> {
	const params = event.queryStringParameters || {};
	const conditions = [eq(activityLog.tenant_id, tenantId)];

	if (params.actor_type) {
		conditions.push(eq(activityLog.actor_type, params.actor_type));
	}
	if (params.action) {
		conditions.push(eq(activityLog.action, params.action));
	}
	if (params.entity_type) {
		conditions.push(eq(activityLog.entity_type, params.entity_type));
	}
	if (params.from) {
		conditions.push(gte(activityLog.created_at, new Date(params.from)));
	}
	if (params.to) {
		conditions.push(lte(activityLog.created_at, new Date(params.to)));
	}

	const rows = await db
		.select()
		.from(activityLog)
		.where(and(...conditions))
		.orderBy(desc(activityLog.created_at));

	return json(rows);
}

// ---------------------------------------------------------------------------
// POST /api/activity
// ---------------------------------------------------------------------------

async function createActivity(
	tenantId: string,
	event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyStructuredResultV2> {
	const body = JSON.parse(event.body || "{}");

	if (!body.action) return error("action is required");
	if (!body.actor_type) return error("actor_type is required");
	if (!body.actor_id) return error("actor_id is required");

	const [entry] = await db
		.insert(activityLog)
		.values({
			tenant_id: tenantId,
			actor_type: body.actor_type,
			actor_id: body.actor_id,
			action: body.action,
			entity_type: body.entity_type,
			entity_id: body.entity_id,
			changes: body.changes,
			metadata: body.metadata,
			ip_address:
				event.requestContext.http.sourceIp || body.ip_address,
		})
		.returning();

	return json(entry, 201);
}
