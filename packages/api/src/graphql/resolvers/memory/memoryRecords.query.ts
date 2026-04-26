/**
 * memoryRecords — list long-term memory records for one user.
 *
 * Reads through the normalized memory inspect service (see
 * `packages/api/src/lib/memory/inspect-service.ts`). The active long-term
 * engine is selected once per deployment via `MEMORY_ENGINE`; the resolver
 * no longer branches on backend-native shapes. Hindsight-specific details
 * (fact_type, tags, occurred_* dates) are surfaced via the record's
 * `metadata` map and mapped back onto the GraphQL `MemoryRecord` shape
 * here so the admin UI continues to work unchanged.
 *
 * Supports listing records for the authenticated user's Hindsight bank.
 */

import type { GraphQLContext } from "../../context.js";
import { getMemoryServices } from "../../../lib/memory/index.js";
import type { ThinkWorkMemoryRecord } from "../../../lib/memory/index.js";
import { requireMemoryUserScope } from "../core/require-user-scope.js";

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
	userSlug: string | null;
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
	const { tenantId, userId } = await requireMemoryUserScope(ctx, {
		...args,
		allowTenantAdmin: true,
	});

	const { inspect: inspectService } = getMemoryServices();
	const records = await inspectService.inspect({
		tenantId,
		ownerType: "user",
		ownerId: userId,
	});

	const merged = new Map<string, MemoryRow>();
	for (const row of records.map((r) => normalizedToRow(r, userId))) {
		if (!merged.has(row.memoryRecordId)) merged.set(row.memoryRecordId, row);
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
	userId: string,
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
			(meta.namespace as string | undefined) || (meta.bankId as string | undefined) || `user_${userId}`,
		strategyId:
			factType || (meta.memoryStrategyId as string | null | undefined) || record.strategy || null,
		strategy: record.strategy || "semantic",
		score: typeof meta.confidence === "number" ? meta.confidence : score,
		userSlug: `user_${userId}`,
		agentSlug: `user_${userId}`,
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
