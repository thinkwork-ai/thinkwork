/**
 * Internal Lambda handler — receives memory retain requests from the runtime
 * containers (Strands + Pi) and routes them through the normalized memory
 * layer.
 *
 * For per-thread retain (event.threadId present + adapter.retainConversation
 * available), the handler fetches the canonical transcript from the messages
 * table — filtered by BOTH tenant_id AND thread_id for cross-tenant safety —
 * and merges with the runtime-supplied event.transcript using a
 * longest-suffix-prefix overlap match. This handles both transcript shapes
 * the runtimes send: small (latest pair only) and large (full history +
 * latest pair) without producing duplicate-bloated documents.
 *
 * Cutover compatibility accepts the legacy agent-scoped messages payload while
 * containers roll forward.
 */

import { and, asc, eq } from "drizzle-orm";
import { getDb } from "@thinkwork/database-pg";
import { agents, messages } from "@thinkwork/database-pg/schema";
import { getMemoryServices } from "../lib/memory/index.js";
import { maybeEnqueuePostTurnCompile } from "../lib/wiki/enqueue.js";

type RetainMessage = {
	role?: string;
	content?: string;
	timestamp?: string;
};

type MemoryRetainEvent = {
	tenantId?: string;
	userId?: string;
	agentId?: string;
	threadId?: string;
	messages?: RetainMessage[];
	transcript?: RetainMessage[];
	kind?: string;
	date?: string;
	content?: string;
	metadata?: Record<string, unknown>;
};

type MemoryRetainResult = {
	ok: boolean;
	engine?: string;
	error?: string;
};

type NormalizedMessage = {
	role: "user" | "assistant" | "system";
	content: string;
	timestamp: string;
};

export async function handler(event: MemoryRetainEvent): Promise<MemoryRetainResult> {
	if (!event?.tenantId) {
		console.warn("[memory-retain] MISSING_USER_CONTEXT missing tenantId");
		return { ok: false, error: "MISSING_USER_CONTEXT" };
	}

	// Snapshot identity-bearing fields at handler entry so any downstream env
	// shadowing or mutation does not affect the resolved owner. Mirrors the
	// runtime-side `feedback_completion_callback_snapshot_pattern`.
	const tenantId = event.tenantId;
	const eventThreadId = event.threadId;
	const eventKind = event.kind;
	const eventDate = event.date;
	const eventContent = event.content;
	const eventMetadata = event.metadata;
	const eventTranscript = event.transcript;
	const eventLegacyMessages = event.messages;
	const eventAgentId = event.agentId;

	try {
		const userId = event.userId || (await resolveUserIdFromAgent(tenantId, eventAgentId));
		if (!userId) {
			console.warn("[memory-retain] MISSING_USER_CONTEXT", {
				hasUserId: !!event.userId,
				hasAgentId: !!eventAgentId,
			});
			return { ok: false, error: "MISSING_USER_CONTEXT" };
		}
		if (!event.userId && eventAgentId) {
			console.warn("[memory-retain] legacy agentId payload resolved to userId", {
				tenantId,
				agentId: eventAgentId,
				userId,
			});
		}

		const { adapter, config } = getMemoryServices();
		const owner = {
			tenantId,
			ownerType: "user" as const,
			ownerId: userId,
		};

		if (eventKind === "daily" || eventDate || eventContent) {
			if (!eventDate || typeof eventContent !== "string") {
				console.warn("[memory-retain] MISSING_DOCUMENT_ID daily payload missing date/content");
				return { ok: false, error: "MISSING_DOCUMENT_ID" };
			}
			if (!adapter.retainDailyMemory) {
				return { ok: false, error: "retainDailyMemory not supported" };
			}
			await adapter.retainDailyMemory({
				...owner,
				date: eventDate,
				content: eventContent,
				metadata: eventMetadata,
			});
			return { ok: true, engine: config.engine };
		}

		if (!eventThreadId) {
			console.warn("[memory-retain] MISSING_DOCUMENT_ID missing threadId");
			return { ok: false, error: "MISSING_DOCUMENT_ID" };
		}

		const eventMessages = normalizeMessages(eventTranscript || eventLegacyMessages || []);

		// Per-thread upsert path: when the adapter supports retainConversation
		// AND we have a threadId, fetch the canonical full transcript from the
		// messages table and merge with the event tail before calling the
		// adapter. This survives the messages-commit-vs-Lambda-fire race.
		if (adapter.retainConversation) {
			let dbMessages: NormalizedMessage[] = [];
			try {
				dbMessages = await fetchThreadTranscript(tenantId, eventThreadId);
			} catch (err) {
				const msg = (err as Error)?.message || String(err);
				console.warn(
					`[memory-retain] fetchThreadTranscript failed; falling back to event transcript: ${msg}`,
				);
				dbMessages = [];
			}

			const merged = mergeTranscriptSuffix(dbMessages, eventMessages);

			if (merged.length === 0) {
				return { ok: false, error: "no_content" };
			}

			if (eventLegacyMessages && !eventTranscript) {
				console.warn("[memory-retain] legacy messages payload converted to conversation retain", {
					tenantId,
					userId,
					threadId: eventThreadId,
				});
			}

			await adapter.retainConversation({
				...owner,
				threadId: eventThreadId,
				messages: merged,
				metadata: eventMetadata,
			});

			console.log(
				`[memory-retain] engine=${config.engine} tenant=${tenantId} ` +
					`user=${userId} thread=${eventThreadId} db=${dbMessages.length} ` +
					`event=${eventMessages.length} merged=${merged.length}`,
			);
		} else {
			// AgentCore engine fallback: adapter without retainConversation
			// (e.g. AgentCore managed memory) keeps today's per-turn semantics.
			if (eventMessages.length === 0) {
				return { ok: true, engine: "skipped" };
			}
			await adapter.retainTurn({
				...owner,
				threadId: eventThreadId,
				messages: eventMessages,
				metadata: eventMetadata,
			});
			console.log(
				`[memory-retain] engine=${config.engine} fallback retainTurn tenant=${tenantId} ` +
					`user=${userId} thread=${eventThreadId} messages=${eventMessages.length}`,
			);
		}

		const compileOutcome = await maybeEnqueuePostTurnCompile({
			tenantId,
			ownerId: userId,
			adapterKind: adapter.kind,
		});
		if (
			compileOutcome.status === "enqueued" ||
			compileOutcome.status === "enqueued_invoke_failed" ||
			compileOutcome.status === "error"
		) {
			console.log(
				`[memory-retain] wiki-compile ${compileOutcome.status}` +
					(compileOutcome.jobId ? ` jobId=${compileOutcome.jobId}` : "") +
					(compileOutcome.error ? ` error=${compileOutcome.error}` : ""),
			);
		}

		return { ok: true, engine: config.engine };
	} catch (err) {
		const msg = (err as Error)?.message || String(err);
		console.error(`[memory-retain] failed: ${msg}`);
		return { ok: false, error: msg };
	}
}

/**
 * Fetch the canonical thread transcript from the messages table.
 *
 * SECURITY: filters by BOTH tenant_id AND thread_id to prevent confused-deputy
 * attacks via forged threadId in the event payload. A threadId belonging to
 * tenant B will return zero rows when the event claims tenantId=A, and the
 * caller falls through to the event tail (which contains A's content) — no
 * cross-tenant leak.
 *
 * Logging hygiene: never include message content in logs. Identifiers are
 * prefix-truncated.
 */
async function fetchThreadTranscript(
	tenantId: string,
	threadId: string,
): Promise<NormalizedMessage[]> {
	const db = getDb();
	const rows = await db
		.select({
			role: messages.role,
			content: messages.content,
			created_at: messages.created_at,
			tenant_id: messages.tenant_id,
		})
		.from(messages)
		.where(and(eq(messages.tenant_id, tenantId), eq(messages.thread_id, threadId)))
		.orderBy(asc(messages.created_at));

	const anomalous = rows.filter((r) => r.tenant_id !== tenantId);
	if (anomalous.length > 0) {
		// Defense-in-depth: the WHERE filter above already excludes rows from
		// other tenants, but if database state is somehow inconsistent surface
		// it loudly rather than silently leak content.
		console.error(
			`[memory-retain] tenant_anomaly tenant=${tenantId.slice(0, 8)} ` +
				`thread=${threadId.slice(0, 8)} mismatched=${anomalous.length}`,
		);
		throw new Error("tenant_anomaly");
	}

	return rows
		.filter(
			(r): r is { role: string; content: string; created_at: Date; tenant_id: string } =>
				typeof r.content === "string" && r.content.trim().length > 0,
		)
		.map((r) => ({
			role:
				r.role === "assistant" || r.role === "system"
					? (r.role as "assistant" | "system")
					: ("user" as const),
			content: r.content.trim(),
			timestamp: r.created_at.toISOString(),
		}));
}

/**
 * Longest-suffix-prefix overlap merge between DB rows (canonical) and the
 * runtime-supplied event tail.
 *
 * Algorithm: find the largest k such that event[0..k-1] equals db.tail[-k..]
 * compared by (role, content) only. Append event[k..] after the DB rows; the
 * first k event entries are the overlap and are dropped.
 *
 * Handles both transcript shapes:
 * - event = [latest_pair_only]  (small, k typically 0 or 2)
 * - event = full_history + [latest_pair]  (k matches whatever DB tail
 *   already has)
 *
 * Timestamp is excluded from the match key on purpose: createdAt differs
 * between runtime-stamped event entries and DB-writer-stamped rows, and
 * including it in the dedup key produces phantom duplicates over long threads.
 */
export function mergeTranscriptSuffix(
	db: NormalizedMessage[],
	event: NormalizedMessage[],
): NormalizedMessage[] {
	if (event.length === 0) return [...db];
	if (db.length === 0) return [...event];

	const max = Math.min(db.length, event.length);
	let bestK = 0;
	for (let k = max; k >= 1; k -= 1) {
		let match = true;
		for (let i = 0; i < k; i += 1) {
			const a = db[db.length - k + i];
			const b = event[i];
			if (a.role !== b.role || a.content !== b.content) {
				match = false;
				break;
			}
		}
		if (match) {
			bestK = k;
			break;
		}
	}

	return [...db, ...event.slice(bestK)];
}

async function resolveUserIdFromAgent(
	tenantId: string,
	agentId?: string,
): Promise<string | null> {
	if (!agentId) return null;
	const db = getDb();
	const [row] = await db
		.select({ userId: agents.human_pair_id })
		.from(agents)
		.where(and(eq(agents.id, agentId), eq(agents.tenant_id, tenantId)))
		.limit(1);
	if (!row?.userId) {
		throw new Error("MISSING_USER_CONTEXT");
	}
	return row.userId;
}

function normalizeMessages(messages: RetainMessage[]): NormalizedMessage[] {
	const now = new Date().toISOString();
	return messages
		.filter((m) => typeof m.content === "string" && m.content.trim().length > 0)
		.map((m) => ({
			role: (m.role === "assistant" || m.role === "system" ? m.role : "user") as
				| "user"
				| "assistant"
				| "system",
			content: m.content!.trim(),
			timestamp: m.timestamp || now,
		}));
}
