/**
 * Outbound sync: push a ThinkWork-created task row to the external task
 * system (today, LastMile). Called from the `createThread` resolver when a
 * user creates a task from the mobile Tasks footer, and from the
 * `retryTaskSync` mutation to re-fire after a transient failure.
 *
 * Behavior contract — this function MUST NOT throw. A failure to reach the
 * external system should leave the local thread in `sync_status='error'`
 * with the error message in `sync_error`, so the mobile UI can surface a
 * retry affordance. The local row is always preserved.
 *
 * Sync state machine:
 *
 *   create thread → sync_status='pending' (set upstream by createThread)
 *         │
 *         ├── LASTMILE_TASKS_API_URL unset        → 'local'
 *         ├── no active task connector            → 'local'
 *         ├── connector has no OAuth token        → 'error'
 *         ├── restClient.createTask() throws      → 'error' + sync_error
 *         └── success                             → 'synced' + metadata.external
 *
 * On success the thread's `metadata.external` block is populated using the
 * same shape the webhook ingest path uses (see ensureExternalTaskThread),
 * so later webhook updates from LastMile will upsert into the same row
 * instead of creating a duplicate.
 */

import { and, eq, sql } from "drizzle-orm";
import { schema } from "@thinkwork/database-pg";
import { db } from "../../lib/db.js";
import {
	resolveOAuthToken,
	forceRefreshLastmileUserToken,
} from "../../lib/oauth-token.js";
import {
	getOrMintLastmilePat,
	forceRefreshLastmilePat,
} from "../../lib/lastmile-pat.js";
import { getConnectorBaseUrl } from "../../handlers/task-connectors.js";
import {
	createTask as restCreateTask,
	isLastmileRestConfigured,
	LastmileRestError,
	type LastmileTask,
} from "./providers/lastmile/restClient.js";

const { threads, connections, connectProviders } = schema;

export type SyncExternalTaskResult =
	| { status: "synced"; externalTaskId: string }
	| { status: "local"; reason: string }
	| { status: "error"; message: string };

type ActiveTaskConnection = {
	id: string;
	provider_id: string;
	provider_name: string;
	metadata: Record<string, unknown> | null;
};

/** Find the first active task-kind connector owned by the given user.
 *  Exported so sibling flows (e.g. the `create_task` inbox-item approval
 *  path) can reuse the exact same connection-lookup semantics. */
export async function findActiveTaskConnection(
	tenantId: string,
	userId: string,
): Promise<ActiveTaskConnection | null> {
	const [row] = await db
		.select({
			id: connections.id,
			provider_id: connections.provider_id,
			provider_name: connectProviders.name,
			provider_type: connectProviders.provider_type,
			metadata: connections.metadata,
		})
		.from(connections)
		.innerJoin(connectProviders, eq(connections.provider_id, connectProviders.id))
		.where(
			and(
				eq(connections.tenant_id, tenantId),
				eq(connections.user_id, userId),
				eq(connections.status, "active"),
				eq(connectProviders.provider_type, "task"),
			),
		)
		.limit(1);
	if (!row) return null;
	return {
		id: row.id,
		provider_id: row.provider_id,
		provider_name: row.provider_name,
		metadata: (row.metadata as Record<string, unknown> | null) ?? null,
	};
}

/** Pull the LastMile user id out of the connection metadata. Written by
 *  the post-OAuth hook in `skills.ts` during the initial MCP `user_whoami`
 *  call. Returns null if not set. */
export function getProviderUserId(
	conn: ActiveTaskConnection,
): string | null {
	const meta = conn.metadata ?? {};
	const providerBlock = (meta[conn.provider_name] as Record<string, unknown> | undefined) ?? {};
	const id = providerBlock.userId;
	return typeof id === "string" && id.length > 0 ? id : null;
}

/** Write the terminal sync state + metadata.external onto the thread row.
 *  Always merges with the row's existing metadata so we don't clobber
 *  anything the create path already set (labels, workspace targeting, etc.). */
export async function writeSyncState(
	threadId: string,
	state:
		| { kind: "synced"; externalMeta: Record<string, unknown> }
		| { kind: "local"; reason: string }
		| { kind: "error"; message: string },
): Promise<void> {
	if (state.kind === "synced") {
		await db
			.update(threads)
			.set({
				sync_status: "synced",
				sync_error: null,
				// JSONB merge of metadata.external into the existing metadata
				// column. We write the whole external block as a sub-object
				// so ensureExternalTaskThread's lookup query (which reads
				// metadata->'external'->>'externalTaskId') finds it on the
				// next inbound webhook.
				metadata: sql`COALESCE(${threads.metadata}, '{}'::jsonb) || ${JSON.stringify({ external: state.externalMeta })}::jsonb`,
				updated_at: new Date(),
			})
			.where(eq(threads.id, threadId));
		return;
	}
	if (state.kind === "local") {
		await db
			.update(threads)
			.set({
				sync_status: "local",
				sync_error: state.reason,
				updated_at: new Date(),
			})
			.where(eq(threads.id, threadId));
		return;
	}
	await db
		.update(threads)
		.set({
			sync_status: "error",
			sync_error: state.message.slice(0, 1000),
			updated_at: new Date(),
		})
		.where(eq(threads.id, threadId));
}

export interface SyncExternalTaskOnCreateArgs {
	threadId: string;
	tenantId: string;
	/** DB user id of the creator — used to find their task connector. */
	userId: string;
	title: string;
	description?: string | null;
	/** Local identifier like "TASK-82" used in the `source.external_ref`
	 *  field on the LastMile create request so the remote task traces
	 *  back to our local row. */
	externalRef?: string;
	/** LastMile workflow_id — retained in thread metadata for UI display
	 *  ("this task belongs to Workflow X") but NOT sent in the create
	 *  body: the OpenAPI v1.0.0 `/tasks` POST no longer accepts it. */
	workflowId?: string;
	/** LastMile terminal id — required by the create API. Missing until
	 *  the mobile terminal-picker ships. */
	terminalId?: string;
}

/** Idempotency key for the create call. Using the local thread id ensures
 *  a retry after a timeout doesn't create a duplicate task in LastMile,
 *  assuming LastMile honors the header. */
function idempotencyKeyForThread(threadId: string): string {
	return `thinkwork-thread-${threadId}`;
}

/** Map a successful LastmileTask response into the metadata.external
 *  block that ensureExternalTaskThread expects. */
export function buildExternalMeta(args: {
	lastmileTask: LastmileTask;
	provider: string;
	connectionId: string;
	providerId: string;
	providerUserId: string | null;
}): Record<string, unknown> {
	const nowIso = new Date().toISOString();
	return {
		provider: args.provider,
		externalTaskId: args.lastmileTask.id,
		connectionId: args.connectionId,
		providerId: args.providerId,
		providerUserId: args.providerUserId ?? undefined,
		createdAt: nowIso,
		lastUpdatedAt: nowIso,
	};
}

export async function syncExternalTaskOnCreate(
	args: SyncExternalTaskOnCreateArgs,
): Promise<SyncExternalTaskResult> {
	// Feature flag: read the per-tenant baseUrl from webhooks.config (set
	// via the admin Connectors UI) or fall back to LASTMILE_TASKS_API_URL.
	// If neither is set, stamp local — expected state until the connector
	// is configured.
	const baseUrl = await getConnectorBaseUrl(args.tenantId, "lastmile");
	if (!isLastmileRestConfigured({ baseUrl })) {
		const reason =
			"LastMile base URL not configured — set it on Connectors → LastMile, or wire LASTMILE_TASKS_API_URL as a fallback.";
		await writeSyncState(args.threadId, { kind: "local", reason });
		return { status: "local", reason };
	}

	const conn = await findActiveTaskConnection(args.tenantId, args.userId);
	if (!conn) {
		const reason = "No active task connector for this user.";
		await writeSyncState(args.threadId, { kind: "local", reason });
		return { status: "local", reason };
	}

	// Prefer the LastMile PAT path (cached, long-lived, bypasses Clerk
	// lookup) over raw WorkOS JWT. Mint lazily from the user's WorkOS
	// token; cached in SSM per-user for reuse.
	const authToken = await getOrMintLastmilePat({
		userId: args.userId,
		getFreshWorkosJwt: () =>
			resolveOAuthToken(conn.id, args.tenantId, conn.provider_id),
	});
	if (!authToken) {
		const message = `Task connector ${conn.provider_name} has no usable LastMile token — reconnect in Connectors.`;
		await writeSyncState(args.threadId, { kind: "error", message });
		return { status: "error", message };
	}

	const providerUserId = getProviderUserId(conn);

	// Per the LastMile OpenAPI v1.0.0 spec, `POST /tasks` requires
	// `terminalId`. Thread creation is now agent-driven: the user types
	// free-form intent, the agent gathers terminal + details, and the
	// actual create fires later via the `tasks_create` tool (Phase 2).
	// At thread-create time a missing terminalId is the expected state,
	// not an error — stamp `local` so the UI shows a "draft" affordance
	// instead of a red sync-failed badge.
	if (!args.terminalId) {
		const reason =
			"Task will sync to LastMile once the agent has gathered enough context.";
		await writeSyncState(args.threadId, { kind: "local", reason });
		return { status: "local", reason };
	}

	try {
		const lastmileTask = await restCreateTask({
			input: {
				title: args.title,
				terminalId: args.terminalId,
				description: args.description ?? undefined,
				...(providerUserId ? { assigneeId: providerUserId } : {}),
			},
			idempotencyKey: idempotencyKeyForThread(args.threadId),
			ctx: {
				authToken,
				baseUrl,
				refreshToken: () =>
					forceRefreshLastmilePat({
						userId: args.userId,
						getFreshWorkosJwt: () =>
							forceRefreshLastmileUserToken(conn.id, args.tenantId),
					}),
			},
		});

		const externalMeta = buildExternalMeta({
			lastmileTask,
			provider: conn.provider_name,
			connectionId: conn.id,
			providerId: conn.provider_id,
			providerUserId,
		});
		await writeSyncState(args.threadId, {
			kind: "synced",
			externalMeta,
		});
		return { status: "synced", externalTaskId: lastmileTask.id };
	} catch (err) {
		// Format the error for sync_error. LastmileRestError already has
		// useful fields; anything else gets `.message` only.
		let message: string;
		if (err instanceof LastmileRestError) {
			message = `[${err.code}] ${err.message}`;
			if (err.requestId) message += ` (request_id=${err.requestId})`;
		} else {
			message = (err as Error)?.message || "unknown error";
		}
		console.error(
			`[syncExternalTaskOnCreate] thread ${args.threadId} failed:`,
			message,
		);
		await writeSyncState(args.threadId, { kind: "error", message });
		return { status: "error", message };
	}
}
