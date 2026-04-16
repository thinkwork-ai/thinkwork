/**
 * createLastmileTask — user-created task thread finalizer.
 *
 * Kicks off the actual `POST /tasks` on LastMile after the agent has
 * collected intake details (description / priority / dueDate / assignee)
 * via the `lastmile-tasks.present_form` → `form_response` → `create_task`
 * flow. See `packages/skill-catalog/lastmile-tasks/SKILL.md` for the
 * agent-side contract.
 *
 * Workflow:
 *   1. Authz: resolve the caller's tenant + user (either the thread
 *      creator or any tenant member with access to the thread).
 *   2. Idempotency: if the thread already has
 *      `metadata.external.externalTaskId`, short-circuit and return the
 *      current row — re-running the agent shouldn't double-create.
 *   3. Resolve the assignee email (optional) to a LastMile providerUserId
 *      by chaining `users.email` → the user's LastMile connection →
 *      `connection.metadata.lastmile.userId`. Soft-fail if any link is
 *      missing; fall back to the thread creator as before.
 *   4. Delegate to `syncExternalTaskOnCreate`, which does the workflow /
 *      status derivation, POST, and thread-row stamping.
 */

import { and, eq } from "drizzle-orm";
import { schema } from "@thinkwork/database-pg";
import type { GraphQLContext } from "../../context.js";
import { db, threadToCamel } from "../../utils.js";
import { syncExternalTaskOnCreate } from "../../../integrations/external-work-items/syncExternalTaskOnCreate.js";

const { threads, users, connections, connectProviders } = schema;

interface CreateLastmileTaskInput {
	threadId: string;
	description?: string | null;
	priority?: string | null;
	dueDate?: string | null;
	assigneeEmail?: string | null;
}

/** Chain: email → users.id → (first) active LastMile task connection →
 *  `connection.metadata.lastmile.userId`. Returns null on any missing
 *  link so the caller can cleanly fall back. */
async function resolveAssigneeProviderUserId(
	tenantId: string,
	email: string,
): Promise<string | null> {
	const [user] = await db
		.select({ id: users.id })
		.from(users)
		.where(eq(users.email, email));
	if (!user?.id) return null;

	const [conn] = await db
		.select({ metadata: connections.metadata, provider_name: connectProviders.name })
		.from(connections)
		.innerJoin(connectProviders, eq(connections.provider_id, connectProviders.id))
		.where(
			and(
				eq(connections.tenant_id, tenantId),
				eq(connections.user_id, user.id),
				eq(connections.status, "active"),
				eq(connectProviders.provider_type, "task"),
			),
		)
		.limit(1);
	if (!conn) return null;

	const meta = (conn.metadata as Record<string, unknown> | null) ?? {};
	const providerBlock = (meta[conn.provider_name] as Record<string, unknown> | undefined) ?? {};
	const id = providerBlock.userId;
	return typeof id === "string" && id.length > 0 ? id : null;
}

function extractExternalTaskId(metadata: unknown): string | null {
	if (!metadata || typeof metadata !== "object") return null;
	const external = (metadata as Record<string, unknown>).external as Record<string, unknown> | undefined;
	const id = external?.externalTaskId;
	return typeof id === "string" && id.length > 0 ? id : null;
}

export const createLastmileTask = async (
	_parent: unknown,
	args: { input: CreateLastmileTaskInput },
	ctx: GraphQLContext,
) => {
	// Auth — accept two shapes: a Cognito JWT caller (mobile users,
	// rare at thread-create time) or API-key + `x-tenant-id` (the
	// agent skill path). We don't need the caller's user id here: the
	// LastMile connection we use belongs to the thread's creator
	// regardless of who's finalizing the task.
	const tenantId = ctx.auth.tenantId;
	if (!tenantId) {
		throw new Error(
			"Unauthorized: tenant not resolved (expected x-tenant-id header or a tenant-scoped JWT)",
		);
	}

	const { threadId } = args.input;
	if (!threadId) throw new Error("threadId is required");

	const [thread] = await db.select().from(threads).where(eq(threads.id, threadId));
	if (!thread) throw new Error(`Thread ${threadId} not found`);
	if (thread.tenant_id !== tenantId) throw new Error("Thread does not belong to caller's tenant");

	// Idempotency — if a prior run already minted the LastMile task,
	// re-emit the current row without re-POSTing. The mobile/agent path
	// can safely retry `create_task` in this shape.
	if (extractExternalTaskId(thread.metadata)) {
		return { ...threadToCamel(thread), commentCount: 0, childCount: 0 };
	}

	const rowMeta = (thread.metadata ?? {}) as Record<string, unknown>;
	const workflowId =
		typeof rowMeta.workflowId === "string" ? rowMeta.workflowId : undefined;
	if (!workflowId) {
		throw new Error(
			`Thread ${threadId} has no metadata.workflowId — pick a workflow before creating the LastMile task.`,
		);
	}

	// Email is optional. Empty string → creator default.
	let assigneeProviderUserId: string | undefined;
	const assigneeEmail = args.input.assigneeEmail?.trim();
	if (assigneeEmail) {
		const resolved = await resolveAssigneeProviderUserId(tenantId, assigneeEmail);
		if (resolved) assigneeProviderUserId = resolved;
		// Silent fallback: if we can't map the email we let the creator
		// default kick in rather than blocking the create. The agent's
		// summary will reflect whatever LastMile ultimately accepted.
	}

	if (!thread.created_by_id) {
		throw new Error(
			`Thread ${threadId} has no created_by_id — cannot resolve a LastMile connection to act on.`,
		);
	}
	const creatorId = thread.created_by_id;
	const result = await syncExternalTaskOnCreate({
		threadId,
		tenantId,
		userId: creatorId,
		title: thread.title,
		description: args.input.description ?? thread.description ?? undefined,
		externalRef: thread.identifier ?? undefined,
		workflowId,
		priority: args.input.priority ?? undefined,
		dueDate: args.input.dueDate ?? undefined,
		assigneeProviderUserId,
	});
	if (result.status === "error") {
		throw new Error(result.message);
	}

	// Re-read so the returned row reflects the final sync_status +
	// metadata.external that `syncExternalTaskOnCreate` stamped.
	const [reconciled] = await db.select().from(threads).where(eq(threads.id, threadId));
	if (!reconciled) throw new Error("Thread vanished between write and re-read");
	return { ...threadToCamel(reconciled), commentCount: 0, childCount: 0 };
};
