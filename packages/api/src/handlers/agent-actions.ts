import type {
	APIGatewayProxyEventV2,
	APIGatewayProxyStructuredResultV2,
} from "aws-lambda";
import { eq, and, sql } from "drizzle-orm";
import { schema } from "@thinkwork/database-pg";
import { db } from "../lib/db.js";
import { authenticate } from "../lib/cognito-auth.js";
import { handleCors, json, error, notFound, unauthorized } from "../lib/response.js";

const { agents, budgetPolicies, agentWakeupRequests } = schema;

const JOB_SCHEDULE_API_URL = process.env.JOB_SCHEDULE_API_URL || "";
const API_AUTH_SECRET = process.env.API_AUTH_SECRET || "";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseAction(rawPath: string) {
	// Expected shapes:
	//   /api/agents/:id/start
	//   /api/agents/:id/stop
	//   /api/agents/:id/heartbeat
	//   /api/agents/:id/budget/reset
	//   /api/agents/:id/budget
	//   /api/agents/:id/productivity-config
	const segments = rawPath
		.replace(/^\/api\/agents\/?/, "")
		.split("/")
		.filter(Boolean);
	return {
		id: segments[0] || null,
		action: segments[1] || null, // "start" | "stop" | "heartbeat" | "budget"
		subAction: segments[2] || null, // "reset" (for budget/reset)
	};
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export async function handler(
	event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyStructuredResultV2> {
	if (event.requestContext.http.method === "OPTIONS") return { statusCode: 204, headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "*", "Access-Control-Allow-Headers": "*" }, body: "" };
	const auth = await authenticate(event.headers);
	if (!auth) return unauthorized();

	const tenantId = event.headers["x-tenant-id"];
	if (!tenantId) return error("Missing x-tenant-id header");

	const method = event.requestContext.http.method;
	const { id, action, subAction } = parseAction(event.rawPath);

	if (!id) return error("Missing agent ID");

	try {
		switch (action) {
			case "start":
				if (method !== "POST") return error("Method not allowed", 405);
				return startAgent(tenantId, id);

			case "stop":
				if (method !== "POST") return error("Method not allowed", 405);
				return stopAgent(tenantId, id);

			case "heartbeat":
				if (method !== "POST") return error("Method not allowed", 405);
				return heartbeat(tenantId, id);

			case "budget":
				if (subAction === "reset" && method === "POST") {
					return resetBudget(tenantId, id);
				}
				if (method === "GET") {
					return getBudget(tenantId, id);
				}
				return error("Method not allowed", 405);

			case "productivity-config":
				if (method !== "POST") return error("Method not allowed", 405);
				return updateProductivityConfig(tenantId, id, event);

			default:
				return error("Unknown action", 400);
		}
	} catch (err: any) {
		console.error("Agent-actions handler error:", err);
		return error("Internal server error", 500);
	}
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

async function startAgent(tenantId: string, id: string) {
	const [row] = await db
		.update(agents)
		.set({
			status: "busy",
			last_heartbeat_at: new Date(),
			updated_at: new Date(),
		})
		.where(and(eq(agents.id, id), eq(agents.tenant_id, tenantId)))
		.returning();
	if (!row) return notFound("Agent not found");
	return json(row);
}

async function stopAgent(tenantId: string, id: string) {
	const [row] = await db
		.update(agents)
		.set({
			status: "idle",
			updated_at: new Date(),
		})
		.where(and(eq(agents.id, id), eq(agents.tenant_id, tenantId)))
		.returning();
	if (!row) return notFound("Agent not found");
	return json(row);
}

async function heartbeat(tenantId: string, id: string) {
	const [row] = await db
		.update(agents)
		.set({
			last_heartbeat_at: new Date(),
			updated_at: new Date(),
		})
		.where(and(eq(agents.id, id), eq(agents.tenant_id, tenantId)))
		.returning();
	if (!row) return notFound("Agent not found");
	return json(row);
}

async function resetBudget(tenantId: string, id: string) {
	const [row] = await db
		.update(agents)
		.set({
			spent_monthly_cents: 0,
			updated_at: new Date(),
		})
		.where(and(eq(agents.id, id), eq(agents.tenant_id, tenantId)))
		.returning();
	if (!row) return notFound("Agent not found");
	return json(row);
}

async function getBudget(tenantId: string, id: string) {
	const [agent] = await db
		.select({
			budget_monthly_cents: agents.budget_monthly_cents,
			spent_monthly_cents: agents.spent_monthly_cents,
		})
		.from(agents)
		.where(and(eq(agents.id, id), eq(agents.tenant_id, tenantId)));
	if (!agent) return notFound("Agent not found");

	const policies = await db
		.select()
		.from(budgetPolicies)
		.where(
			and(
				eq(budgetPolicies.agent_id, id),
				eq(budgetPolicies.tenant_id, tenantId),
				eq(budgetPolicies.scope, "agent"),
			),
		);

	return json({
		budget_monthly_cents: agent.budget_monthly_cents,
		spent_monthly_cents: agent.spent_monthly_cents,
		policies,
	});
}

// ---------------------------------------------------------------------------
// Productivity Config — manage email triage schedule
// ---------------------------------------------------------------------------

interface ProductivityConfigBody {
	emailTriageEnabled?: boolean;
	emailTriageIntervalMin?: number;
}

async function updateProductivityConfig(
	tenantId: string,
	agentId: string,
	event: APIGatewayProxyEventV2,
) {
	let body: ProductivityConfigBody;
	try {
		body = event.body ? JSON.parse(event.body) : {};
	} catch {
		return error("Invalid JSON body");
	}

	// Look up agent to get current runtime_config
	const [agent] = await db
		.select({
			runtime_config: agents.runtime_config,
		})
		.from(agents)
		.where(and(eq(agents.id, agentId), eq(agents.tenant_id, tenantId)));

	if (!agent) return notFound("Agent not found");

	const currentConfig = (agent.runtime_config as Record<string, unknown>) || {};
	const currentProd = (currentConfig.productivityConfig as Record<string, unknown>) || {};

	const enabled = body.emailTriageEnabled ?? (currentProd.emailTriageEnabled as boolean ?? false);
	const intervalMin = body.emailTriageIntervalMin ?? (currentProd.emailTriageIntervalMin as number ?? 15);

	const newProdConfig: Record<string, unknown> = {
		...currentProd,
		emailTriageEnabled: enabled,
		emailTriageIntervalMin: intervalMin,
	};

	if (enabled) {
		// Create or update the triage wakeup — enqueue a wakeup request that will be
		// picked up by the existing wakeup-processor cron. We insert a self-repeating
		// pattern: the wakeup-processor handles it, and we store schedule info in
		// runtime_config for the heartbeat scheduler to re-enqueue periodically.
		newProdConfig.emailTriageScheduleEnabled = true;
		console.log(`[agent-actions] Email triage enabled for agent ${agentId} at ${intervalMin}min intervals`);
	} else {
		newProdConfig.emailTriageScheduleEnabled = false;
		console.log(`[agent-actions] Email triage disabled for agent ${agentId}`);
	}

	// Update agent runtime_config with JSONB merge
	const updatedConfig = {
		...currentConfig,
		productivityConfig: newProdConfig,
	};

	const [updated] = await db
		.update(agents)
		.set({
			runtime_config: updatedConfig,
			updated_at: new Date(),
		})
		.where(and(eq(agents.id, agentId), eq(agents.tenant_id, tenantId)))
		.returning();

	return json({
		ok: true,
		productivityConfig: newProdConfig,
	});
}
