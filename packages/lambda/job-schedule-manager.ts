/**
 * Unified Job Schedule Manager Lambda
 *
 * Manages AWS EventBridge Scheduler rules for all scheduled jobs.
 * Replaces heartbeat-schedule-manager.ts + schedule-manager.ts.
 *
 * Also manages the scheduled_jobs DB table — creates/updates/deletes rows
 * alongside EventBridge schedules.
 *
 * Endpoints:
 *   POST   /api/job-schedules           — Create a schedule + EB rule
 *   PUT    /api/job-schedules           — Update a schedule + EB rule
 *   DELETE /api/job-schedules           — Delete a schedule + EB rule
 *   GET    /api/job-schedules/:id       — Get schedule detail (by job ID)
 *   GET    /api/job-schedules           — List schedules (query params: agentId, routineId, tenantId)
 *
 * Auth: Bearer <API_AUTH_SECRET>
 *
 * Environment:
 *   API_AUTH_SECRET       — Shared secret for auth
 *   JOB_TRIGGER_ARN      — ARN of the JobTriggerLambda
 *   JOB_TRIGGER_ROLE_ARN — IAM role ARN for EventBridge to invoke the target
 *   DATABASE_CLUSTER_ARN — Aurora cluster ARN
 *   DATABASE_SECRET_ARN  — Secrets Manager ARN
 *   DATABASE_NAME        — Database name
 */

import {
	SchedulerClient,
	CreateScheduleCommand,
	DeleteScheduleCommand,
	UpdateScheduleCommand,
	GetScheduleCommand,
	ListSchedulesCommand,
	CreateScheduleGroupCommand,
	ScheduleState,
} from "@aws-sdk/client-scheduler";
import type { Target } from "@aws-sdk/client-scheduler";
import { getDb } from "@thinkwork/database-pg";
import { triggers } from "@thinkwork/database-pg/schema";
import { eq, and } from "drizzle-orm";

const JSON_HEADERS = { "Content-Type": "application/json" };
const SCHEDULE_GROUP = "thinkwork-jobs";

const schedulerClient = new SchedulerClient({});

// Ensure schedule group exists (idempotent)
let groupEnsured = false;
async function ensureScheduleGroup(): Promise<void> {
	if (groupEnsured) return;
	try {
		await schedulerClient.send(
			new CreateScheduleGroupCommand({ Name: SCHEDULE_GROUP }),
		);
	} catch (err: unknown) {
		if ((err as { name?: string }).name !== "ConflictException") {
			console.warn("[job-schedule-manager] Failed to create schedule group:", err);
		}
	}
	groupEnsured = true;
}

// ─── Types ────────────────────────────────────────────────────────────────────

interface CreateJobBody {
	tenantId: string;
	triggerType: string;           // agent_heartbeat | agent_reminder | agent_scheduled | routine_schedule | routine_one_time
	triggerId?: string;            // If provided, row already exists (REST handler created it)
	agentId?: string;
	routineId?: string;
	teamId?: string;
	name: string;
	description?: string;
	prompt?: string;
	config?: Record<string, unknown>;
	scheduleType: string;      // rate | cron | at
	scheduleExpression: string; // rate(5 minutes) | cron(0 8 * * ? *) | at(2026-03-17T08:00:00)
	timezone?: string;
	enabled?: boolean;
	createdByType?: string;
	createdById?: string;
}

interface UpdateJobBody {
	triggerId: string;
	name?: string;
	description?: string;
	prompt?: string;
	config?: Record<string, unknown>;
	scheduleExpression?: string;
	scheduleType?: string;
	timezone?: string;
	enabled?: boolean;
}

interface DeleteJobBody {
	triggerId: string;
}

interface ApiGwEvent {
	body?: string;
	headers?: Record<string, string>;
	rawPath?: string;
	requestContext?: { http?: { method?: string; path?: string } };
	queryStringParameters?: Record<string, string>;
}

// ─── Auth ─────────────────────────────────────────────────────────────────────

function authenticate(headers: Record<string, string> | undefined): boolean {
	const expectedSecret = process.env.API_AUTH_SECRET;
	if (!expectedSecret) return false;
	const authHeader = headers?.authorization ?? headers?.Authorization ?? "";
	const token = authHeader.replace(/^Bearer\s+/i, "");
	return token === expectedSecret;
}

// ─── Naming ───────────────────────────────────────────────────────────────────

function buildScheduleName(triggerId: string, oneTime = false): string {
	const prefix = oneTime ? "job-once" : "job";
	return `${prefix}-${triggerId.slice(0, 8)}-${Date.now().toString(36)}`;
}

// ─── EventBridge Helpers ──────────────────────────────────────────────────────

/**
 * Normalize a schedule expression for EventBridge.
 * Handles: rate(...), cron(...), at(...)
 * For cron: ensures 6-field format (adds year wildcard if 5 fields).
 */
function normalizeExpression(expr: string): string {
	if (expr.startsWith("rate(") || expr.startsWith("at(")) return expr;
	if (expr.startsWith("cron(")) {
		// Already wrapped
		const inner = expr.slice(5, -1).trim();
		const parts = inner.split(/\s+/);
		if (parts.length === 5) return `cron(${inner} *)`;
		return expr;
	}
	// Bare cron: wrap it
	const parts = expr.trim().split(/\s+/);
	if (parts.length === 5) return `cron(${expr} *)`;
	if (parts.length === 6) return `cron(${expr})`;
	return `cron(${expr} *)`;
}

/**
 * Convert intervalSec to an EventBridge rate expression.
 */
function toRateExpression(intervalSec: number): string {
	if (intervalSec >= 3600 && intervalSec % 3600 === 0) {
		const hours = intervalSec / 3600;
		return hours === 1 ? "rate(1 hour)" : `rate(${hours} hours)`;
	}
	const minutes = Math.max(1, Math.round(intervalSec / 60));
	return minutes === 1 ? "rate(1 minute)" : `rate(${minutes} minutes)`;
}

// ─── Handlers ─────────────────────────────────────────────────────────────────

async function createJob(body: CreateJobBody): Promise<Record<string, unknown>> {
	const targetArn = process.env.JOB_TRIGGER_ARN;
	const roleArn = process.env.JOB_TRIGGER_ROLE_ARN;
	if (!targetArn || !roleArn) throw new Error("JOB_TRIGGER_ARN and JOB_TRIGGER_ROLE_ARN must be set");

	await ensureScheduleGroup();

	const db = getDb();
	const isOneTime = body.scheduleType === "at";

	// Normalize expression
	let expression = body.scheduleExpression;
	if (body.scheduleType === "rate" && !expression.startsWith("rate(")) {
		const sec = parseInt(expression, 10);
		if (!isNaN(sec)) expression = toRateExpression(sec);
	}
	expression = normalizeExpression(expression);

	// If triggerId is provided, the row already exists (created by REST handler).
	// Otherwise, insert a new row (legacy path from GraphQL resolver / heartbeat auto-create).
	let jobId: string;
	let triggerType = body.triggerType;
	let tenantId = body.tenantId;

	if (body.triggerId) {
		// Row already exists — just attach the EB schedule
		jobId = body.triggerId;
		const [existing] = await db.select().from(triggers).where(eq(triggers.id, jobId));
		if (existing) {
			triggerType = existing.trigger_type;
			tenantId = existing.tenant_id;
		}
	} else {
		// Create DB row (legacy path)
		const [job] = await db.insert(triggers).values({
			tenant_id: body.tenantId,
			trigger_type: body.triggerType,
			agent_id: body.agentId || null,
			routine_id: body.routineId || null,
			team_id: body.teamId || null,
			name: body.name,
			description: body.description,
			prompt: body.prompt,
			config: body.config,
			schedule_type: body.scheduleType,
			schedule_expression: expression,
			timezone: body.timezone || "UTC",
			enabled: body.enabled !== false,
			created_by_type: body.createdByType || "system",
			created_by_id: body.createdById,
		}).returning();
		jobId = job.id;
	}

	// Create EventBridge schedule
	const scheduleName = buildScheduleName(jobId, isOneTime);

	const target: Target = {
		Arn: targetArn,
		RoleArn: roleArn,
		Input: JSON.stringify({
			triggerId: jobId,
			triggerType,
			tenantId,
			agentId: body.agentId,
			routineId: body.routineId,
			prompt: body.prompt || undefined,
			scheduleName,
			oneTime: isOneTime,
		}),
	};

	await schedulerClient.send(
		new CreateScheduleCommand({
			Name: scheduleName,
			GroupName: SCHEDULE_GROUP,
			ScheduleExpression: expression,
			ScheduleExpressionTimezone: body.timezone || "UTC",
			Target: target,
			FlexibleTimeWindow: { Mode: "OFF" },
			State: body.enabled !== false ? ScheduleState.ENABLED : ScheduleState.DISABLED,
			Description: `Thinkwork ${triggerType}: ${body.name || jobId}`,
			...(isOneTime ? { ActionAfterCompletion: "DELETE" } : {}),
		}),
	);

	// Store EB schedule name back on the trigger row
	const [updated] = await db
		.update(triggers)
		.set({ eb_schedule_name: scheduleName })
		.where(eq(triggers.id, jobId))
		.returning();

	console.log(`[job-schedule-manager] Created EB schedule ${scheduleName} for trigger ${jobId} (${expression})`);
	return updated || { id: jobId, eb_schedule_name: scheduleName };
}

async function updateJob(body: UpdateJobBody): Promise<Record<string, unknown>> {
	const targetArn = process.env.JOB_TRIGGER_ARN;
	const roleArn = process.env.JOB_TRIGGER_ROLE_ARN;
	if (!targetArn || !roleArn) throw new Error("JOB_TRIGGER_ARN and JOB_TRIGGER_ROLE_ARN must be set");

	const db = getDb();

	// Fetch current job
	const [current] = await db
		.select()
		.from(triggers)
		.where(eq(triggers.id, body.triggerId));
	if (!current) throw new Error("Job not found");

	// Build DB updates
	const updates: Record<string, unknown> = { updated_at: new Date() };
	if (body.name !== undefined) updates.name = body.name;
	if (body.description !== undefined) updates.description = body.description;
	if (body.prompt !== undefined) updates.prompt = body.prompt;
	if (body.config !== undefined) updates.config = body.config;
	if (body.timezone !== undefined) updates.timezone = body.timezone;
	if (body.enabled !== undefined) updates.enabled = body.enabled;

	let expression: string = current.schedule_expression || "";
	if (body.scheduleExpression) {
		expression = normalizeExpression(body.scheduleExpression);
		updates.schedule_expression = expression;
	}
	if (body.scheduleType) updates.schedule_type = body.scheduleType;

	const [updated] = await db
		.update(triggers)
		.set(updates)
		.where(eq(triggers.id, body.triggerId))
		.returning();

	// Determine effective enabled state after this update
	const isEnabled = body.enabled !== undefined ? body.enabled : current.enabled;
	const wasEnabled = current.enabled;

	if (!isEnabled && wasEnabled && current.eb_schedule_name) {
		// Disabling: delete the EB schedule entirely so it stops firing (and stops costing)
		try {
			await schedulerClient.send(
				new DeleteScheduleCommand({
					Name: current.eb_schedule_name!,
					GroupName: SCHEDULE_GROUP,
				}),
			);
			console.log(`[job-schedule-manager] Deleted EB schedule ${current.eb_schedule_name} (trigger disabled)`);
		} catch (ebErr) {
			console.error(`[job-schedule-manager] Failed to delete EB schedule on disable:`, ebErr);
		}
	} else if (isEnabled && !wasEnabled) {
		// Re-enabling: recreate the EB schedule
		await ensureScheduleGroup();
		const scheduleName = current.eb_schedule_name || buildScheduleName(current.id, current.schedule_type === "at");
		const target: Target = {
			Arn: targetArn,
			RoleArn: roleArn,
			Input: JSON.stringify({
				triggerId: current.id,
				triggerType: current.trigger_type,
				tenantId: current.tenant_id,
				agentId: current.agent_id,
				routineId: current.routine_id,
				prompt: body.prompt !== undefined ? body.prompt : current.prompt,
				scheduleName,
				oneTime: current.schedule_type === "at",
			}),
		};
		try {
			await schedulerClient.send(
				new CreateScheduleCommand({
					Name: scheduleName,
					GroupName: SCHEDULE_GROUP,
					ScheduleExpression: expression,
					ScheduleExpressionTimezone: body.timezone ?? current.timezone ?? undefined,
					Target: target,
					FlexibleTimeWindow: { Mode: "OFF" },
					State: ScheduleState.ENABLED,
					Description: `Thinkwork ${current.trigger_type}: ${current.name || current.id}`,
					...(current.schedule_type === "at" ? { ActionAfterCompletion: "DELETE" } : {}),
				}),
			);
			// Ensure schedule name is stored (in case it was missing)
			if (!current.eb_schedule_name) {
				await db.update(triggers).set({ eb_schedule_name: scheduleName }).where(eq(triggers.id, body.triggerId));
			}
			console.log(`[job-schedule-manager] Recreated EB schedule ${scheduleName} (trigger re-enabled)`);
		} catch (ebErr) {
			console.error(`[job-schedule-manager] Failed to recreate EB schedule on enable:`, ebErr);
		}
	} else if (isEnabled && current.eb_schedule_name) {
		// Still enabled, just updating other fields (expression, prompt, etc.)
		const target: Target = {
			Arn: targetArn,
			RoleArn: roleArn,
			Input: JSON.stringify({
				triggerId: current.id,
				triggerType: current.trigger_type,
				tenantId: current.tenant_id,
				agentId: current.agent_id,
				routineId: current.routine_id,
				prompt: body.prompt !== undefined ? body.prompt : current.prompt,
				scheduleName: current.eb_schedule_name!,
				oneTime: current.schedule_type === "at",
			}),
		};
		await schedulerClient.send(
			new UpdateScheduleCommand({
				Name: current.eb_schedule_name!,
				GroupName: SCHEDULE_GROUP,
				ScheduleExpression: expression,
				ScheduleExpressionTimezone: body.timezone ?? current.timezone ?? undefined,
				Target: target,
				FlexibleTimeWindow: { Mode: "OFF" },
				State: ScheduleState.ENABLED,
			}),
		);
	} else if (isEnabled && !current.eb_schedule_name) {
		// Repair path: the row was created (or left) without an EventBridge schedule.
		// This happens when the create-time provisioning call failed. Create the
		// schedule now so the automation can actually fire.
		await ensureScheduleGroup();
		const scheduleName = buildScheduleName(current.id, current.schedule_type === "at");
		const target: Target = {
			Arn: targetArn,
			RoleArn: roleArn,
			Input: JSON.stringify({
				triggerId: current.id,
				triggerType: current.trigger_type,
				tenantId: current.tenant_id,
				agentId: current.agent_id,
				routineId: current.routine_id,
				prompt: body.prompt !== undefined ? body.prompt : current.prompt,
				scheduleName,
				oneTime: current.schedule_type === "at",
			}),
		};
		await schedulerClient.send(
			new CreateScheduleCommand({
				Name: scheduleName,
				GroupName: SCHEDULE_GROUP,
				ScheduleExpression: expression,
				ScheduleExpressionTimezone: body.timezone ?? current.timezone ?? undefined,
				Target: target,
				FlexibleTimeWindow: { Mode: "OFF" },
				State: ScheduleState.ENABLED,
				Description: `Thinkwork ${current.trigger_type}: ${current.name || current.id}`,
				...(current.schedule_type === "at" ? { ActionAfterCompletion: "DELETE" } : {}),
			}),
		);
		await db
			.update(triggers)
			.set({ eb_schedule_name: scheduleName })
			.where(eq(triggers.id, body.triggerId));
		console.log(`[job-schedule-manager] Repaired missing EB schedule ${scheduleName} for trigger ${current.id}`);
	}

	console.log(`[job-schedule-manager] Updated job ${body.triggerId}`);
	return updated;
}

async function deleteJob(body: DeleteJobBody): Promise<void> {
	// Use the schedule name passed directly (avoids race with DB clear)
	// or fall back to reading from DB
	let scheduleName = (body as unknown as Record<string, unknown>).ebScheduleName as string | undefined;

	if (!scheduleName) {
		const db = getDb();
		const [job] = await db
			.select()
			.from(triggers)
			.where(eq(triggers.id, body.triggerId));
		scheduleName = job?.eb_schedule_name || undefined;
	}

	if (scheduleName) {
		try {
			await schedulerClient.send(
				new DeleteScheduleCommand({
					Name: scheduleName,
					GroupName: SCHEDULE_GROUP,
				}),
			);
			console.log(`[job-schedule-manager] Deleted EB schedule: ${scheduleName}`);
		} catch (deleteErr) {
			console.warn(`[job-schedule-manager] Failed to delete EB schedule:`, deleteErr);
		}
	}

	console.log(`[job-schedule-manager] Deleted trigger ${body.triggerId}`);
}

async function getJob(triggerId: string): Promise<Record<string, unknown> | null> {
	const db = getDb();
	const [job] = await db
		.select()
		.from(triggers)
		.where(eq(triggers.id, triggerId));
	return job || null;
}

async function listJobs(params: Record<string, string>): Promise<unknown[]> {
	const db = getDb();
	const conditions: ReturnType<typeof eq>[] = [];

	if (params.tenantId) conditions.push(eq(triggers.tenant_id, params.tenantId));
	if (params.agentId) conditions.push(eq(triggers.agent_id, params.agentId));
	if (params.routineId) conditions.push(eq(triggers.routine_id, params.routineId));
	if (params.triggerType) conditions.push(eq(triggers.trigger_type, params.triggerType));
	if (params.enabled !== undefined) conditions.push(eq(triggers.enabled, params.enabled === "true"));

	if (conditions.length === 0) {
		return [];
	}

	const rows = await db
		.select()
		.from(triggers)
		.where(and(...conditions))
		.limit(100);

	return rows;
}

// ─── Main Handler ─────────────────────────────────────────────────────────────

export async function handler(apigwEvent: ApiGwEvent): Promise<{
	statusCode: number;
	body: string;
	headers: Record<string, string>;
}> {
	const method = apigwEvent.requestContext?.http?.method ?? "POST";
	const path = apigwEvent.rawPath || "";

	// Auth
	if (!authenticate(apigwEvent.headers)) {
		return { statusCode: 401, body: JSON.stringify({ error: "Unauthorized" }), headers: JSON_HEADERS };
	}

	// Parse body for non-GET requests
	let body: Record<string, unknown> = {};
	if (method !== "GET") {
		try {
			body = JSON.parse(apigwEvent.body ?? "{}");
		} catch {
			return { statusCode: 400, body: JSON.stringify({ error: "Invalid JSON body" }), headers: JSON_HEADERS };
		}
	}

	try {
		// GET /api/job-schedules/:id
		const idMatch = path.match(/\/api\/job-schedules\/([^/]+)$/);
		if (method === "GET" && idMatch) {
			const job = await getJob(idMatch[1]);
			if (!job) return { statusCode: 404, body: JSON.stringify({ error: "Job not found" }), headers: JSON_HEADERS };
			return { statusCode: 200, body: JSON.stringify(job), headers: JSON_HEADERS };
		}

		// GET /api/job-schedules — list
		if (method === "GET") {
			const params = apigwEvent.queryStringParameters || {};
			const jobs = await listJobs(params);
			return { statusCode: 200, body: JSON.stringify({ jobs }), headers: JSON_HEADERS };
		}

		// POST /api/job-schedules — create
		if (method === "POST") {
			const req = body as unknown as CreateJobBody;
			if (!req.tenantId || !req.triggerType || !req.name || !req.scheduleType || !req.scheduleExpression) {
				return { statusCode: 400, body: JSON.stringify({ error: "tenantId, triggerType, name, scheduleType, and scheduleExpression are required" }), headers: JSON_HEADERS };
			}
			const result = await createJob(req);
			return { statusCode: 201, body: JSON.stringify({ ok: true, job: result }), headers: JSON_HEADERS };
		}

		// PUT /api/job-schedules — update
		if (method === "PUT") {
			const req = body as unknown as UpdateJobBody;
			if (!req.triggerId) {
				return { statusCode: 400, body: JSON.stringify({ error: "triggerId is required" }), headers: JSON_HEADERS };
			}
			const result = await updateJob(req);
			return { statusCode: 200, body: JSON.stringify({ ok: true, job: result }), headers: JSON_HEADERS };
		}

		// DELETE /api/job-schedules — delete
		if (method === "DELETE") {
			const req = body as unknown as DeleteJobBody;
			if (!req.triggerId) {
				return { statusCode: 400, body: JSON.stringify({ error: "triggerId is required" }), headers: JSON_HEADERS };
			}
			await deleteJob(req);
			return { statusCode: 200, body: JSON.stringify({ ok: true }), headers: JSON_HEADERS };
		}

		return { statusCode: 405, body: JSON.stringify({ error: "Method not allowed" }), headers: JSON_HEADERS };
	} catch (err: unknown) {
		const message = err instanceof Error ? err.message : String(err);
		console.error("[job-schedule-manager] Error:", message, err);
		return { statusCode: 500, body: JSON.stringify({ error: message }), headers: JSON_HEADERS };
	}
}
