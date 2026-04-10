import type {
	APIGatewayProxyEventV2,
	APIGatewayProxyStructuredResultV2,
} from "aws-lambda";
import { eq, and, desc } from "drizzle-orm";
import {
	routines,
	triggers,
	threadTurns,
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
		// DELETE /api/routines/:id/triggers/:triggerId
		const triggerDetailMatch = path.match(
			/^\/api\/routines\/([^/]+)\/triggers\/([^/]+)$/,
		);
		if (triggerDetailMatch) {
			const [, routineId, triggerId] = triggerDetailMatch;
			if (method === "PUT")
				return updateTrigger(routineId, triggerId, event);
			if (method === "DELETE")
				return deleteTrigger(routineId, triggerId);
			return error("Method not allowed", 405);
		}

		// /api/routines/:id/triggers
		const triggersMatch = path.match(
			/^\/api\/routines\/([^/]+)\/triggers$/,
		);
		if (triggersMatch) {
			const routineId = triggersMatch[1];
			if (method === "GET") return listTriggers(routineId);
			if (method === "POST") return createTrigger(routineId, event);
			return error("Method not allowed", 405);
		}

		// /api/routines/:id/runs/:runId
		const runDetailMatch = path.match(
			/^\/api\/routines\/([^/]+)\/runs\/([^/]+)$/,
		);
		if (runDetailMatch) {
			const [, routineId, runId] = runDetailMatch;
			if (method === "GET") return getRun(routineId, runId);
			return error("Method not allowed", 405);
		}

		// /api/routines/:id/runs
		const runsMatch = path.match(/^\/api\/routines\/([^/]+)\/runs$/);
		if (runsMatch) {
			const routineId = runsMatch[1];
			if (method === "GET") return listRuns(routineId);
			if (method === "POST") return createRun(routineId, event);
			return error("Method not allowed", 405);
		}

		// /api/routines/:id
		const idMatch = path.match(/^\/api\/routines\/([^/]+)$/);
		if (idMatch) {
			const routineId = idMatch[1];
			if (method === "GET") return getRoutine(routineId);
			if (method === "PUT") return updateRoutine(routineId, event);
			if (method === "DELETE") return deleteRoutine(routineId);
			return error("Method not allowed", 405);
		}

		// /api/routines
		if (path === "/api/routines") {
			if (method === "GET") return listRoutines(event);
			if (method === "POST") return createRoutine(event);
			return error("Method not allowed", 405);
		}

		return notFound("Route not found");
	} catch (err) {
		console.error("Routines handler error:", err);
		return error("Internal server error", 500);
	}
}

// ---------------------------------------------------------------------------
// Routine CRUD
// ---------------------------------------------------------------------------

async function listRoutines(
	event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyStructuredResultV2> {
	const tenantId = event.headers["x-tenant-id"];
	if (!tenantId) return error("x-tenant-id header is required");

	const conditions = [eq(routines.tenant_id, tenantId)];

	const params = event.queryStringParameters || {};
	if (params.status) conditions.push(eq(routines.status, params.status));
	if (params.type) conditions.push(eq(routines.type, params.type));
	if (params.hive_id)
		conditions.push(eq(routines.hive_id, params.hive_id));
	if (params.agent_id)
		conditions.push(eq(routines.agent_id, params.agent_id));

	const rows = await db
		.select()
		.from(routines)
		.where(and(...conditions))
		.orderBy(desc(routines.created_at));

	return json(rows);
}

async function getRoutine(
	id: string,
): Promise<APIGatewayProxyStructuredResultV2> {
	const [routine] = await db
		.select()
		.from(routines)
		.where(eq(routines.id, id));
	if (!routine) return notFound("Routine not found");
	return json(routine);
}

async function createRoutine(
	event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyStructuredResultV2> {
	const tenantId = event.headers["x-tenant-id"];
	if (!tenantId) return error("x-tenant-id header is required");

	const body = JSON.parse(event.body || "{}");
	if (!body.name) return error("name is required");

	const [routine] = await db
		.insert(routines)
		.values({
			tenant_id: tenantId,
			name: body.name,
			description: body.description,
			type: body.type || "scheduled",
			schedule: body.schedule,
			config: body.config,
			agent_id: body.agent_id,
			hive_id: body.hive_id,
		})
		.returning();

	return json(routine, 201);
}

async function updateRoutine(
	id: string,
	event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyStructuredResultV2> {
	const body = JSON.parse(event.body || "{}");
	const updates: Record<string, unknown> = {};
	if (body.name !== undefined) updates.name = body.name;
	if (body.description !== undefined) updates.description = body.description;
	if (body.type !== undefined) updates.type = body.type;
	if (body.status !== undefined) updates.status = body.status;
	if (body.schedule !== undefined) updates.schedule = body.schedule;
	if (body.config !== undefined) updates.config = body.config;
	if (body.agent_id !== undefined)
		updates.agent_id = body.agent_id;
	if (body.hive_id !== undefined) updates.hive_id = body.hive_id;

	if (Object.keys(updates).length === 0) {
		return error("No valid fields to update");
	}

	const [updated] = await db
		.update(routines)
		.set({ ...updates, updated_at: new Date() })
		.where(eq(routines.id, id))
		.returning();

	if (!updated) return notFound("Routine not found");
	return json(updated);
}

async function deleteRoutine(
	id: string,
): Promise<APIGatewayProxyStructuredResultV2> {
	const [updated] = await db
		.update(routines)
		.set({ status: "archived", updated_at: new Date() })
		.where(eq(routines.id, id))
		.returning();

	if (!updated) return notFound("Routine not found");
	return json(updated);
}

// ---------------------------------------------------------------------------
// Runs
// ---------------------------------------------------------------------------

async function listRuns(
	routineId: string,
): Promise<APIGatewayProxyStructuredResultV2> {
	const rows = await db
		.select()
		.from(threadTurns)
		.where(eq(threadTurns.routine_id, routineId))
		.orderBy(desc(threadTurns.created_at));

	return json(rows);
}

async function getRun(
	routineId: string,
	runId: string,
): Promise<APIGatewayProxyStructuredResultV2> {
	const [run] = await db
		.select()
		.from(threadTurns)
		.where(
			and(
				eq(threadTurns.id, runId),
				eq(threadTurns.routine_id, routineId),
			),
		);
	if (!run) return notFound("Run not found");

	return json(run);
}

async function createRun(
	routineId: string,
	event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyStructuredResultV2> {
	const [routine] = await db
		.select({ tenant_id: routines.tenant_id })
		.from(routines)
		.where(eq(routines.id, routineId));
	if (!routine) return notFound("Routine not found");

	const [run] = await db
		.insert(threadTurns)
		.values({
			routine_id: routineId,
			tenant_id: routine.tenant_id,
			invocation_source: "on_demand",
			status: "queued",
		})
		.returning();

	return json(run, 201);
}

// ---------------------------------------------------------------------------
// Triggers
// ---------------------------------------------------------------------------

async function listTriggers(
	routineId: string,
): Promise<APIGatewayProxyStructuredResultV2> {
	const rows = await db
		.select()
		.from(triggers)
		.where(eq(triggers.routine_id, routineId))
		.orderBy(desc(triggers.created_at));

	return json(rows);
}

async function createTrigger(
	routineId: string,
	event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyStructuredResultV2> {
	const [routine] = await db
		.select({ tenant_id: routines.tenant_id, name: routines.name })
		.from(routines)
		.where(eq(routines.id, routineId));
	if (!routine) return notFound("Routine not found");

	const body = JSON.parse(event.body || "{}");
	if (!body.trigger_type) return error("trigger_type is required");

	const cronExpr = body.config?.schedule as string || "";
	const [row] = await db
		.insert(triggers)
		.values({
			tenant_id: routine.tenant_id,
			trigger_type: body.trigger_type === "schedule" ? "routine_schedule" : body.trigger_type,
			routine_id: routineId,
			name: `Schedule: ${routine.name}`,
			config: body.config,
			schedule_type: "cron",
			schedule_expression: cronExpr.startsWith("cron(") ? cronExpr : cronExpr ? `cron(${cronExpr} *)` : "",
			timezone: (body.config?.timezone as string) || "UTC",
			enabled: body.enabled ?? true,
			created_by_type: "system",
		})
		.returning();

	return json(row, 201);
}

async function updateTrigger(
	routineId: string,
	triggerId: string,
	event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyStructuredResultV2> {
	const body = JSON.parse(event.body || "{}");
	const updates: Record<string, unknown> = { updated_at: new Date() };
	if (body.config !== undefined) updates.config = body.config;
	if (body.enabled !== undefined) updates.enabled = body.enabled;

	const [updated] = await db
		.update(triggers)
		.set(updates)
		.where(
			and(
				eq(triggers.id, triggerId),
				eq(triggers.routine_id, routineId),
			),
		)
		.returning();

	if (!updated) return notFound("Trigger not found");
	return json(updated);
}

async function deleteTrigger(
	routineId: string,
	triggerId: string,
): Promise<APIGatewayProxyStructuredResultV2> {
	const [deleted] = await db
		.update(triggers)
		.set({ enabled: false, updated_at: new Date() })
		.where(
			and(
				eq(triggers.id, triggerId),
				eq(triggers.routine_id, routineId),
				eq(triggers.routine_id, routineId),
				eq(triggers.trigger_type, "routine_schedule"),
				eq(triggers.enabled, true),
			),
		);

	return json(deleted);
}
