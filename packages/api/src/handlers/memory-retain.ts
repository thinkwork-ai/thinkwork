/**
 * Internal Lambda handler — receives a conversational turn from the
 * Strands runtime container and routes it through the normalized memory
 * layer's retainTurn() path. Auth is IAM-only: only the agentcore-runtime
 * Lambda is granted lambda:InvokeFunction on this function.
 *
 * Invoked asynchronously (InvocationType=Event) so chat turns don't block
 * on memory retention. Errors are logged and swallowed; memory is
 * best-effort and must never break the chat path.
 *
 * Payload shape:
 *   {
 *     tenantId: string,
 *     agentId: string,
 *     threadId: string,
 *     messages: [{ role: "user"|"assistant"|"system", content: string }],
 *   }
 */

import { getMemoryServices } from "../lib/memory/index.js";

type MemoryRetainEvent = {
	tenantId?: string;
	agentId?: string;
	threadId?: string;
	messages?: Array<{
		role?: string;
		content?: string;
	}>;
	metadata?: Record<string, unknown>;
};

type MemoryRetainResult = {
	ok: boolean;
	engine?: string;
	error?: string;
};

export async function handler(event: MemoryRetainEvent): Promise<MemoryRetainResult> {
	if (!event?.tenantId || !event?.agentId || !event?.threadId) {
		console.warn("[memory-retain] missing required fields", {
			hasTenantId: !!event?.tenantId,
			hasAgentId: !!event?.agentId,
			hasThreadId: !!event?.threadId,
		});
		return { ok: false, error: "missing tenantId, agentId, or threadId" };
	}

	const messages = (event.messages || [])
		.filter((m) => m && typeof m.content === "string" && m.content.length > 0)
		.map((m) => ({
			role: (m.role === "assistant" || m.role === "system" ? m.role : "user") as
				| "user"
				| "assistant"
				| "system",
			content: m.content as string,
		}));

	if (messages.length === 0) {
		return { ok: true, engine: "skipped" };
	}

	try {
		const { adapter, config } = getMemoryServices();
		await adapter.retainTurn({
			tenantId: event.tenantId,
			ownerType: "agent",
			ownerId: event.agentId,
			threadId: event.threadId,
			messages,
			metadata: event.metadata,
		});
		console.log(
			`[memory-retain] engine=${config.engine} tenant=${event.tenantId} ` +
				`agent=${event.agentId} thread=${event.threadId} messages=${messages.length}`,
		);
		return { ok: true, engine: config.engine };
	} catch (err) {
		const msg = (err as Error)?.message || String(err);
		console.error(`[memory-retain] failed: ${msg}`);
		return { ok: false, error: msg };
	}
}
