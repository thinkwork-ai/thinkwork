import type {
	APIGatewayProxyEventV2,
	APIGatewayProxyStructuredResultV2,
} from "aws-lambda";
import { eq, and } from "drizzle-orm";
import { getDb } from "@thinkwork/database-pg";
import {
	hiveAgents,
	hiveUsers,
} from "@thinkwork/database-pg/schema";
import { extractBearerToken, validateApiSecret } from "../lib/auth.js";
import { json, error, notFound, unauthorized } from "../lib/response.js";

const db = getDb();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parsePath(rawPath: string) {
	// Expected shapes:
	//   /api/hives/:id/agents
	//   /api/hives/:id/agents/:subId
	//   /api/hives/:id/users
	//   /api/hives/:id/users/:subId
	const segments = rawPath
		.replace(/^\/api\/hives\/?/, "")
		.split("/")
		.filter(Boolean);
	return {
		hiveId: segments[0] || null,
		sub: segments[1] || null, // "agents" | "users"
		subId: segments[2] || null,
	};
}

function parseBody(event: APIGatewayProxyEventV2): Record<string, unknown> {
	if (!event.body) return {};
	try {
		return JSON.parse(event.body);
	} catch {
		return {};
	}
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export async function handler(
	event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyStructuredResultV2> {
	const token = extractBearerToken(event);
	if (!token || !validateApiSecret(token)) return unauthorized();

	const tenantId = event.headers["x-tenant-id"];
	if (!tenantId) return error("Missing x-tenant-id header");

	const method = event.requestContext.http.method;
	const { hiveId, sub, subId } = parsePath(event.rawPath);

	if (!hiveId) return error("Missing hive ID");

	try {
		switch (sub) {
			case "agents":
				return handleAgents(method, tenantId, hiveId, subId, event);
			case "users":
				return handleUsers(method, tenantId, hiveId, subId, event);
			default:
				return notFound("Route not found");
		}
	} catch (err: any) {
		console.error("hive-team handler error", err);
		return error(err.message ?? "Internal server error", 500);
	}
}

// ---------------------------------------------------------------------------
// Agents sub-resource
// ---------------------------------------------------------------------------

async function handleAgents(
	method: string,
	tenantId: string,
	hiveId: string,
	subId: string | null,
	event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyStructuredResultV2> {
	switch (method) {
		case "GET": {
			const rows = await db
				.select()
				.from(hiveAgents)
				.where(
					and(
						eq(hiveAgents.hive_id, hiveId),
						eq(hiveAgents.tenant_id, tenantId),
					),
				);
			return json(rows);
		}
		case "POST": {
			const body = parseBody(event);
			if (!body.agent_id) return error("agent_id is required");
			const [row] = await db
				.insert(hiveAgents)
				.values({
					hive_id: hiveId,
					agent_id: body.agent_id as string,
					tenant_id: tenantId,
					role: (body.role as string) ?? "member",
					joined_at: new Date(),
				})
				.returning();
			return json(row, 201);
		}
		case "PUT": {
			if (!subId) return error("Missing agent ID");
			const body = parseBody(event);
			if (!body.role) return error("role is required");
			const [row] = await db
				.update(hiveAgents)
				.set({ role: body.role as string })
				.where(
					and(
						eq(hiveAgents.agent_id, subId),
						eq(hiveAgents.hive_id, hiveId),
						eq(hiveAgents.tenant_id, tenantId),
					),
				)
				.returning();
			if (!row) return notFound("Hive agent not found");
			return json(row);
		}
		case "DELETE": {
			if (!subId) return error("Missing agent ID");
			const [row] = await db
				.delete(hiveAgents)
				.where(
					and(
						eq(hiveAgents.agent_id, subId),
						eq(hiveAgents.hive_id, hiveId),
						eq(hiveAgents.tenant_id, tenantId),
					),
				)
				.returning();
			if (!row) return notFound("Hive agent not found");
			return json(row);
		}
		default:
			return error("Method not allowed", 405);
	}
}

// ---------------------------------------------------------------------------
// Users sub-resource
// ---------------------------------------------------------------------------

async function handleUsers(
	method: string,
	tenantId: string,
	hiveId: string,
	subId: string | null,
	event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyStructuredResultV2> {
	switch (method) {
		case "GET": {
			const rows = await db
				.select()
				.from(hiveUsers)
				.where(
					and(
						eq(hiveUsers.hive_id, hiveId),
						eq(hiveUsers.tenant_id, tenantId),
					),
				);
			return json(rows);
		}
		case "POST": {
			const body = parseBody(event);
			if (!body.user_id) return error("user_id is required");
			const [row] = await db
				.insert(hiveUsers)
				.values({
					hive_id: hiveId,
					user_id: body.user_id as string,
					tenant_id: tenantId,
					role: (body.role as string) ?? "member",
					joined_at: new Date(),
				})
				.returning();
			return json(row, 201);
		}
		case "PUT": {
			if (!subId) return error("Missing user ID");
			const body = parseBody(event);
			if (!body.role) return error("role is required");
			const [row] = await db
				.update(hiveUsers)
				.set({ role: body.role as string })
				.where(
					and(
						eq(hiveUsers.user_id, subId),
						eq(hiveUsers.hive_id, hiveId),
						eq(hiveUsers.tenant_id, tenantId),
					),
				)
				.returning();
			if (!row) return notFound("Hive user not found");
			return json(row);
		}
		case "DELETE": {
			if (!subId) return error("Missing user ID");
			const [row] = await db
				.delete(hiveUsers)
				.where(
					and(
						eq(hiveUsers.user_id, subId),
						eq(hiveUsers.hive_id, hiveId),
						eq(hiveUsers.tenant_id, tenantId),
					),
				)
				.returning();
			if (!row) return notFound("Hive user not found");
			return json(row);
		}
		default:
			return error("Method not allowed", 405);
	}
}
