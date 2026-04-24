import type {
	APIGatewayProxyEventV2,
	APIGatewayProxyStructuredResultV2,
} from "aws-lambda";
import { eq, and } from "drizzle-orm";
import { getDb } from "@thinkwork/database-pg";
import {
	teamAgents,
	teamUsers,
} from "@thinkwork/database-pg/schema";
import { requireTenantMembership } from "../lib/tenant-membership.js";
import { handleCors, json, error, notFound } from "../lib/response.js";

const db = getDb();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parsePath(rawPath: string) {
	// Expected shapes:
	//   /api/teams/:id/agents
	//   /api/teams/:id/agents/:subId
	//   /api/teams/:id/users
	//   /api/teams/:id/users/:subId
	const segments = rawPath
		.replace(/^\/api\/teams\/?/, "")
		.split("/")
		.filter(Boolean);
	return {
		teamId: segments[0] || null,
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
	if (event.requestContext.http.method === "OPTIONS") return { statusCode: 204, headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "*", "Access-Control-Allow-Headers": "*" }, body: "" };

	const tenantHeader = event.headers["x-tenant-id"];
	if (!tenantHeader) return error("Missing x-tenant-id header");

	const method = event.requestContext.http.method;
	const { teamId, sub, subId } = parsePath(event.rawPath);

	if (!teamId) return error("Missing team ID");

	const verdict = await requireTenantMembership(event, tenantHeader, {
		requiredRoles: method === "GET" ? ["owner", "admin", "member"] : ["owner", "admin"],
	});
	if (!verdict.ok) return error(verdict.reason, verdict.status);
	const tenantId = verdict.tenantId;

	try {
		switch (sub) {
			case "agents":
				return handleAgents(method, tenantId, teamId, subId, event);
			case "users":
				return handleUsers(method, tenantId, teamId, subId, event);
			default:
				return notFound("Route not found");
		}
	} catch (err: any) {
		console.error("team-members handler error", err);
		return error(err.message ?? "Internal server error", 500);
	}
}

// ---------------------------------------------------------------------------
// Agents sub-resource
// ---------------------------------------------------------------------------

async function handleAgents(
	method: string,
	tenantId: string,
	teamId: string,
	subId: string | null,
	event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyStructuredResultV2> {
	switch (method) {
		case "GET": {
			const rows = await db
				.select()
				.from(teamAgents)
				.where(
					and(
						eq(teamAgents.team_id, teamId),
						eq(teamAgents.tenant_id, tenantId),
					),
				);
			return json(rows);
		}
		case "POST": {
			const body = parseBody(event);
			if (!body.agent_id) return error("agent_id is required");
			const [row] = await db
				.insert(teamAgents)
				.values({
					team_id: teamId,
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
				.update(teamAgents)
				.set({ role: body.role as string })
				.where(
					and(
						eq(teamAgents.agent_id, subId),
						eq(teamAgents.team_id, teamId),
						eq(teamAgents.tenant_id, tenantId),
					),
				)
				.returning();
			if (!row) return notFound("Team agent not found");
			return json(row);
		}
		case "DELETE": {
			if (!subId) return error("Missing agent ID");
			const [row] = await db
				.delete(teamAgents)
				.where(
					and(
						eq(teamAgents.agent_id, subId),
						eq(teamAgents.team_id, teamId),
						eq(teamAgents.tenant_id, tenantId),
					),
				)
				.returning();
			if (!row) return notFound("Team agent not found");
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
	teamId: string,
	subId: string | null,
	event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyStructuredResultV2> {
	switch (method) {
		case "GET": {
			const rows = await db
				.select()
				.from(teamUsers)
				.where(
					and(
						eq(teamUsers.team_id, teamId),
						eq(teamUsers.tenant_id, tenantId),
					),
				);
			return json(rows);
		}
		case "POST": {
			const body = parseBody(event);
			if (!body.user_id) return error("user_id is required");
			const [row] = await db
				.insert(teamUsers)
				.values({
					team_id: teamId,
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
				.update(teamUsers)
				.set({ role: body.role as string })
				.where(
					and(
						eq(teamUsers.user_id, subId),
						eq(teamUsers.team_id, teamId),
						eq(teamUsers.tenant_id, tenantId),
					),
				)
				.returning();
			if (!row) return notFound("Team user not found");
			return json(row);
		}
		case "DELETE": {
			if (!subId) return error("Missing user ID");
			const [row] = await db
				.delete(teamUsers)
				.where(
					and(
						eq(teamUsers.user_id, subId),
						eq(teamUsers.team_id, teamId),
						eq(teamUsers.tenant_id, tenantId),
					),
				)
				.returning();
			if (!row) return notFound("Team user not found");
			return json(row);
		}
		default:
			return error("Method not allowed", 405);
	}
}
