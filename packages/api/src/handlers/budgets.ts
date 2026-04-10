import type {
	APIGatewayProxyEventV2,
	APIGatewayProxyStructuredResultV2,
} from "aws-lambda";
import { eq, and, sql } from "drizzle-orm";
import { schema } from "@thinkwork/database-pg";
import { db } from "../lib/db.js";
import { extractBearerToken, validateApiSecret } from "../lib/auth.js";
import { handleCors, json, error, notFound, unauthorized } from "../lib/response.js";

const { agents, budgetPolicies, tenantSettings } = schema;

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
	const path = event.rawPath;

	try {
		// GET /api/budgets/tenant
		if (path === "/api/budgets/tenant" && method === "GET") {
			return getTenantBudget(tenantId);
		}

		// GET /api/budgets/agents/:id
		const agentMatch = path.match(
			/^\/api\/budgets\/agents\/([^/]+)$/,
		);
		if (agentMatch && method === "GET") {
			return getAgentBudget(tenantId, agentMatch[1]);
		}

		return error("Route not found", 404);
	} catch (err) {
		console.error("Budgets handler error:", err);
		return error("Internal server error", 500);
	}
}

// ---------------------------------------------------------------------------
// GET /api/budgets/agents/:id
// ---------------------------------------------------------------------------

async function getAgentBudget(
	tenantId: string,
	agentId: string,
): Promise<APIGatewayProxyStructuredResultV2> {
	const [agent] = await db
		.select({
			id: agents.id,
			name: agents.name,
			budget_monthly_cents: agents.budget_monthly_cents,
			spent_monthly_cents: agents.spent_monthly_cents,
		})
		.from(agents)
		.where(
			and(
				eq(agents.id, agentId),
				eq(agents.tenant_id, tenantId),
			),
		);

	if (!agent) return notFound("Agent not found");

	const policies = await db
		.select()
		.from(budgetPolicies)
		.where(
			and(
				eq(budgetPolicies.agent_id, agentId),
				eq(budgetPolicies.tenant_id, tenantId),
				eq(budgetPolicies.scope, "agent"),
			),
		);

	return json({
		agent_id: agent.id,
		name: agent.name,
		monthly_cents: agent.budget_monthly_cents,
		spent: agent.spent_monthly_cents,
		policies,
	});
}

// ---------------------------------------------------------------------------
// GET /api/budgets/tenant
// ---------------------------------------------------------------------------

async function getTenantBudget(
	tenantId: string,
): Promise<APIGatewayProxyStructuredResultV2> {
	const [settings] = await db
		.select({
			budget_monthly_cents: tenantSettings.budget_monthly_cents,
		})
		.from(tenantSettings)
		.where(eq(tenantSettings.tenant_id, tenantId));

	const [spentAgg] = await db
		.select({
			total_spent: sql<number>`coalesce(sum(${agents.spent_monthly_cents}), 0)::int`,
			agent_count: sql<number>`count(*)::int`,
		})
		.from(agents)
		.where(eq(agents.tenant_id, tenantId));

	return json({
		tenant_id: tenantId,
		budget_monthly_cents: settings?.budget_monthly_cents ?? null,
		total_spent_cents: spentAgg.total_spent,
		agent_count: spentAgg.agent_count,
	});
}
