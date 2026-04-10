import type {
	APIGatewayProxyEventV2,
	APIGatewayProxyStructuredResultV2,
} from "aws-lambda";
import { eq, and } from "drizzle-orm";
import { schema } from "@thinkwork/database-pg";
import { db } from "../lib/db.js";
import { extractBearerToken, validateApiSecret } from "../lib/auth.js";
import { handleCors, json, error, notFound, unauthorized } from "../lib/response.js";

const { agents, agentCapabilities, agentSkills } = schema;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parsePath(rawPath: string) {
	// Expected shapes:
	//   /api/agents
	//   /api/agents/:id
	//   /api/agents/:id/capabilities
	//   /api/agents/:id/capabilities/:capId
	//   /api/agents/:id/skills
	//   /api/agents/:id/skills/:skillId
	const segments = rawPath
		.replace(/^\/api\/agents\/?/, "")
		.split("/")
		.filter(Boolean);
	return {
		id: segments[0] || null,
		sub: segments[1] || null, // "capabilities" | "skills"
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
// Router
// ---------------------------------------------------------------------------

export async function handler(
	event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyStructuredResultV2> {
	if (event.requestContext.http.method === "OPTIONS") return { statusCode: 204, headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "*", "Access-Control-Allow-Headers": "*" }, body: "" };
	const token = extractBearerToken(event);
	if (!token || !validateApiSecret(token)) return unauthorized();

	const tenantId = event.headers["x-tenant-id"];
	if (!tenantId) return error("Missing x-tenant-id header");

	const method = event.requestContext.http.method;
	const { id, sub, subId } = parsePath(event.rawPath);

	try {
		// ----- Sub-resource: capabilities -----
		if (sub === "capabilities") {
			if (!id) return error("Missing agent ID");
			return handleCapabilities(method, tenantId, id, subId, event);
		}

		// ----- Sub-resource: skills -----
		if (sub === "skills") {
			if (!id) return error("Missing agent ID");
			return handleSkills(method, tenantId, id, subId, event);
		}

		// ----- Root: agents CRUD -----
		switch (method) {
			case "GET":
				return id ? getAgent(tenantId, id) : listAgents(tenantId);
			case "POST":
				return createAgent(tenantId, event);
			case "PUT":
				if (!id) return error("Missing agent ID");
				return updateAgent(tenantId, id, event);
			case "DELETE":
				if (!id) return error("Missing agent ID");
				return archiveAgent(tenantId, id);
			default:
				return error("Method not allowed", 405);
		}
	} catch (err: any) {
		console.error("Agents handler error:", err);
		return error("Internal server error", 500);
	}
}

// ---------------------------------------------------------------------------
// Agents CRUD
// ---------------------------------------------------------------------------

async function listAgents(tenantId: string) {
	const rows = await db
		.select()
		.from(agents)
		.where(eq(agents.tenant_id, tenantId));
	return json(rows);
}

async function getAgent(tenantId: string, id: string) {
	const [row] = await db
		.select()
		.from(agents)
		.where(and(eq(agents.id, id), eq(agents.tenant_id, tenantId)));
	if (!row) return notFound("Agent not found");
	return json(row);
}

async function createAgent(
	tenantId: string,
	event: APIGatewayProxyEventV2,
) {
	const body = parseBody(event);
	if (!body.name) return error("name is required");
	if (!body.template_id) return error("template_id is required");

	const [row] = await db
		.insert(agents)
		.values({
			tenant_id: tenantId,
			name: body.name as string,
			template_id: body.template_id as string,
			role: body.role as string | undefined,
			type: (body.type as string) ?? "agent",
			system_prompt: body.system_prompt as string | undefined,
			adapter_type: (body.adapter_type as string) || "sdk",
			adapter_config: body.adapter_config ?? undefined,
			runtime_config: body.runtime_config ?? undefined,
		})
		.returning();
	return json(row, 201);
}

async function updateAgent(
	tenantId: string,
	id: string,
	event: APIGatewayProxyEventV2,
) {
	const body = parseBody(event);

	const updates: Record<string, unknown> = { updated_at: new Date() };
	const allowedFields = [
		"name",
		"role",
		"type",
		"model",
		"system_prompt",
		"adapter_type",
		"adapter_config",
		"runtime_config",
		"status",
		"budget_monthly_cents",
		"avatar_url",
		"reports_to",
		"human_pair_id",
	];
	for (const f of allowedFields) {
		if (f in body) updates[f] = body[f];
	}

	if (Object.keys(updates).length === 1) {
		return error("No valid fields to update");
	}

	const [row] = await db
		.update(agents)
		.set(updates)
		.where(and(eq(agents.id, id), eq(agents.tenant_id, tenantId)))
		.returning();
	if (!row) return notFound("Agent not found");
	return json(row);
}

async function archiveAgent(tenantId: string, id: string) {
	const [row] = await db
		.update(agents)
		.set({ status: "archived", updated_at: new Date() })
		.where(and(eq(agents.id, id), eq(agents.tenant_id, tenantId)))
		.returning();
	if (!row) return notFound("Agent not found");
	return json(row);
}

// ---------------------------------------------------------------------------
// Capabilities sub-resource
// ---------------------------------------------------------------------------

async function handleCapabilities(
	method: string,
	tenantId: string,
	agentId: string,
	capId: string | null,
	event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyStructuredResultV2> {
	switch (method) {
		case "GET": {
			const rows = await db
				.select()
				.from(agentCapabilities)
				.where(
					and(
						eq(agentCapabilities.agent_id, agentId),
						eq(agentCapabilities.tenant_id, tenantId),
					),
				);
			return json(rows);
		}
		case "POST": {
			const body = parseBody(event);
			if (!body.capability) return error("capability is required");

			const [row] = await db
				.insert(agentCapabilities)
				.values({
					agent_id: agentId,
					tenant_id: tenantId,
					capability: body.capability as string,
					config: body.config ?? undefined,
					enabled:
						body.enabled !== undefined ? (body.enabled as boolean) : true,
				})
				.returning();
			return json(row, 201);
		}
		case "DELETE": {
			if (!capId) return error("Missing capability ID");
			const [row] = await db
				.delete(agentCapabilities)
				.where(
					and(
						eq(agentCapabilities.id, capId),
						eq(agentCapabilities.agent_id, agentId),
						eq(agentCapabilities.tenant_id, tenantId),
					),
				)
				.returning();
			if (!row) return notFound("Capability not found");
			return json(row);
		}
		default:
			return error("Method not allowed", 405);
	}
}

// ---------------------------------------------------------------------------
// Skills sub-resource
// ---------------------------------------------------------------------------

async function handleSkills(
	method: string,
	tenantId: string,
	agentId: string,
	skillId: string | null,
	event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyStructuredResultV2> {
	switch (method) {
		case "GET": {
			const rows = await db
				.select()
				.from(agentSkills)
				.where(
					and(
						eq(agentSkills.agent_id, agentId),
						eq(agentSkills.tenant_id, tenantId),
					),
				);
			return json(rows);
		}
		case "POST": {
			const body = parseBody(event);
			if (!body.skill_id) return error("skill_id is required");

			const [row] = await db
				.insert(agentSkills)
				.values({
					agent_id: agentId,
					tenant_id: tenantId,
					skill_id: body.skill_id as string,
					config: body.config ?? undefined,
					permissions: body.permissions ?? undefined,
					rate_limit_rpm: body.rate_limit_rpm as number | undefined,
					enabled:
						body.enabled !== undefined ? (body.enabled as boolean) : true,
				})
				.returning();
			return json(row, 201);
		}
		case "DELETE": {
			if (!skillId) return error("Missing skill ID");
			const [row] = await db
				.delete(agentSkills)
				.where(
					and(
						eq(agentSkills.id, skillId),
						eq(agentSkills.agent_id, agentId),
						eq(agentSkills.tenant_id, tenantId),
					),
				)
				.returning();
			if (!row) return notFound("Skill not found");
			return json(row);
		}
		default:
			return error("Method not allowed", 405);
	}
}
