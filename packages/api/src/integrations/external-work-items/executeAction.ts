/**
 * External-task action orchestrator.
 *
 * Thin wrapper used by the GraphQL resolver. Keeps the resolver free of
 * capability + thread + connection lookup so unit tests can call this
 * directly without a full GraphQL context.
 *
 * Pipeline: thread lookup → capability check → resolve OAuth token →
 * adapter.executeAction → persist latest envelope + audit → return result.
 */

import { eq } from "drizzle-orm";
import { getDb, schema } from "@thinkwork/database-pg";
import type {
	ExternalTaskEnvelope,
	TaskActionType,
	TaskProvider,
} from "./types.js";
import { getAdapter, hasAdapter } from "./index.js";
import {
	resolveOAuthToken,
	resolveLastmileTasksMcpServer,
} from "../../lib/oauth-token.js";

const { threads, messages } = schema;
const db = getDb();

export type ExecuteExternalTaskActionArgs = {
	threadId: string;
	actionType: TaskActionType;
	params: Record<string, unknown>;
	tenantId: string;
	principalId: string;
};

export type ExecuteExternalTaskActionResult = {
	envelope: ExternalTaskEnvelope;
	threadId: string;
	auditMessageId: string | null;
};

type ThreadExternalMeta = {
	provider: TaskProvider;
	externalTaskId: string;
	connectionId: string;
	providerId?: string;
	latestEnvelope?: ExternalTaskEnvelope;
};

function capabilityFor(actionType: TaskActionType): keyof {
	updateStatus: true;
	assignTask: true;
	commentOnTask: true;
	editTaskFields: true;
	getTask: true;
} {
	switch (actionType) {
		case "external_task.update_status":
			return "updateStatus";
		case "external_task.assign":
			return "assignTask";
		case "external_task.comment":
			return "commentOnTask";
		case "external_task.edit_fields":
			return "editTaskFields";
		case "external_task.refresh":
			return "getTask";
	}
}

function summarizeAction(actionType: TaskActionType, params: Record<string, unknown>, taskTitle: string): string {
	switch (actionType) {
		case "external_task.update_status": {
			const next = String(params.value ?? params.status ?? "");
			return `Status changed to ${next || "(unset)"} on "${taskTitle}"`;
		}
		case "external_task.assign": {
			const who = String(params.userId ?? params.assignee ?? params.value ?? "");
			return `Assigned "${taskTitle}" to ${who || "(unset)"}`;
		}
		case "external_task.comment":
			return `Commented on "${taskTitle}"`;
		case "external_task.edit_fields":
			return `Edited fields on "${taskTitle}"`;
		case "external_task.refresh":
			return `Refreshed "${taskTitle}"`;
	}
}

export async function executeExternalTaskAction(
	args: ExecuteExternalTaskActionArgs,
): Promise<ExecuteExternalTaskActionResult> {
	const { threadId, actionType, params, tenantId, principalId } = args;

	const [thread] = await db.select().from(threads).where(eq(threads.id, threadId));
	if (!thread) throw new Error(`Thread not found: ${threadId}`);
	if (thread.tenant_id !== tenantId) {
		throw new Error("Thread does not belong to the authenticated tenant");
	}

	const meta = (thread.metadata ?? {}) as Record<string, unknown>;
	const external = (meta.external ?? undefined) as ThreadExternalMeta | undefined;
	if (!external?.provider || !external?.externalTaskId || !external?.connectionId) {
		throw new Error(
			`Thread ${threadId} has no external task linkage (metadata.external is missing provider/externalTaskId/connectionId)`,
		);
	}
	if (!hasAdapter(external.provider)) {
		throw new Error(`No adapter registered for provider: ${external.provider}`);
	}
	const adapter = getAdapter(external.provider);

	if (external.latestEnvelope) {
		const cap = capabilityFor(actionType);
		const allowed = external.latestEnvelope.item?.capabilities?.[cap];
		if (allowed === false) {
			throw new Error(`Action ${actionType} not permitted by current task capabilities`);
		}
	}

	if (!external.providerId) {
		throw new Error(
			`Thread metadata is missing external.providerId; re-link the thread with provider id for OAuth resolution`,
		);
	}
	const [authToken, tasksMcp] = await Promise.all([
		resolveOAuthToken(external.connectionId, tenantId, external.providerId),
		external.provider === "lastmile"
			? resolveLastmileTasksMcpServer(tenantId)
			: Promise.resolve(null),
	]);
	if (!authToken) {
		throw new Error(`Could not resolve OAuth token for connection ${external.connectionId}`);
	}
	if (external.provider === "lastmile" && !tasksMcp) {
		throw new Error(
			`No LastMile Tasks MCP server configured for tenant ${tenantId} — reconnect LastMile`,
		);
	}

	const envelope = await adapter.executeAction({
		actionType,
		externalTaskId: external.externalTaskId,
		params,
		ctx: {
			tenantId,
			userId: principalId,
			connectionId: external.connectionId,
			authToken,
			mcpServerUrl: tasksMcp?.url,
		},
	});

	const nextMeta = {
		...meta,
		external: {
			...external,
			latestEnvelope: envelope,
			lastUpdatedAt: new Date().toISOString(),
		},
	};
	await db
		.update(threads)
		.set({ metadata: nextMeta, updated_at: new Date() })
		.where(eq(threads.id, threadId));

	const summary = summarizeAction(actionType, params, envelope.item.core.title);
	const [auditMsg] = await db
		.insert(messages)
		.values({
			thread_id: threadId,
			tenant_id: tenantId,
			role: "system",
			content: summary,
			sender_type: "system",
			metadata: {
				kind: "external_task_action",
				actionType,
				provider: external.provider,
				externalTaskId: external.externalTaskId,
				actor: principalId,
			},
		})
		.returning({ id: messages.id });

	return {
		envelope,
		threadId,
		auditMessageId: auditMsg?.id ?? null,
	};
}
