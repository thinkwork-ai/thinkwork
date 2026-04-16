/**
 * memoryRecords — list long-term memory records for one agent or all
 * agents in the tenant.
 *
 * Reads through the normalized memory inspect service (see
 * `packages/api/src/lib/memory/inspect-service.ts`). The active long-term
 * engine is selected once per deployment via `MEMORY_ENGINE`; the resolver
 * no longer branches on backend-native shapes. Hindsight-specific details
 * (fact_type, tags, occurred_* dates) are surfaced via the record's
 * `metadata` map and mapped back onto the GraphQL `MemoryRecord` shape
 * here so the admin UI continues to work unchanged.
 *
 * Supports single-agent (`assistantId = <uuid>`) and all-agents mode
 * (`assistantId = "all"`, requires tenant context from auth).
 */

import type { GraphQLContext } from "../../context.js";
import { db, eq, agents } from "../../utils.js";
import { getMemoryServices } from "../../../lib/memory/index.js";
import type { ThinkWorkMemoryRecord } from "../../../lib/memory/index.js";

const TOTAL_CAP = 500;

interface MemoryRow {
	memoryRecordId: string;
	content: { text: string };
	createdAt: string | null;
	updatedAt: string | null;
	expiresAt: string | null;
	namespace: string;
	strategyId: string | null;
	strategy: string;
	score: number | null;
	agentSlug: string | null;
	factType: string | null;
	confidence: number | null;
	eventDate: string | null;
	occurredStart: string | null;
	occurredEnd: string | null;
	mentionedAt: string | null;
	tags: string[] | null;
	accessCount: number;
	proofCount: number | null;
	context: string | null;
	threadId: string | null;
}

export const memoryRecords = async (_parent: any, args: any, ctx: GraphQLContext) => {
	const { assistantId } = args as { assistantId: string; namespace: string };

	let agentList: Array<{ id: string; slug: string }>;

	if (assistantId === "all") {
		if (!ctx.auth.tenantId) throw new Error("Tenant context required for all-agents query");
		const agentRows = await db
			.select({ id: agents.id, slug: agents.slug })
			.from(agents)
			.where(eq(agents.tenant_id, ctx.auth.tenantId));
		agentList = agentRows
			.filter((a) => a.id)
			.map((a) => ({ id: a.id as string, slug: (a.slug || a.id) as string }));
		if (agentList.length === 0) return [];
	} else {
		const [agent] = await db
			.select({ id: agents.id, tenant_id: agents.tenant_id, slug: agents.slug })
			.from(agents)
			.where(eq(agents.id, assistantId));
		if (!agent || (ctx.auth.tenantId && agent.tenant_id !== ctx.auth.tenantId)) {
			throw new Error("Agent not found or access denied");
		}
		agentList = [{ id: agent.id as string, slug: (agent.slug || agent.id) as string }];
	}

	const { inspect: inspectService } = getMemoryServices();
	const tenantId = ctx.auth.tenantId || "";

	const perAgent = await Promise.all(
		agentList.map(async (agent) => {
			const records = await inspectService.inspect({
				tenantId,
				ownerType: "agent",
				ownerId: agent.id,
			});
			return records.map((r) => normalizedToRow(r, agent));
		}),
	);

	const merged = new Map<string, MemoryRow>();
	for (const arr of perAgent) {
		for (const row of arr) {
			if (!merged.has(row.memoryRecordId)) merged.set(row.memoryRecordId, row);
		}
	}
	return [...merged.values()]
		.sort((a, b) => sortKey(b) - sortKey(a))
		.slice(0, TOTAL_CAP);
};

function sortKey(row: MemoryRow): number {
	const t = row.createdAt ? Date.parse(row.createdAt) : 0;
	return Number.isFinite(t) ? t : 0;
}

function normalizedToRow(
	record: ThinkWorkMemoryRecord,
	agent: { id: string; slug: string },
): MemoryRow {
	const meta = (record.metadata || {}) as Record<string, any>;
	const factType: string | null = (meta.factType as string | null) ?? null;
	const tags: string[] | null = Array.isArray(meta.tags) && meta.tags.length > 0
		? (meta.tags as string[])
		: null;
	const score = typeof meta.score === "number" ? meta.score : null;
	const rawMeta = (meta.raw || {}) as Record<string, any>;
	const threadId: string | null =
		(record.threadId as string | undefined) ||
		(rawMeta.thread_id as string | undefined) ||
		(rawMeta.threadId as string | undefined) ||
		null;
	return {
		memoryRecordId: record.id,
		content: { text: record.content.text },
		createdAt: record.createdAt || null,
		updatedAt: record.updatedAt || record.createdAt || null,
		expiresAt: null,
		namespace:
			(meta.namespace as string | undefined) || (meta.bankId as string | undefined) || agent.slug,
		strategyId:
			factType || (meta.memoryStrategyId as string | null | undefined) || record.strategy || null,
		strategy: record.strategy || "semantic",
		score: typeof meta.confidence === "number" ? meta.confidence : score,
		agentSlug: agent.slug,
		factType,
		confidence: typeof meta.confidence === "number" ? meta.confidence : null,
		eventDate: (meta.eventDate as string | null) ?? null,
		occurredStart: (meta.occurredStart as string | null) ?? null,
		occurredEnd: (meta.occurredEnd as string | null) ?? null,
		mentionedAt: (meta.mentionedAt as string | null) ?? null,
		tags,
		accessCount: typeof meta.accessCount === "number" ? meta.accessCount : 0,
		proofCount: typeof meta.proofCount === "number" ? meta.proofCount : null,
		context: (meta.context as string | null) ?? null,
		threadId,
	};
}
