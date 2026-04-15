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
				// Build the edit form schema so action buttons (Change
				// status / Assign / Edit) that reference formId='form_edit'
				// can render their form — otherwise the card shows
				// "Form form_edit not found on this task" and clicks no-op.
				const editForm = adapter.buildFormSchema(item);
				item.forms = { ...(item.forms ?? {}), edit: editForm };
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

	// Insert a system activity-timeline entry so the user sees what changed.
	// Mirrors the audit-message pattern in executeAction.ts but with
	// metadata.kind = "external_task_event". Returns null for noisy events
	// (task.created, unknown kinds, field-only changes to updated_at/etc.)
	// — in those cases we skip the insert entirely.
	const summary = summarizeWebhookEvent(event, envelope);
	if (summary) {
		try {
			await db.insert(messages).values({
				thread_id: result.threadId,
				tenant_id: conn.tenantId,
				role: "system",
				content: summary,
				sender_type: "system",
				metadata: {
					kind: "external_task_event",
					eventKind: event.kind,
					provider,
					externalTaskId: event.externalTaskId,
					providerEventId: event.providerEventId,
				},
			});
		} catch (err) {
			console.warn(
				`[ingest:${provider}] activity message insert failed for ${event.externalTaskId}:`,
				(err as Error).message,
			);
		}
	}

	return {
		status: "ok",
		threadId: result.threadId,
		created: result.created,
		event,
		envelope,
	};
}

// ---------------------------------------------------------------------------
// summarizeWebhookEvent
// ---------------------------------------------------------------------------

const NOISE_PROPERTY_KEYS = new Set([
	"updated_at",
	"updatedAt",
	"viewed_at",
	"viewedAt",
	"last_viewed_at",
	"lastViewedAt",
]);

const PROPERTY_LABELS: Record<string, string> = {
	status: "status",
	status_id: "status",
	priority: "priority",
	priority_id: "priority",
	due_at: "due date",
	due_date: "due date",
	dueAt: "due date",
	assignee: "assignee",
	assignee_id: "assignee",
	title: "title",
	description: "description",
};

function toStringArray(v: unknown): string[] | null {
	if (!Array.isArray(v)) return null;
	const out: string[] = [];
	for (const item of v) {
		if (typeof item === "string" && item.length > 0) out.push(item);
	}
	return out.length > 0 ? out : null;
}

function propertyLabel(key: string): string {
	return PROPERTY_LABELS[key] ?? key.replace(/_/g, " ");
}

/**
 * Extract a list of changed property keys from the raw webhook envelope.
 * LastMile doesn't use a single canonical field — different deliveries
 * carry `propertiesUpdated`, `properties_updated`, `changed`, or `changes`.
 * We try each in order and fall back to null.
 */
function extractChangedKeys(
	raw: Record<string, unknown> | undefined,
): string[] | null {
	if (!raw) return null;
	const candidates: unknown[] = [
		raw.propertiesUpdated,
		raw.properties_updated,
		raw.changed,
		raw.changes,
	];
	// `data` wrapper for legacy fixtures.
	const data =
		raw.data && typeof raw.data === "object" && !Array.isArray(raw.data)
			? (raw.data as Record<string, unknown>)
			: undefined;
	if (data) {
		candidates.push(
			data.propertiesUpdated,
			data.properties_updated,
			data.changed,
			data.changes,
		);
	}
	for (const c of candidates) {
		const arr = toStringArray(c);
		if (arr) return arr;
		// `changes` sometimes arrives as an object { field: { from, to } }.
		if (c && typeof c === "object" && !Array.isArray(c)) {
			const keys = Object.keys(c as Record<string, unknown>);
			if (keys.length > 0) return keys;
		}
	}
	return null;
}

/**
 * Pull a comment body out of a LastMile webhook envelope. Supports the
 * common shapes: `comment.body`, `comment.text`, `data.comment.body`.
 */
function extractCommentBody(
	raw: Record<string, unknown> | undefined,
): { actor?: string; body?: string } {
	if (!raw) return {};
	const comment =
		(raw.comment && typeof raw.comment === "object"
			? (raw.comment as Record<string, unknown>)
			: undefined) ??
		(raw.data &&
		typeof raw.data === "object" &&
		!Array.isArray(raw.data) &&
		(raw.data as Record<string, unknown>).comment &&
		typeof (raw.data as Record<string, unknown>).comment === "object"
			? ((raw.data as Record<string, unknown>).comment as Record<string, unknown>)
			: undefined);
	if (!comment) return {};
	const body =
		(typeof comment.body === "string" && comment.body) ||
		(typeof comment.text === "string" && comment.text) ||
		undefined;
	const author =
		comment.author && typeof comment.author === "object"
			? (comment.author as Record<string, unknown>)
			: undefined;
	const actor =
		(typeof comment.author_name === "string" && comment.author_name) ||
		(author && typeof author.name === "string" && author.name) ||
		(author && typeof author.display_name === "string" && author.display_name) ||
		undefined;
	return { actor, body };
}

/**
 * Build a human-readable summary line for an inbound webhook event.
 * Returns `null` for noisy events we'd rather skip. Callers MUST treat
 * `null` as "don't insert a message" rather than inserting an empty row.
 */
export function summarizeWebhookEvent(
	event: NormalizedEvent,
	envelope?: ExternalTaskEnvelope,
): string | null {
	switch (event.kind) {
		case "task.created":
			// The thread creation itself is the implicit "created" signal.
			return null;

		case "task.reassigned":
		case "task.assigned": {
			const name = envelope?.item.core.assignee?.name;
			return name ? `Reassigned to ${name}` : "Reassigned";
		}

		case "task.commented": {
			const { actor, body } = extractCommentBody(event.raw);
			if (body) {
				const excerpt =
					body.length > 120 ? `${body.slice(0, 120).trimEnd()}…` : body;
				return actor ? `${actor} commented: ${excerpt}` : `New comment: ${excerpt}`;
			}
			return actor ? `New comment from ${actor}` : "New comment added";
		}

		case "task.status_changed": {
			const status = envelope?.item.core.status?.label;
			return status ? `Status changed to ${status}` : "Status changed";
		}

		case "task.closed":
			return "Task closed";

		case "task.updated": {
			const changed = extractChangedKeys(event.raw);
			if (!changed || changed.length === 0) return null;
			const meaningful = changed.filter((k) => !NOISE_PROPERTY_KEYS.has(k));
			if (meaningful.length === 0) return null;

			if (meaningful.length === 1) {
				const key = meaningful[0];
				const label = propertyLabel(key);
				// Prefer the resolved label from the envelope for the common
				// single-field updates — "Status changed to Done" reads better
				// than "Updated: status".
				if (key === "status" || key === "status_id") {
					const status = envelope?.item.core.status?.label;
					return status ? `Status changed to ${status}` : "Status changed";
				}
				if (key === "priority" || key === "priority_id") {
					const priority = envelope?.item.core.priority?.label;
					return priority ? `Priority set to ${priority}` : "Priority changed";
				}
				if (key === "due_at" || key === "due_date" || key === "dueAt") {
					const due = envelope?.item.core.dueAt;
					return due ? `Due date set to ${due.slice(0, 10)}` : "Due date changed";
				}
				if (key === "assignee" || key === "assignee_id") {
					const name = envelope?.item.core.assignee?.name;
					return name ? `Reassigned to ${name}` : "Reassigned";
				}
				if (key === "title") {
					const title = envelope?.item.core.title;
					return title ? `Renamed to "${title}"` : "Title changed";
				}
				return `Updated: ${label}`;
			}

			const labels = Array.from(new Set(meaningful.map(propertyLabel)));
			return `Updated: ${labels.join(", ")}`;
		}

		default:
			return null;
	}
}
