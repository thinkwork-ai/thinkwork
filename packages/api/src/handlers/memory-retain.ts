/**
 * Internal Lambda handler — receives memory retain requests from the Strands
 * runtime container and routes them through the normalized memory layer.
 *
 * Cutover compatibility accepts both the new user-scoped payloads and the old
 * agent-scoped turn-pair payload while containers roll forward.
 */

import { and, eq } from "drizzle-orm";
import { getDb } from "@thinkwork/database-pg";
import { agents } from "@thinkwork/database-pg/schema";
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

export async function handler(event: MemoryRetainEvent): Promise<MemoryRetainResult> {
	if (!event?.tenantId) {
		console.warn("[memory-retain] MISSING_USER_CONTEXT missing tenantId");
		return { ok: false, error: "MISSING_USER_CONTEXT" };
	}

	try {
		const userId = event.userId || await resolveUserIdFromAgent(event.tenantId, event.agentId);
		if (!userId) {
			console.warn("[memory-retain] MISSING_USER_CONTEXT", {
				hasUserId: !!event.userId,
				hasAgentId: !!event.agentId,
			});
			return { ok: false, error: "MISSING_USER_CONTEXT" };
		}
		if (!event.userId && event.agentId) {
			console.warn("[memory-retain] legacy agentId payload resolved to userId", {
				tenantId: event.tenantId,
				agentId: event.agentId,
				userId,
			});
		}

		const { adapter, config } = getMemoryServices();
		const owner = {
			tenantId: event.tenantId,
			ownerType: "user" as const,
			ownerId: userId,
		};

		if (event.kind === "daily" || event.date || event.content) {
			if (!event.date || typeof event.content !== "string") {
				console.warn("[memory-retain] MISSING_DOCUMENT_ID daily payload missing date/content");
				return { ok: false, error: "MISSING_DOCUMENT_ID" };
			}
			if (!adapter.retainDailyMemory) {
				return { ok: false, error: "retainDailyMemory not supported" };
			}
			await adapter.retainDailyMemory({
				...owner,
				date: event.date,
				content: event.content,
				metadata: event.metadata,
			});
			return { ok: true, engine: config.engine };
		}

		if (!event.threadId) {
			console.warn("[memory-retain] MISSING_DOCUMENT_ID missing threadId");
			return { ok: false, error: "MISSING_DOCUMENT_ID" };
		}

		const messages = normalizeMessages(event.transcript || event.messages || []);
		if (messages.length === 0) {
			return { ok: true, engine: "skipped" };
		}

		if (event.messages && !event.transcript) {
			console.warn("[memory-retain] legacy messages payload converted to conversation retain", {
				tenantId: event.tenantId,
				userId,
				threadId: event.threadId,
			});
		}

		if (adapter.retainConversation) {
			await adapter.retainConversation({
				...owner,
				threadId: event.threadId,
				messages,
				metadata: event.metadata,
			});
		} else {
			await adapter.retainTurn({
				...owner,
				threadId: event.threadId,
				messages,
				metadata: event.metadata,
			});
		}

		console.log(
			`[memory-retain] engine=${config.engine} tenant=${event.tenantId} ` +
				`user=${userId} thread=${event.threadId} messages=${messages.length}`,
		);

		const compileOutcome = await maybeEnqueuePostTurnCompile({
			tenantId: event.tenantId,
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

function normalizeMessages(messages: RetainMessage[]) {
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
