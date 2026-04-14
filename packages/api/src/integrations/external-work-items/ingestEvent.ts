/**
 * Adapter-neutral webhook ingest pipeline.
 *
 * verifySignature → normalizeEvent → resolveConnection → refresh envelope →
 * ensureExternalTaskThread (with reassignment handoff on `task.reassigned`).
 *
 * Any provider that conforms to `ExternalWorkItemAdapter` drops into this
 * pipeline unchanged. Provider-specific logic lives inside the adapter.
 */

import { getDb, schema } from "@thinkwork/database-pg";
import { eq } from "drizzle-orm";
import { getAdapter, hasAdapter } from "./index.js";
import type {
	ExternalTaskEnvelope,
	NormalizedEvent,
	TaskProvider,
} from "./types.js";
import {
	resolveConnectionByProviderUserId,
	resolveOAuthToken,
} from "../../lib/oauth-token.js";
import {
	closeExternalTaskThread,
	ensureExternalTaskThread,
} from "./ensureExternalTaskThread.js";

const { messages } = schema;
const db = getDb();

/**
 * Pull the raw task object out of a NormalizedEvent's `raw` field for use
 * with `adapter.normalizeItem`. Handles both the real LastMile shape
 * (`raw.task`) and legacy fixture shapes (`raw.data.task`). Returns null
 * when nothing task-shaped is available — the caller falls back to the
 * placeholder title.
 */
function extractRawTask(
	raw: Record<string, unknown> | undefined,
): Record<string, unknown> | null {
	if (!raw || typeof raw !== "object") return null;
	const direct = raw.task;
	if (direct && typeof direct === "object" && !Array.isArray(direct)) {
		return direct as Record<string, unknown>;
	}
	const data = raw.data;
	if (data && typeof data === "object" && !Array.isArray(data)) {
		const nested = (data as Record<string, unknown>).task;
		if (nested && typeof nested === "object" && !Array.isArray(nested)) {
			return nested as Record<string, unknown>;
		}
	}
	return null;
}

export type IngestResult =
	| { status: "ignored"; reason: string }
	| { status: "unverified" }
	| { status: "unresolved_connection"; providerUserId?: string; event?: NormalizedEvent }
	| {
			status: "ok";
			threadId: string;
			created: boolean;
			event: NormalizedEvent;
			envelope?: ExternalTaskEnvelope;
	  };

/**
 * Pipeline for an inbound adapter webhook. The caller passes:
 * - `provider`, `rawBody`, `headers` — the raw request
 * - `tenantId` (optional) — scopes `resolveConnectionByProviderUserId` to a
 *   single tenant. Passed by the unified `/webhooks/{token}` dispatch where
 *   the webhook row already pinned down the tenant. Omit to scan all
 *   connections globally.
 * - `secret` (optional) — per-tenant signing secret forwarded to
 *   `adapter.verifySignature`. When absent, the adapter falls through to its
 *   env-var fallback or token-only auth per its own policy.
 */
export async function ingestExternalTaskEvent(args: {
	provider: string;
	rawBody: string;
	headers: Record<string, string>;
	tenantId?: string;
	secret?: string;
}): Promise<IngestResult> {
	const { provider, rawBody, headers, tenantId, secret } = args;

	if (!hasAdapter(provider)) {
		return { status: "ignored", reason: `unknown provider: ${provider}` };
	}
	const adapter = getAdapter(provider as TaskProvider);

	const ok = await adapter.verifySignature({ rawBody, headers, secret });
	if (!ok) return { status: "unverified" };

	const event = await adapter.normalizeEvent(rawBody);

	if (!event.providerUserId) {
		return { status: "unresolved_connection", event };
	}
	const conn = await resolveConnectionByProviderUserId(
		provider,
		event.providerUserId,
		tenantId,
	);
	if (!conn) {
		return {
			status: "unresolved_connection",
			providerUserId: event.providerUserId,
			event,
		};
	}

	const authToken =
		(await resolveOAuthToken(conn.connectionId, conn.tenantId, conn.providerId)) ?? undefined;

	let envelope: ExternalTaskEnvelope | undefined;
	try {
		envelope = await adapter.refresh({
			externalTaskId: event.externalTaskId,
			ctx: {
				tenantId: conn.tenantId,
				userId: conn.userId,
				connectionId: conn.connectionId,
				authToken,
			},
		});
	} catch (err) {
		console.warn(
			`[ingest:${provider}] refresh failed for ${event.externalTaskId}:`,
			(err as Error).message,
		);
	}

	// Fallback: if refresh() didn't produce an envelope (MCP unreachable,
	// no auth token, or the adapter just threw), synthesize one from the
	// raw webhook payload. Providers always embed the task object in the
	// event body, so we can normalize it directly without a round-trip.
	// This keeps the pinned ExternalTaskCard working and Phase A's
	// denormalization (title / status / priority / due_at / description)
	// populating even when the adapter's read path is offline.
	if (!envelope) {
		try {
			const rawTask = extractRawTask(event.raw);
			if (rawTask) {
				const item = adapter.normalizeItem(rawTask);
				const blocks = adapter.buildBlocks(item);
				envelope = {
					_type: "external_task",
					_source: {
						provider: provider as TaskProvider,
						tool: "webhook_payload_fallback",
						params: { externalTaskId: event.externalTaskId },
					},
					item,
					blocks,
					_refreshedAt: new Date().toISOString(),
				};
				console.log(
					`[ingest:${provider}] synthesized envelope from webhook payload for ${event.externalTaskId}`,
				);
			}
		} catch (err) {
			console.warn(
				`[ingest:${provider}] synthetic envelope build failed for ${event.externalTaskId}:`,
				(err as Error).message,
			);
		}
	}

	if (event.kind === "task.reassigned" && event.previousProviderUserId) {
		// Scope the previous-assignee lookup to the same tenant — reassignments
		// don't cross tenant boundaries and the global scan is expensive.
		const prevConn = await resolveConnectionByProviderUserId(
			provider,
			event.previousProviderUserId,
			conn.tenantId,
		);
		if (prevConn) {
			const closedThreadId = await closeExternalTaskThread({
				tenantId: prevConn.tenantId,
				provider: provider as TaskProvider,
				externalTaskId: event.externalTaskId,
				connectionId: prevConn.connectionId,
				reason: "reassigned",
			});
			if (closedThreadId) {
				await db.insert(messages).values({
					thread_id: closedThreadId,
					tenant_id: prevConn.tenantId,
					role: "system",
					content: `Task reassigned away from you; this thread has been closed.`,
					sender_type: "system",
					metadata: {
						kind: "external_task_handoff",
						provider,
						externalTaskId: event.externalTaskId,
					},
				});
			}
		}
	}

	const title = envelope?.item.core.title ?? `External task ${event.externalTaskId}`;
	const result = await ensureExternalTaskThread({
		tenantId: conn.tenantId,
		provider: provider as TaskProvider,
		externalTaskId: event.externalTaskId,
		connectionId: conn.connectionId,
		providerId: conn.providerId,
		providerUserId: event.providerUserId,
		userId: conn.userId,
		defaultAgentId: conn.defaultAgentId,
		title,
		envelope,
	});

	return {
		status: "ok",
		threadId: result.threadId,
		created: result.created,
		event,
		envelope,
	};
}
