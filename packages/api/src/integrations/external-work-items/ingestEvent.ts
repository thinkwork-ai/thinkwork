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

export type IngestResult =
	| { status: "ignored"; reason: string }
	| { status: "unverified" }
	| { status: "unresolved_connection"; providerUserId?: string }
	| {
			status: "ok";
			threadId: string;
			created: boolean;
			event: NormalizedEvent;
			envelope?: ExternalTaskEnvelope;
	  };

export async function ingestExternalTaskEvent(args: {
	provider: string;
	rawBody: string;
	headers: Record<string, string>;
}): Promise<IngestResult> {
	const { provider, rawBody, headers } = args;

	if (!hasAdapter(provider)) {
		return { status: "ignored", reason: `unknown provider: ${provider}` };
	}
	const adapter = getAdapter(provider as TaskProvider);

	const ok = await adapter.verifySignature({ rawBody, headers });
	if (!ok) return { status: "unverified" };

	const event = await adapter.normalizeEvent(rawBody);

	if (!event.providerUserId) {
		return { status: "unresolved_connection" };
	}
	const conn = await resolveConnectionByProviderUserId(provider, event.providerUserId);
	if (!conn) {
		return { status: "unresolved_connection", providerUserId: event.providerUserId };
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

	if (event.kind === "task.reassigned" && event.previousProviderUserId) {
		const prevConn = await resolveConnectionByProviderUserId(
			provider,
			event.previousProviderUserId,
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
