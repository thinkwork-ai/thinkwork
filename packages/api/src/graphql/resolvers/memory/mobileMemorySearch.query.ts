/**
 * mobileMemorySearch — keyword + semantic search over the selected
 * agent's full Hindsight bank.
 *
 * Queries hindsight.memory_units directly with ILIKE (rather than
 * adapter.inspect + client-side filter) so search is deterministic
 * and debuggable. The previous implementations (recall-only, then
 * recall + adapter inspect) silently returned [] whenever recall
 * came back empty or the adapter swallowed a mismatch.
 *
 * Order of operations:
 *   1. ILIKE match against memory_units.text — literal keyword hits.
 *   2. Semantic fallback via recall, merged in after literal matches
 *      so "Korean restaurant" still surfaces a unit that says
 *      "Momofuku" when the user searches by theme.
 */

import { sql, eq } from "drizzle-orm";
import type { GraphQLContext } from "../../context.js";
import { db, agents } from "../../utils.js";
import { getMemoryServices } from "../../../lib/memory/index.js";
import type { ThinkWorkMemoryRecord } from "../../../lib/memory/index.js";

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;

type MobileCaptureFactType = "FACT" | "PREFERENCE" | "EXPERIENCE" | "OBSERVATION";

const FACT_TYPE_FROM_HINDSIGHT: Record<string, MobileCaptureFactType> = {
	world: "FACT",
	opinion: "PREFERENCE",
	experience: "EXPERIENCE",
	observation: "OBSERVATION",
};

type MobileCaptureShape = {
	id: string;
	tenantId: string;
	agentId: string;
	content: string;
	factType: MobileCaptureFactType;
	capturedAt: string;
	syncedAt: string | null;
	metadata: string;
};

export const mobileMemorySearch = async (
	_parent: any,
	args: any,
	ctx: GraphQLContext,
) => {
	const { agentId, query, limit = DEFAULT_LIMIT } = args as {
		agentId: string;
		query: string;
		limit?: number;
	};

	const trimmed = (query || "").trim();
	if (!trimmed) return [];
	if (!ctx.auth.tenantId) throw new Error("Tenant context required");

	const [agent] = await db
		.select({ id: agents.id, tenant_id: agents.tenant_id, slug: agents.slug })
		.from(agents)
		.where(eq(agents.id, agentId));
	if (!agent || agent.tenant_id !== ctx.auth.tenantId) {
		throw new Error("Agent not found or access denied");
	}

	const bankId = (agent.slug as string) || (agent.id as string);
	const cappedLimit = Math.min(Math.max(1, limit), MAX_LIMIT);
	const pattern = `%${escapeLike(trimmed)}%`;
	const matches = new Map<string, MobileCaptureShape>();

	// 1. Literal ILIKE match — matches whether the embeddings are stale
	//    or the recall endpoint is down. Deterministic.
	try {
		const result: any = await db.execute(sql`
			SELECT
				id, bank_id, text, context, fact_type, metadata,
				created_at, updated_at
			FROM hindsight.memory_units
			WHERE bank_id = ${bankId}
			  AND text ILIKE ${pattern}
			ORDER BY created_at DESC
			LIMIT ${cappedLimit}
		`);
		for (const row of result.rows || []) {
			matches.set(String(row.id), rowToMobileCapture(row, ctx.auth.tenantId, agent.id as string));
			if (matches.size >= cappedLimit) break;
		}
	} catch (err) {
		console.warn(
			`[mobileMemorySearch] ILIKE scan failed for bank=${bankId}: ${(err as Error)?.message}`,
		);
	}

	// 2. Semantic recall for the remaining slots. Failures here are
	//    non-fatal; literal results already dominate.
	if (matches.size < cappedLimit) {
		try {
			const hits = await getMemoryServices().recall.recall({
				tenantId: ctx.auth.tenantId,
				ownerType: "agent",
				ownerId: agent.id as string,
				query: trimmed,
				limit: cappedLimit,
			});
			for (const hit of hits) {
				if (matches.size >= cappedLimit) break;
				if (matches.has(hit.record.id)) continue;
				matches.set(hit.record.id, recordToMobileCapture(hit.record));
			}
		} catch (err) {
			console.warn(`[mobileMemorySearch] recall failed: ${(err as Error)?.message}`);
		}
	}

	return [...matches.values()];
};

function escapeLike(value: string): string {
	return value.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

function rowToMobileCapture(
	row: any,
	tenantId: string,
	ownerId: string,
): MobileCaptureShape {
	const rawMeta = parseMetadata(row.metadata);
	const factTypeOverride =
		typeof rawMeta.fact_type_override === "string" ? rawMeta.fact_type_override : null;
	const nativeFactType = typeof row.fact_type === "string" ? row.fact_type : null;
	const resolvedFactType: MobileCaptureFactType =
		(factTypeOverride && FACT_TYPE_FROM_HINDSIGHT[factTypeOverride]) ||
		(nativeFactType && FACT_TYPE_FROM_HINDSIGHT[nativeFactType]) ||
		"FACT";

	const createdAtIso = toIso(row.created_at) || new Date().toISOString();
	const capturedAt =
		(typeof rawMeta.captured_at === "string" ? rawMeta.captured_at : null) || createdAtIso;

	return {
		id: String(row.id),
		tenantId,
		agentId: ownerId,
		content: String(row.text || ""),
		factType: resolvedFactType,
		capturedAt,
		syncedAt: createdAtIso,
		metadata: JSON.stringify(rawMeta),
	};
}

function recordToMobileCapture(record: ThinkWorkMemoryRecord): MobileCaptureShape {
	const meta = (record.metadata || {}) as Record<string, unknown>;
	const raw = (meta.raw || {}) as Record<string, unknown>;

	const factTypeOverride =
		typeof raw.fact_type_override === "string" ? raw.fact_type_override : null;
	const nativeFactType =
		typeof meta.factType === "string" ? meta.factType : null;
	const resolvedFactType: MobileCaptureFactType =
		(factTypeOverride && FACT_TYPE_FROM_HINDSIGHT[factTypeOverride]) ||
		(nativeFactType && FACT_TYPE_FROM_HINDSIGHT[nativeFactType]) ||
		"FACT";

	const capturedAt =
		(typeof raw.captured_at === "string" ? raw.captured_at : null) ||
		record.createdAt ||
		new Date().toISOString();

	return {
		id: record.id,
		tenantId: record.tenantId,
		agentId: record.ownerId,
		content: record.content.text,
		factType: resolvedFactType,
		capturedAt,
		syncedAt: record.createdAt || null,
		metadata: JSON.stringify(raw),
	};
}

function parseMetadata(raw: unknown): Record<string, unknown> {
	if (!raw) return {};
	if (typeof raw === "string") {
		try {
			const parsed = JSON.parse(raw);
			return parsed && typeof parsed === "object" && !Array.isArray(parsed)
				? (parsed as Record<string, unknown>)
				: {};
		} catch {
			return {};
		}
	}
	if (typeof raw === "object" && !Array.isArray(raw)) {
		return raw as Record<string, unknown>;
	}
	return {};
}

function toIso(value: unknown): string | null {
	if (!value) return null;
	try {
		return new Date(value as any).toISOString();
	} catch {
		return null;
	}
}
