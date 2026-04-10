/**
 * Shared utilities for GraphQL resolvers.
 *
 * Extracted from the monolithic graphql-resolver.ts to be shared across
 * the resolver modules (queries.ts, mutations.ts, types.ts).
 */

import { createHash, randomUUID, randomBytes } from "node:crypto";
import { eq, ne, and, asc, desc, lt, gt, gte, lte, sql, inArray } from "drizzle-orm";
import { getDb } from "@thinkwork/database-pg";
import {
	// Core
	tenants,
	tenantMembers,
	tenantSettings,
	users,
	userProfiles,
	// Agents
	agents,
	agentCapabilities,
	agentSkills,
	modelCatalog,
	// Messages
	messages,
	messageArtifacts,
	// Teams
	teams,
	teamAgents,
	teamUsers,
	// Routines
	routines,
	// Wakeup queue
	agentWakeupRequests,
	// Scheduled Jobs (unified)
	scheduledJobs,
	threadTurns,
	threadTurnEvents,
	// Threads
	threads,
	threadComments,
	threadLabels,
	threadAttachments,
	threadLabelAssignments,
	// Inbox Items
	inboxItems,
	inboxItemComments,
	inboxItemLinks,
	// Usage / Activity
	activityLog,
	// Agent API Keys
	agentApiKeys,
	// Cost Management (PRD-02)
	costEvents,
	budgetPolicies,
	// Knowledge Bases (PRD-13)
	knowledgeBases,
	agentKnowledgeBases,
	// Thread Dependencies (PRD-09)
	threadDependencies,
	// Artifacts
	artifacts,
	// Webhooks (PRD-19)
	webhooks,
	webhookIdempotency,
	// Quick Actions
	userQuickActions,
	// Recipes (PRD-26)
	recipes,
	// Agent Templates
	agentTemplates,
	agentVersions,
} from "@thinkwork/database-pg/schema";
import { checkAndFireUnblockWakeups } from "../lib/orchestration/thread-release.js";
import { generateSlug } from "@thinkwork/database-pg/utils/generate-slug";

// Re-export everything resolvers need
export {
	eq, ne, and, asc, desc, lt, gt, gte, lte, sql, inArray,
	randomUUID, randomBytes,
	tenants, tenantMembers, tenantSettings, users, userProfiles,
	agents, agentCapabilities, agentSkills, modelCatalog,
	messages, messageArtifacts,
	teams, teamAgents, teamUsers,
	routines, agentWakeupRequests,
	scheduledJobs, threadTurns, threadTurnEvents,
	threads, threadComments, threadLabels, threadAttachments, threadLabelAssignments,
	inboxItems, inboxItemComments, inboxItemLinks,
	activityLog, agentApiKeys,
	costEvents, budgetPolicies,
	knowledgeBases, agentKnowledgeBases,
	threadDependencies, artifacts,
	webhooks, webhookIdempotency,
	userQuickActions,
	recipes,
	agentTemplates, agentVersions,
	checkAndFireUnblockWakeups, generateSlug,
};

// ---------------------------------------------------------------------------
// Database
// ---------------------------------------------------------------------------

export const db = getDb();

// ---------------------------------------------------------------------------
// Chat Agent Invoke — resolved from SSM at cold start
// ---------------------------------------------------------------------------

let _chatAgentInvokeFnArn: string | null | undefined;
export async function getChatAgentInvokeFnArn(): Promise<string | null> {
	if (_chatAgentInvokeFnArn !== undefined) return _chatAgentInvokeFnArn;
	try {
		let stage = process.env.STAGE || process.env.STAGE || "";
		if (!stage && process.env.SST_RESOURCE_App) {
			try { stage = JSON.parse(process.env.SST_RESOURCE_App).stage; } catch {}
		}
		if (!stage) stage = "dev";
		const { SSMClient, GetParameterCommand } = await import("@aws-sdk/client-ssm");
		const ssm = new SSMClient({});
		const res = await ssm.send(new GetParameterCommand({
			Name: `/thinkwork/${stage}/chat-agent-invoke-fn-arn`,
		}));
		_chatAgentInvokeFnArn = res.Parameter?.Value || null;
	} catch {
		_chatAgentInvokeFnArn = null;
	}
	return _chatAgentInvokeFnArn;
}

// ---------------------------------------------------------------------------
// KB Manager Lambda — resolved from SSM at cold start
// ---------------------------------------------------------------------------

let _kbManagerFnArn: string | null | undefined;
export async function getKbManagerFnArn(): Promise<string | null> {
	if (_kbManagerFnArn !== undefined) return _kbManagerFnArn;
	try {
		let stage = process.env.STAGE || process.env.STAGE || "";
		if (!stage && process.env.SST_RESOURCE_App) {
			try { stage = JSON.parse(process.env.SST_RESOURCE_App).stage; } catch {}
		}
		if (!stage) stage = "dev";
		const { SSMClient, GetParameterCommand } = await import("@aws-sdk/client-ssm");
		const ssm = new SSMClient({});
		const res = await ssm.send(new GetParameterCommand({
			Name: `/thinkwork/${stage}/kb-manager-fn-arn`,
		}));
		_kbManagerFnArn = res.Parameter?.Value || null;
	} catch {
		_kbManagerFnArn = null;
	}
	return _kbManagerFnArn;
}

// ---------------------------------------------------------------------------
// Eval Runner Lambda — resolved from SSM at cold start
// ---------------------------------------------------------------------------

/** Fire-and-forget: invoke chat-agent-invoke Lambda for immediate agent response */
export async function invokeChatAgent(payload: {
	threadId: string;
	tenantId: string;
	agentId: string;
	userMessage: string;
	messageId: string;
}): Promise<boolean> {
	try {
		const fnArn = await getChatAgentInvokeFnArn();
		if (!fnArn) {
			console.warn("[graphql] Chat agent invoke ARN not found, falling back to wakeup queue");
			return false;
		}
		const { LambdaClient, InvokeCommand } = await import("@aws-sdk/client-lambda");
		const lambda = new LambdaClient({});
		await lambda.send(new InvokeCommand({
			FunctionName: fnArn,
			InvocationType: "Event",
			Payload: new TextEncoder().encode(JSON.stringify(payload)),
		}));
		console.log(`[sendMessage] Direct chat-agent-invoke fired for thread=${payload.threadId}`);
		return true;
	} catch (err) {
		console.error("[sendMessage] Failed to invoke chat-agent-invoke:", err);
		return false;
	}
}

// ---------------------------------------------------------------------------
// Job Schedule Manager — resolved from SSM at cold start
// ---------------------------------------------------------------------------

let _jobScheduleManagerFnArn: string | null | undefined;
export async function getJobScheduleManagerFnArn(): Promise<string | null> {
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

/** Fire-and-forget: create/update/delete a scheduled job via the manager Lambda */
export async function invokeJobScheduleManager(
	method: string,
	body: Record<string, unknown>,
): Promise<void> {
	try {
		const fnArn = await getJobScheduleManagerFnArn();
		if (!fnArn) {
			console.warn("[graphql] Job schedule manager ARN not found, skipping");
			return;
		}
		const { LambdaClient, InvokeCommand } = await import("@aws-sdk/client-lambda");
		const lambda = new LambdaClient({});
		await lambda.send(new InvokeCommand({
			FunctionName: fnArn,
			InvocationType: "Event",
			Payload: new TextEncoder().encode(JSON.stringify({
				body: JSON.stringify(body),
				requestContext: { http: { method } },
				rawPath: "/api/job-schedules",
				headers: {
					authorization: `Bearer ${process.env.API_AUTH_SECRET || ""}`,
				},
			})),
		}));
	} catch (err) {
		console.error("[graphql] Failed to invoke job schedule manager:", err);
	}
}

// ---------------------------------------------------------------------------
// Thread status transition map
// ---------------------------------------------------------------------------

export const VALID_TRANSITIONS: Record<string, string[]> = {
	backlog: ["todo", "in_progress", "cancelled"],
	todo: ["in_progress", "done", "backlog", "cancelled"],
	in_progress: ["todo", "in_review", "blocked", "done", "cancelled"],
	in_review: ["in_progress", "done", "cancelled"],
	blocked: ["in_progress", "todo", "cancelled"],
	done: ["in_progress"],
	cancelled: ["backlog", "todo"],
};

export function assertTransition(from: string, to: string): void {
	const allowed = VALID_TRANSITIONS[from];
	if (!allowed || !allowed.includes(to)) {
		throw new Error(`Invalid status transition: ${from} → ${to}`);
	}
}

// ---------------------------------------------------------------------------
// Inbox item status transition map
// ---------------------------------------------------------------------------

export const INBOX_ITEM_TRANSITIONS: Record<string, string[]> = {
	pending: ["approved", "rejected", "revision_requested", "cancelled"],
	revision_requested: ["pending", "cancelled"],
};

export function assertInboxItemTransition(from: string, to: string): void {
	const allowed = INBOX_ITEM_TRANSITIONS[from];
	if (!allowed || !allowed.includes(to)) {
		throw new Error(`Invalid inbox item transition: ${from} → ${to}`);
	}
}

export async function recordActivity(
	tenantId: string,
	actorType: string,
	actorId: string,
	action: string,
	entityType: string,
	entityId: string,
	changes?: Record<string, unknown>,
): Promise<void> {
	await db.insert(activityLog).values({
		tenant_id: tenantId,
		actor_type: actorType,
		actor_id: actorId,
		action,
		entity_type: entityType,
		entity_id: entityId,
		changes: changes ?? null,
	});
}

// ---------------------------------------------------------------------------
// Helpers: snake_case DB rows → camelCase GraphQL fields
// ---------------------------------------------------------------------------

const ENUM_FIELDS = new Set(["status", "priority", "type", "channel"]);

export function snakeToCamel(obj: Record<string, unknown>): Record<string, unknown> {
	const result: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(obj)) {
		const camelKey = key.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
		if (value instanceof Date) {
			result[camelKey] = value.toISOString();
		} else if (typeof value === "object" && value !== null) {
			// Both objects and arrays get JSON.stringify'd for AWSJSON scalar fields
			result[camelKey] = JSON.stringify(value);
		} else {
			result[camelKey] = value;
		}
	}
	return result;
}

export function threadToCamel(obj: Record<string, unknown>): Record<string, unknown> {
	const result = snakeToCamel(obj);
	for (const field of ENUM_FIELDS) {
		if (typeof result[field] === "string") {
			result[field] = (result[field] as string).toUpperCase();
		}
	}
	return result;
}

export function agentToCamel(obj: Record<string, unknown>): Record<string, unknown> {
	const result = snakeToCamel(obj);
	for (const field of ["status", "type"]) {
		if (typeof result[field] === "string") {
			result[field] = (result[field] as string).toUpperCase();
		}
	}
	return result;
}

export function messageToCamel(obj: Record<string, unknown>): Record<string, unknown> {
	const result = snakeToCamel(obj);
	if (typeof result.role === "string") {
		result.role = (result.role as string).toUpperCase();
	}
	return result;
}

export function artifactToCamel(obj: Record<string, unknown>): Record<string, unknown> {
	const result = snakeToCamel(obj);
	for (const field of ["type", "status"]) {
		if (typeof result[field] === "string") {
			result[field] = (result[field] as string).toUpperCase();
		}
	}
	return result;
}

export function recipeToCamel(obj: Record<string, unknown>): Record<string, unknown> {
	return snakeToCamel(obj);
}

export function inboxItemToCamel(obj: Record<string, unknown>): Record<string, unknown> {
	const result = snakeToCamel(obj);
	if (typeof result.status === "string") {
		result.status = (result.status as string).toUpperCase();
	}
	if (!result.comments) result.comments = [];
	if (!result.links) result.links = [];
	if (!result.linkedThreads) result.linkedThreads = [];
	return result;
}

export function apiKeyToCamel(obj: Record<string, unknown>): Record<string, unknown> {
	const result = snakeToCamel(obj);
	if (typeof result.keyHash === "string") {
		result.keyPrefix = (result.keyHash as string).slice(0, 8) + "...";
		delete result.keyHash;
	}
	return result;
}

const WORKFLOW_JSONB_FIELDS = new Set([
	"dispatch", "concurrency", "retry", "turnLoop", "workspace",
	"stallDetection", "orchestration", "sessionCompaction",
]);

export function workflowConfigToCamel(row: Record<string, unknown>): Record<string, unknown> {
	const camel = snakeToCamel(row);
	for (const field of WORKFLOW_JSONB_FIELDS) {
		if (typeof camel[field] === "string") {
			try { camel[field] = JSON.parse(camel[field] as string); } catch {}
		}
	}
	if (typeof camel.createdAt === "string" && !camel.createdAt.includes("T")) {
		camel.createdAt = new Date(camel.createdAt + "Z").toISOString();
	}
	if (typeof camel.updatedAt === "string" && !camel.updatedAt.includes("T")) {
		camel.updatedAt = new Date(camel.updatedAt + "Z").toISOString();
	}
	return camel;
}

export function hashToken(token: string): string {
	return createHash("sha256").update(token).digest("hex");
}

export function startOfMonth(): Date {
	const now = new Date();
	return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}
