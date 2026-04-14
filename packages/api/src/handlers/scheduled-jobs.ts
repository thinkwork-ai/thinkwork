/**
 * Scheduled Jobs REST Handler
 *
 * Unified handler for scheduled jobs, trigger runs, events, and on-demand wakeups.
 *
 * Routes:
 *   GET    /api/scheduled-jobs                    — List scheduled jobs
 *   POST   /api/scheduled-jobs                    — Create scheduled job
 *   GET    /api/scheduled-jobs/:id                — Get scheduled job detail
 *   PUT    /api/scheduled-jobs/:id                — Update scheduled job
 *   DELETE /api/scheduled-jobs/:id                — Delete (disable) scheduled job
 *   POST   /api/scheduled-jobs/:id/fire           — Manual fire now
 *
 *   GET    /api/thread-turns                — List runs
 *   GET    /api/thread-turns/:id            — Get run detail
 *   POST   /api/thread-turns/:id/cancel     — Cancel run
 *   GET    /api/thread-turns/:id/events     — Event stream
 *
 *   POST   /api/thread-turns/wakeup/:agentId — On-demand agent wakeup
 */

import type {
	APIGatewayProxyEventV2,
	APIGatewayProxyStructuredResultV2,
} from "aws-lambda";
import { eq, and, desc, gt } from "drizzle-orm";
import {
	scheduledJobs,
	threadTurns,
	threadTurnEvents,
	agentWakeupRequests,
	agents,
} from "@thinkwork/database-pg/schema";
import { db } from "../lib/db.js";
import { extractBearerToken, validateApiSecret } from "../lib/auth.js";
import { handleCors, json, error, notFound, unauthorized } from "../lib/response.js";
import { ensureThreadForWork } from "../lib/thread-helpers.js";

// ---------------------------------------------------------------------------
// Job Schedule Manager — invoke to create/update/delete EventBridge schedules
// ---------------------------------------------------------------------------

let _jobScheduleManagerFnArn: string | null | undefined;
async function getJobScheduleManagerFnArn(): Promise<string | null> {
	if (_jobScheduleManagerFnArn !== undefined) return _jobScheduleManagerFnArn;
	try {
		let stage = process.env.STAGE || process.env.STAGE || "";
		if (!stage && process.env.SST_RESOURCE_App) {
			try { stage = JSON.parse(process.env.SST_RESOURCE_App).stage; } catch {}
		}
		if (!stage) stage = "dev";
		const { SSMClient, GetParameterCommand } = await import("@aws-sdk/client-ssm");
		const ssm = new SSMClient({});
		const res = await ssm.send(new GetParameterCommand({
			Name: `/thinkwork/${stage}/job-schedule-manager-fn-arn`,
		}));
		_jobScheduleManagerFnArn = res.Parameter?.Value || null;
	} catch {
		_jobScheduleManagerFnArn = null;
	}
	return _jobScheduleManagerFnArn;
}

type ScheduleManagerResult = { ok: true } | { ok: false; error: string };

async function invokeJobScheduleManager(
	method: string,
	body: Record<string, unknown>,
): Promise<ScheduleManagerResult> {
	try {
		const fnArn = await getJobScheduleManagerFnArn();
		if (!fnArn) {
			const msg = "Job schedule manager Lambda ARN not configured (SSM parameter missing)";
			console.error("[scheduled-jobs]", msg);
			return { ok: false, error: msg };
		}
		const { LambdaClient, InvokeCommand } = await import("@aws-sdk/client-lambda");
		const lambda = new LambdaClient({});
		const res = await lambda.send(new InvokeCommand({
			FunctionName: fnArn,
			InvocationType: "RequestResponse",
			Payload: new TextEncoder().encode(JSON.stringify({
				body: JSON.stringify(body),
				requestContext: { http: { method } },
				rawPath: "/api/job-schedules",
				headers: {
					authorization: `Bearer ${process.env.API_AUTH_SECRET || ""}`,
				},
			})),
		}));
		const rawPayload = res.Payload ? new TextDecoder().decode(res.Payload) : "";
		if (res.FunctionError) {
			console.error("[scheduled-jobs] Job schedule manager Lambda error:", res.FunctionError, rawPayload);
			return { ok: false, error: `Job schedule manager threw: ${rawPayload || res.FunctionError}` };
		}
		if (rawPayload) {
			try {
				const parsed = JSON.parse(rawPayload) as { statusCode?: number; body?: string };
				if (typeof parsed.statusCode === "number" && parsed.statusCode >= 400) {
					const inner = typeof parsed.body === "string" ? parsed.body : JSON.stringify(parsed.body);
					console.error("[scheduled-jobs] Job schedule manager returned", parsed.statusCode, inner);
					return { ok: false, error: `Job schedule manager returned ${parsed.statusCode}: ${inner}` };
				}
			} catch {
				// Non-JSON response — treat as opaque success since no FunctionError was set
			}
		}
		return { ok: true };
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		console.error("[scheduled-jobs] Failed to invoke job schedule manager:", err);
		return { ok: false, error: message };
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

	const method = event.requestContext.http.method;
	const path = event.rawPath;

	try {
		// --- Scheduled Jobs (definitions) ---

		// POST /api/scheduled-jobs/:id/fire — manual fire
		const fireMatch = path.match(/^\/api\/scheduled-jobs\/([^/]+)\/fire$/);
		if (fireMatch) {
			if (method === "POST") return fireScheduledJob(fireMatch[1], event);
			return error("Method not allowed", 405);
		}

		// GET/PUT/DELETE /api/scheduled-jobs/:id
		const triggerIdMatch = path.match(/^\/api\/scheduled-jobs\/([^/]+)$/);
		if (triggerIdMatch) {
			if (method === "GET") return getScheduledJob(triggerIdMatch[1]);
			if (method === "PUT") return updateScheduledJob(triggerIdMatch[1], event);
			if (method === "DELETE") return deleteScheduledJob(triggerIdMatch[1], event);
			return error("Method not allowed", 405);
		}

		// GET/POST /api/scheduled-jobs
		if (path === "/api/scheduled-jobs") {
			if (method === "GET") return listScheduledJobs(event);
			if (method === "POST") return createScheduledJob(event);
			return error("Method not allowed", 405);
		}

		// --- Trigger Runs ---

		// POST /api/thread-turns/wakeup/:agentId — on-demand wakeup
		const wakeupMatch = path.match(/^\/api\/trigger-runs\/wakeup\/([^/]+)$/);
		if (wakeupMatch) {
			if (method === "POST") return triggerWakeup(wakeupMatch[1], event);
			return error("Method not allowed", 405);
		}

		// GET /api/thread-turns/:id/events
		const eventsMatch = path.match(/^\/api\/trigger-runs\/([^/]+)\/events$/);
		if (eventsMatch) {
			if (method === "GET") return listEvents(eventsMatch[1], event);
			return error("Method not allowed", 405);
		}

		// POST /api/thread-turns/:id/cancel
		const cancelMatch = path.match(/^\/api\/trigger-runs\/([^/]+)\/cancel$/);
		if (cancelMatch) {
			if (method === "POST") return cancelRun(cancelMatch[1]);
			return error("Method not allowed", 405);
		}

		// GET /api/thread-turns/:id
		const runIdMatch = path.match(/^\/api\/trigger-runs\/([^/]+)$/);
		if (runIdMatch) {
			if (method === "GET") return getRun(runIdMatch[1]);
			return error("Method not allowed", 405);
		}

		// GET /api/thread-turns
		if (path === "/api/thread-turns") {
			if (method === "GET") return listRuns(event);
			return error("Method not allowed", 405);
		}

		return notFound("Route not found");
	} catch (err) {
		console.error("Scheduled jobs handler error:", err);
		return error("Internal server error", 500);
	}
}

// ---------------------------------------------------------------------------
// Scheduled Jobs (definitions)
// ---------------------------------------------------------------------------

async function listScheduledJobs(
	event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyStructuredResultV2> {
	const tenantId = event.headers["x-tenant-id"];
	if (!tenantId) return error("x-tenant-id header is required");

	const conditions = [eq(scheduledJobs.tenant_id, tenantId)];

	const params = event.queryStringParameters || {};
	if (params.agent_id) conditions.push(eq(scheduledJobs.agent_id, params.agent_id));
	if (params.routine_id) conditions.push(eq(scheduledJobs.routine_id, params.routine_id));
	if (params.trigger_type) conditions.push(eq(scheduledJobs.trigger_type, params.trigger_type));
	if (params.enabled !== undefined) conditions.push(eq(scheduledJobs.enabled, params.enabled === "true"));

	const rows = await db
		.select()
		.from(scheduledJobs)
		.where(and(...conditions))
		.orderBy(desc(scheduledJobs.created_at))
		.limit(100);

	return json(rows);
}

async function getScheduledJob(
	id: string,
): Promise<APIGatewayProxyStructuredResultV2> {
	const [row] = await db.select().from(scheduledJobs).where(eq(scheduledJobs.id, id));
	if (!row) return notFound("Trigger not found");
	return json(row);
}

async function createScheduledJob(
	event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyStructuredResultV2> {
	const tenantId = event.headers["x-tenant-id"];
	if (!tenantId) return error("x-tenant-id header is required");

	let body: Record<string, unknown> = {};
	try { body = event.body ? JSON.parse(event.body) : {}; } catch { return error("Invalid JSON body"); }

	if (!body.name || !body.trigger_type) {
		return error("name and trigger_type are required");
	}

	const [row] = await db
		.insert(scheduledJobs)
		.values({
			tenant_id: tenantId,
			trigger_type: body.trigger_type as string,
			agent_id: (body.agent_id as string) || null,
			routine_id: (body.routine_id as string) || null,
			team_id: (body.team_id as string) || null,
			name: body.name as string,
			description: (body.description as string) || null,
			prompt: (body.prompt as string) || null,
			config: body.config as Record<string, unknown> || null,
			schedule_type: (body.schedule_type as string) || null,
			schedule_expression: (body.schedule_expression as string) || null,
			timezone: (body.timezone as string) || "UTC",
			enabled: true,
			created_by_type: (body.created_by_type as string) || "user",
			created_by_id: (body.created_by_id as string) || null,
		})
		.returning();

	// Create EventBridge schedule if this is a timer-based trigger
	if (row.schedule_type && row.schedule_expression) {
		const result = await invokeJobScheduleManager("POST", {
			triggerId: row.id,
			tenantId,
			triggerType: row.trigger_type,
			agentId: row.agent_id || undefined,
			routineId: row.routine_id || undefined,
			name: row.name,
			scheduleType: row.schedule_type,
			scheduleExpression: row.schedule_expression,
			timezone: row.timezone,
			prompt: row.prompt || undefined,
			config: row.config || undefined,
			createdByType: "user",
		});
		if (!result.ok) {
			// Keep the DB row so the user's input isn't lost; surface a clear error
			// so they can retry via Edit → Save (which hits the update/repair path).
			return error(
				`Automation saved but EventBridge schedule could not be provisioned: ${result.error}. Open the automation and press Save to retry.`,
				502,
			);
		}
	}

	// Re-read to pick up eb_schedule_name written by the manager Lambda
	const [refreshed] = await db
		.select()
		.from(scheduledJobs)
		.where(eq(scheduledJobs.id, row.id));
	return json(refreshed || row, 201);
}

async function updateScheduledJob(
	id: string,
	event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyStructuredResultV2> {
	const tenantId = event.headers["x-tenant-id"];
	if (!tenantId) return error("x-tenant-id header is required");

	let body: Record<string, unknown> = {};
	try { body = event.body ? JSON.parse(event.body) : {}; } catch { return error("Invalid JSON body"); }

	const updates: Record<string, unknown> = { updated_at: new Date() };
	if (body.name !== undefined) updates.name = body.name;
	if (body.description !== undefined) updates.description = body.description;
	if (body.prompt !== undefined) updates.prompt = body.prompt;
	if (body.config !== undefined) updates.config = body.config;
	if (body.schedule_expression !== undefined) updates.schedule_expression = body.schedule_expression;
	if (body.schedule_type !== undefined) updates.schedule_type = body.schedule_type;
	if (body.timezone !== undefined) updates.timezone = body.timezone;
	if (body.enabled !== undefined) updates.enabled = body.enabled;

	const [updated] = await db
		.update(scheduledJobs)
		.set(updates)
		.where(and(eq(scheduledJobs.id, id), eq(scheduledJobs.tenant_id, tenantId)))
		.returning();

	if (!updated) return notFound("Trigger not found");

	// Update EventBridge schedule — await and surface errors so repair/edit flows are reliable
	if (updated.schedule_type && updated.schedule_expression) {
		const result = await invokeJobScheduleManager("PUT", {
			triggerId: updated.id,
			scheduleExpression: updated.schedule_expression,
			scheduleType: updated.schedule_type,
			timezone: updated.timezone,
			prompt: updated.prompt || undefined,
			config: updated.config || undefined,
			enabled: updated.enabled,
		});
		if (!result.ok) {
			return error(
				`Automation updated in database but EventBridge schedule sync failed: ${result.error}`,
				502,
			);
		}
	}

	// Re-read to pick up eb_schedule_name in case the update path provisioned a fresh schedule
	const [refreshed] = await db
		.select()
		.from(scheduledJobs)
		.where(eq(scheduledJobs.id, updated.id));
	return json(refreshed || updated);
}

async function deleteScheduledJob(
	id: string,
	event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyStructuredResultV2> {
	const tenantId = event.headers["x-tenant-id"];
	if (!tenantId) return error("x-tenant-id header is required");

	// Read the trigger first to get the eb_schedule_name before we clear it
	const [existing] = await db
		.select()
		.from(scheduledJobs)
		.where(and(eq(scheduledJobs.id, id), eq(scheduledJobs.tenant_id, tenantId)));
	if (!existing) return notFound("Trigger not found");

	// Delete EventBridge schedule
	if (existing.eb_schedule_name) {
		invokeJobScheduleManager("DELETE", {
			triggerId: existing.id,
			ebScheduleName: existing.eb_schedule_name,
		});
	}

	// Null out FK references in trigger_runs before deleting
	await db
		.update(threadTurns)
		.set({ trigger_id: null })
		.where(eq(threadTurns.trigger_id, id));

	// Hard delete the scheduled job row
	await db.delete(scheduledJobs).where(eq(scheduledJobs.id, id));

	return json({ ok: true, id });
}

async function fireScheduledJob(
	triggerId: string,
	event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyStructuredResultV2> {
	const tenantId = event.headers["x-tenant-id"];
	if (!tenantId) return error("x-tenant-id header is required");

	const [trig] = await db
		.select()
		.from(scheduledJobs)
		.where(and(eq(scheduledJobs.id, triggerId), eq(scheduledJobs.tenant_id, tenantId)));
	if (!trig) return notFound("Trigger not found");

	const isAgentTrigger = trig.trigger_type.startsWith("agent_");

	if (isAgentTrigger && trig.agent_id) {
		// Create a thread to track this scheduled job execution
		let threadId: string | undefined;
		try {
			const result = await ensureThreadForWork({
				tenantId,
				agentId: trig.agent_id,
				title: trig.name,
				channel: "schedule",
			});
			threadId = result.threadId;
		} catch (err) {
			console.warn("[scheduled-jobs] Failed to create thread for manual fire:", err);
		}

		const [wakeup] = await db
			.insert(agentWakeupRequests)
			.values({
				tenant_id: tenantId,
				agent_id: trig.agent_id,
				source: "on_demand",
				trigger_detail: `manual_fire:trigger:${triggerId}`,
				reason: `Manual fire of ${trig.name}`,
				payload: trig.prompt
					? { message: trig.prompt, triggerId, ...(threadId && { threadId }) }
					: { triggerId, ...(threadId && { threadId }) },
				requested_by_actor_type: "user",
			})
			.returning();

		return json({ ok: true, wakeupRequestId: wakeup.id }, 201);
	} else if (trig.routine_id) {
		const [run] = await db
			.insert(threadTurns)
			.values({
				tenant_id: tenantId,
				trigger_id: triggerId,
				routine_id: trig.routine_id,
				invocation_source: "on_demand",
				trigger_detail: `manual_fire:trigger:${triggerId}`,
				status: "queued",
			})
			.returning();

		return json({ ok: true, runId: run.id }, 201);
	}

	return error("Trigger has no agent or routine target");
}

// ---------------------------------------------------------------------------
// Trigger Runs
// ---------------------------------------------------------------------------

async function listRuns(
	event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyStructuredResultV2> {
	const tenantId = event.headers["x-tenant-id"];
	if (!tenantId) return error("x-tenant-id header is required");

	const conditions = [eq(threadTurns.tenant_id, tenantId)];

	const params = event.queryStringParameters || {};
	if (params.agent_id) conditions.push(eq(threadTurns.agent_id, params.agent_id));
	if (params.routine_id) conditions.push(eq(threadTurns.routine_id, params.routine_id));
	if (params.trigger_id) conditions.push(eq(threadTurns.trigger_id, params.trigger_id));
	if (params.status) conditions.push(eq(threadTurns.status, params.status));

	const limit = Math.min(Number(params.limit) || 50, 200);

	const rows = await db
		.select()
		.from(threadTurns)
		.where(and(...conditions))
		.orderBy(desc(threadTurns.started_at))
		.limit(limit);

	return json(rows);
}

async function getRun(id: string): Promise<APIGatewayProxyStructuredResultV2> {
	const [run] = await db.select().from(threadTurns).where(eq(threadTurns.id, id));
	if (!run) return notFound("Trigger run not found");
	return json(run);
}

async function cancelRun(id: string): Promise<APIGatewayProxyStructuredResultV2> {
	const [updated] = await db
		.update(threadTurns)
		.set({ status: "cancelled", finished_at: new Date() })
		.where(and(eq(threadTurns.id, id), eq(threadTurns.status, "running")))
		.returning();

	if (!updated) return notFound("Running trigger run not found");
	return json(updated);
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

async function listEvents(
	runId: string,
	event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyStructuredResultV2> {
	const params = event.queryStringParameters || {};
	const limit = Math.min(Number(params.limit) || 100, 500);

	const conditions = [eq(threadTurnEvents.run_id, runId)];
	if (params.after_seq) conditions.push(gt(threadTurnEvents.seq, Number(params.after_seq)));

	const rows = await db
		.select()
		.from(threadTurnEvents)
		.where(and(...conditions))
		.orderBy(threadTurnEvents.seq)
		.limit(limit);

	return json(rows);
}

// ---------------------------------------------------------------------------
// On-demand Wakeup — POST /api/thread-turns/wakeup/:agentId
// ---------------------------------------------------------------------------

async function triggerWakeup(
	agentId: string,
	event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyStructuredResultV2> {
	const tenantId = event.headers["x-tenant-id"];
	if (!tenantId) return error("x-tenant-id header is required");

	const [agent] = await db
		.select({ id: agents.id, tenant_id: agents.tenant_id })
		.from(agents)
		.where(and(eq(agents.id, agentId), eq(agents.tenant_id, tenantId)));
	if (!agent) return notFound("Agent not found");

	let body: Record<string, unknown> = {};
	try { body = event.body ? JSON.parse(event.body) : {}; } catch { return error("Invalid JSON body"); }

	const reason = String(body.reason || "manual");
	const prompt = body.prompt as string | undefined;
	const payload: Record<string, unknown> = { ...(body.payload as Record<string, unknown> || {}) };
	if (prompt) payload.message = prompt;
	if (body.contextSnapshot) payload.contextSnapshot = body.contextSnapshot;

	const [wakeup] = await db
		.insert(agentWakeupRequests)
		.values({
			tenant_id: tenantId,
			agent_id: agentId,
			source: "on_demand",
			trigger_detail: prompt ? "manual_with_prompt" : "manual",
			reason,
			payload: Object.keys(payload).length > 0 ? payload : undefined,
			requested_by_actor_type: "user",
		})
		.returning();

	return json(wakeup, 201);
}
