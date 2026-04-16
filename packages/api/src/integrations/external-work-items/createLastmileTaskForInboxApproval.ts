/**
 * Inbox-item approval path: when the user approves a `create_task` inbox
 * item, run the LastMile `POST /tasks` call that the agent proposed,
 * stamp the thread's sync state on success, and let the caller wrap
 * the inbox-item mutation on failure.
 *
 * Mirrors the connection + PAT resolution from `syncExternalTaskOnCreate`
 * (and reuses the helpers exported there) so the two create paths stay
 * bit-for-bit aligned on auth / error handling. The difference: this
 * one takes the full `CreateTaskRequest` payload from inbox-item config
 * instead of building it from thread columns, and it uses the inbox-item
 * id as the idempotency key so re-approval (after a transient failure)
 * doesn't double-create.
 *
 * Intentionally does NOT mutate the inbox item row — the approval
 * resolver owns that lifecycle. This helper returns a discriminated
 * result and the caller decides whether to mark the item approved or
 * keep it pending with the error stored.
 */

import { eq } from "drizzle-orm";
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
	type CreateTaskRequest,
} from "./providers/lastmile/restClient.js";
import {
	findActiveTaskConnection,
	getProviderUserId,
	buildExternalMeta,
	writeSyncState,
} from "./syncExternalTaskOnCreate.js";

const { threads } = schema;

export type CreateLastmileTaskResult =
	| { status: "synced"; externalTaskId: string }
	| { status: "error"; message: string };

export interface CreateLastmileTaskForInboxApprovalArgs {
	/** Inbox item id — used as the LastMile idempotency key so
	 *  re-approval after a transient failure doesn't double-create. */
	inboxItemId: string;
	/** Thread the task belongs to — its sync_status/metadata gets stamped
	 *  on success so later webhook updates from LastMile upsert into the
	 *  same row instead of creating a duplicate. */
	threadId: string;
	tenantId: string;
	/** Thread creator — their LastMile connection / PAT is used to
	 *  authenticate the create call. */
	userId: string;
	input: CreateTaskRequest;
}

export async function createLastmileTaskForInboxApproval(
	args: CreateLastmileTaskForInboxApprovalArgs,
): Promise<CreateLastmileTaskResult> {
	const baseUrl = await getConnectorBaseUrl(args.tenantId, "lastmile");
	if (!isLastmileRestConfigured({ baseUrl })) {
		return {
			status: "error",
			message:
				"LastMile base URL not configured — set it on Connectors → LastMile.",
		};
	}

	const conn = await findActiveTaskConnection(args.tenantId, args.userId);
	if (!conn) {
		return {
			status: "error",
			message: "No active task connector for this user.",
		};
	}

	const authToken = await getOrMintLastmilePat({
		userId: args.userId,
		getFreshWorkosJwt: () =>
			resolveOAuthToken(conn.id, args.tenantId, conn.provider_id),
	});
	if (!authToken) {
		return {
			status: "error",
			message: `Task connector ${conn.provider_name} has no usable LastMile token — reconnect in Connectors.`,
		};
	}

	const providerUserId = getProviderUserId(conn);

	try {
		const lastmileTask = await restCreateTask({
			input: {
				...args.input,
				// Default the assignee to the thread creator's LastMile user id
				// when the caller didn't provide one explicitly — matches the
				// sync-on-create default so identical threads created via the
				// two paths look identical in LastMile.
				...(args.input.assigneeId
					? {}
					: providerUserId
					? { assigneeId: providerUserId }
					: {}),
			},
			idempotencyKey: `thinkwork-inbox-${args.inboxItemId}`,
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

		await writeSyncState(args.threadId, {
			kind: "synced",
			externalMeta: buildExternalMeta({
				lastmileTask,
				provider: conn.provider_name,
				connectionId: conn.id,
				providerId: conn.provider_id,
				providerUserId,
			}),
		});

		return { status: "synced", externalTaskId: lastmileTask.id };
	} catch (err) {
		let message: string;
		if (err instanceof LastmileRestError) {
			message = `[${err.code}] ${err.message}`;
			if (err.requestId) message += ` (request_id=${err.requestId})`;
		} else {
			message = (err as Error)?.message || "unknown error";
		}
		console.error(
			`[createLastmileTaskForInboxApproval] inbox ${args.inboxItemId} / thread ${args.threadId} failed:`,
			message,
		);
		return { status: "error", message };
	}
}

/** Lookup the thread's creator — needed to pick the right LastMile
 *  connection. Returns null if the thread doesn't exist or has no
 *  created_by_id (shouldn't happen for user-created threads but we
 *  guard it). */
export async function resolveThreadCreator(
	threadId: string,
): Promise<{ userId: string; tenantId: string } | null> {
	const [row] = await db
		.select({
			tenant_id: threads.tenant_id,
			created_by_id: threads.created_by_id,
		})
		.from(threads)
		.where(eq(threads.id, threadId));
	if (!row?.created_by_id || !row?.tenant_id) return null;
	return { userId: row.created_by_id, tenantId: row.tenant_id };
}
