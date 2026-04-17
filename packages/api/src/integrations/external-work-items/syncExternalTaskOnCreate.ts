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
 *         ├── metadata.workflowId missing         → 'local'
 *         ├── connector has no OAuth token        → 'error'
 *         ├── workflow/statuses lookup throws     → 'error' + sync_error
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
	createWorkflowTask as restCreateWorkflowTask,
	getWorkflow as restGetWorkflow,
	listStatuses as restListStatuses,
	pickInitialStatus,
	isLastmileRestConfigured,
	validateWorkflowSkill,
	LastmileRestError,
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

/** Find the first active task-kind connector owned by the given user. */
async function findActiveTaskConnection(
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
function getProviderUserId(
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
async function writeSyncState(
	threadId: string,
	state:
		| { kind: "synced"; externalMeta: Record<string, unknown> }
		| { kind: "local"; reason: string }
		| { kind: "error"; message: string },
): Promise<void> {
	if (state.kind === "synced") {
		// Promote the externalTaskId to the first-class column (migration
		// 0008) for the hot correlation path. The rest of metadata.external
		// (provider, connectionId, latestEnvelope) stays in JSONB.
		const externalTaskId =
			typeof state.externalMeta.externalTaskId === "string"
				? (state.externalMeta.externalTaskId as string)
				: null;
		await db
			.update(threads)
			.set({
				sync_status: "synced",
				sync_error: null,
				...(externalTaskId ? { external_task_id: externalTaskId } : {}),
				// JSONB merge keeps the broader metadata.external block
				// available for downstream reads (latestEnvelope, provider,
				// etc.) — just not the primary lookup key anymore.
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
	/** LastMile `workflow_id`. Required — picked by the user in the
	 *  mobile workflow picker and passed through thread metadata. When
	 *  absent (e.g. task created from a code path that doesn't route
	 *  through the picker) we stamp `sync_status='local'` because the
	 *  LastMile POST requires `workflowId`, `taskTypeId`, and `teamId`
	 *  and we derive the latter two from the workflow record. */
	workflowId?: string;
	/** Optional — `'urgent' | 'high' | 'medium' | 'low'`. Forwarded
	 *  verbatim into the POST body. Supplied by `createLastmileTask`
	 *  from the intake form; other callers can omit. */
	priority?: string;
	/** Optional ISO-8601 date (YYYY-MM-DD). Empty/null means "no
	 *  deadline"; we drop the field from the POST body entirely rather
	 *  than send `null` (LastMile rejects the latter). */
	dueDate?: string | null;
	/** Optional — a LastMile user id (e.g. `user_wv4…`) to assign the
	 *  task to. When provided, overrides the creator-default.
	 *  `createLastmileTask` resolves this from a ThinkWork email before
	 *  calling; other callers should pass an already-resolved id. */
	assigneeProviderUserId?: string;
	/** Opaque form submission forwarded verbatim to LastMile's new
	 *  `POST /workflows/{id}/tasks` endpoint when the workflow has a
	 *  populated `skill` block. When absent, or when the workflow's
	 *  skill is missing/invalid/unknown schemaVersion, we fall back to
	 *  the legacy per-column `POST /tasks` path. */
	formResponse?: {
		form_id: string;
		values: Record<string, unknown>;
	};
	/** Creator email — required by the workflow-skill envelope. Resolved
	 *  by the caller (the resolver already has the thread creator on
	 *  hand). When absent, we can't build the envelope and fall back to
	 *  the legacy path even if `formResponse` is present. */
	creatorEmail?: string;
}

/** Idempotency key for the create call. Using the local thread id ensures
 *  a retry after a timeout doesn't create a duplicate task in LastMile,
 *  assuming LastMile honors the header. */
function idempotencyKeyForThread(threadId: string): string {
	return `thinkwork-thread-${threadId}`;
}

/** LastMile's `POST /tasks` rejects a bare `YYYY-MM-DD` with HTTP 500
 *  ("Failed query: ..." SQL error) but accepts full ISO-8601 datetimes.
 *  The form-card date field produces the short form, so coerce before
 *  sending. Any value that already has a `T` (or is null/undefined) is
 *  left alone. */
function normalizeDueDate(value: string | null | undefined): string | undefined {
	if (!value) return undefined;
	// Full ISO-8601 or anything with a time component — pass through.
	if (value.includes("T")) return value;
	// Plain `YYYY-MM-DD` → midnight UTC, explicit .000Z so the wire
	// format matches what our empirical probe showed works.
	if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
		return `${value}T00:00:00.000Z`;
	}
	return value;
}

/** Map the created LastMile task id into the metadata.external block that
 *  ensureExternalTaskThread expects. The POST /tasks response is minimal
 *  ({success, id}) so callers pass just the external id here; the
 *  broader row metadata gets hydrated on the next webhook/refresh. */
function buildExternalMeta(args: {
	externalTaskId: string;
	provider: string;
	connectionId: string;
	providerId: string;
	providerUserId: string | null;
}): Record<string, unknown> {
	const nowIso = new Date().toISOString();
	return {
		provider: args.provider,
		externalTaskId: args.externalTaskId,
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

	// `workflowId` is the required gate. The LastMile POST /tasks call
	// also needs `taskTypeId` + `teamId`, but both live on the workflow
	// record so we derive them rather than pushing the ask up to the
	// mobile picker. Absent workflow → stamp local (draft state, not
	// error — the user simply hasn't picked a workflow yet).
	if (!args.workflowId) {
		const reason =
			"Task will sync to LastMile once a workflow is picked.";
		await writeSyncState(args.threadId, { kind: "local", reason });
		return { status: "local", reason };
	}

	const ctx = {
		authToken,
		baseUrl,
		refreshToken: () =>
			forceRefreshLastmilePat({
				userId: args.userId,
				getFreshWorkosJwt: () =>
					forceRefreshLastmileUserToken(conn.id, args.tenantId),
			}),
	};

	try {
		const workflow = await restGetWorkflow({ workflowId: args.workflowId, ctx });

		// Dynamic workflow-skill path: when the workflow ships a populated
		// `skill` block with a `form` and the agent has collected a
		// `formResponse`, forward the envelope opaquely to
		// `POST /workflows/{id}/tasks`. LastMile owns the mapping from
		// `formResponse.values` to task columns / entity_data.
		const skillCheck = validateWorkflowSkill(workflow.skill);
		const canTakeDynamicPath =
			skillCheck.ok &&
			!!skillCheck.skill.form &&
			!!args.formResponse &&
			!!args.creatorEmail &&
			!!args.userId;

		if (canTakeDynamicPath && skillCheck.ok) {
			const created = await restCreateWorkflowTask({
				workflowId: args.workflowId,
				input: {
					workflowId: args.workflowId,
					threadId: args.threadId,
					threadTitle: args.title,
					formResponse: {
						form_id: args.formResponse!.form_id,
						values: args.formResponse!.values,
					},
					creator: {
						userId: args.userId,
						email: args.creatorEmail!,
					},
				},
				idempotencyKey: idempotencyKeyForThread(args.threadId),
				ctx,
			});

			const externalMeta = buildExternalMeta({
				externalTaskId: created.id,
				provider: conn.provider_name,
				connectionId: conn.id,
				providerId: conn.provider_id,
				providerUserId,
			});
			await writeSyncState(args.threadId, {
				kind: "synced",
				externalMeta,
			});
			return { status: "synced", externalTaskId: created.id };
		}

		// Fallback path — legacy `POST /tasks`. Also used when skill is
		// absent, unknown schemaVersion, invalid form, or the agent
		// didn't run the dynamic flow (no formResponse). Log the reason
		// so we can tell "this workflow has no skill yet" apart from
		// "the agent skipped the form".
		if (!skillCheck.ok) {
			console.warn("[lastmile.skill.fallback]", {
				reason: skillCheck.reason,
				workflowId: args.workflowId,
				tenantId: args.tenantId,
				threadId: args.threadId,
			});
		} else if (!args.formResponse) {
			console.warn("[lastmile.skill.fallback]", {
				reason: "form_response_missing",
				workflowId: args.workflowId,
				tenantId: args.tenantId,
				threadId: args.threadId,
			});
		}

		if (!workflow.taskTypeId) {
			const message = `LastMile workflow ${args.workflowId} has no taskTypeId — cannot create task.`;
			await writeSyncState(args.threadId, { kind: "error", message });
			return { status: "error", message };
		}
		const statuses = await restListStatuses({
			ctx,
			query: { workflowId: args.workflowId },
		});
		const initialStatus = pickInitialStatus(statuses);
		if (!initialStatus) {
			const message = `LastMile workflow ${args.workflowId} has no selectable status — cannot create task.`;
			await writeSyncState(args.threadId, { kind: "error", message });
			return { status: "error", message };
		}

		// Prefer the caller-supplied assignee (resolved from form data)
		// over the creator default. Empty string / undefined → fall back.
		const assigneeId =
			args.assigneeProviderUserId?.length
				? args.assigneeProviderUserId
				: providerUserId ?? undefined;

		// LastMile rejects a bare `YYYY-MM-DD` (HTTP 500) and expects
		// a full ISO-8601 datetime, so normalize date-only strings to
		// midnight UTC. A value that already has a `T` (agent passed
		// ISO) or clearly isn't a YYYY-MM-DD (e.g. spec-typical
		// AWSDateTime) is forwarded verbatim.
		const dueDate = normalizeDueDate(args.dueDate);

		const created = await restCreateTask({
			input: {
				title: args.title,
				statusId: initialStatus.id,
				workflowId: args.workflowId,
				taskTypeId: workflow.taskTypeId,
				teamId: workflow.teamId,
				description: args.description ?? undefined,
				...(assigneeId ? { assigneeId } : {}),
				...(args.priority ? { priority: args.priority } : {}),
				...(dueDate ? { dueDate } : {}),
			},
			idempotencyKey: idempotencyKeyForThread(args.threadId),
			ctx,
		});

		const externalMeta = buildExternalMeta({
			externalTaskId: created.id,
			provider: conn.provider_name,
			connectionId: conn.id,
			providerId: conn.provider_id,
			providerUserId,
		});
		await writeSyncState(args.threadId, {
			kind: "synced",
			externalMeta,
		});
		return { status: "synced", externalTaskId: created.id };
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
