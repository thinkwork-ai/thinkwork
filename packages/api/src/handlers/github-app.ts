import type {
	APIGatewayProxyEventV2,
	APIGatewayProxyStructuredResultV2,
} from "aws-lambda";
import { eq, desc } from "drizzle-orm";
import {
	githubAppInstallations,
	githubWebhookDeliveries,
} from "@thinkwork/database-pg/schema";
import { db } from "../lib/db.js";
import { extractBearerToken, validateApiSecret } from "../lib/auth.js";
import { json, error, notFound, unauthorized } from "../lib/response.js";

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export async function handler(
	event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyStructuredResultV2> {
	const token = extractBearerToken(event);
	if (!token || !validateApiSecret(token)) return unauthorized();

	const method = event.requestContext.http.method;
	const path = event.rawPath;

	try {
		// /api/github-app/installations
		if (path === "/api/github-app/installations") {
			if (method === "GET") return listInstallations(event);
			return error("Method not allowed", 405);
		}

		// /api/github-app/webhook-deliveries
		if (path === "/api/github-app/webhook-deliveries") {
			if (method === "GET") return listDeliveries(event);
			if (method === "POST") return logDelivery(event);
			return error("Method not allowed", 405);
		}

		return notFound("Route not found");
	} catch (err) {
		console.error("GitHub App handler error:", err);
		return error("Internal server error", 500);
	}
}

// ---------------------------------------------------------------------------
// Installations
// ---------------------------------------------------------------------------

async function listInstallations(
	event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyStructuredResultV2> {
	const tenantId =
		event.headers["x-tenant-id"] ||
		event.queryStringParameters?.tenantId;
	if (!tenantId) return error("tenantId is required");

	const rows = await db
		.select()
		.from(githubAppInstallations)
		.where(eq(githubAppInstallations.tenant_id, tenantId))
		.orderBy(desc(githubAppInstallations.created_at));

	return json(rows);
}

// ---------------------------------------------------------------------------
// Webhook Deliveries
// ---------------------------------------------------------------------------

async function listDeliveries(
	event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyStructuredResultV2> {
	const tenantId =
		event.headers["x-tenant-id"] ||
		event.queryStringParameters?.tenantId;
	if (!tenantId) return error("tenantId is required");

	const rows = await db
		.select()
		.from(githubWebhookDeliveries)
		.where(eq(githubWebhookDeliveries.tenant_id, tenantId))
		.orderBy(desc(githubWebhookDeliveries.created_at));

	return json(rows);
}

async function logDelivery(
	event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyStructuredResultV2> {
	const body = JSON.parse(event.body || "{}");
	if (!body.tenant_id) return error("tenant_id is required");
	if (!body.event_type) return error("event_type is required");

	const [delivery] = await db
		.insert(githubWebhookDeliveries)
		.values({
			tenant_id: body.tenant_id,
			event_type: body.event_type,
			delivery_id: body.delivery_id,
			payload: body.payload,
			status: body.status || "pending",
		})
		.returning();

	return json(delivery, 201);
}
