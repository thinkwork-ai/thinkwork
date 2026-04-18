/**
 * mobileMemorySearch — keyword + semantic search over the selected
 * agent's full Hindsight bank. Returns results mapped to MobileMemoryCapture
 * so the mobile list can render captures and search hits with the same row
 * component. Unlike mobileMemoryCaptures, this is NOT filtered by
 * capture_source — search is "what does this agent know?", not "what did
 * I type into the Memories tab?".
 *
 * Strategy:
 *   1. Literal substring match over the inspect feed (matches user
 *      expectation: typing "Momofuku" should surface the row containing
 *      "Momofuku"). This is deterministic and does not depend on
 *      embedding availability or recall thresholds.
 *   2. Semantic recall, merged in after the literal hits. Dedupe by id.
 *      Semantic hits give us matches that don't contain the exact
 *      keyword but are topically related.
 *
 * Keeping literal first means the user always sees "the thing I typed"
 * even when recall returns nothing (e.g. fresh embeddings not yet
 * built, or recall endpoint transiently unavailable).
 */

import type { GraphQLContext } from "../../context.js";
import { db, eq, agents } from "../../utils.js";
import { getMemoryServices } from "../../../lib/memory/index.js";
import type { ThinkWorkMemoryRecord } from "../../../lib/memory/index.js";

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;
// How many records inspect pulls before we filter. Hindsight adapter caps
// inspect at 500 anyway, so this is the practical scan window.
const INSPECT_SCAN = 500;

type MobileCaptureFactType = "FACT" | "PREFERENCE" | "EXPERIENCE" | "OBSERVATION";

const FACT_TYPE_FROM_HINDSIGHT: Record<string, MobileCaptureFactType> = {
	world: "FACT",
	opinion: "PREFERENCE",
	experience: "EXPERIENCE",
	observation: "OBSERVATION",
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

	const { adapter, recall } = getMemoryServices();
	const cappedLimit = Math.min(Math.max(1, limit), MAX_LIMIT);
	const needle = trimmed.toLowerCase();
	const ownerRef = {
		tenantId: ctx.auth.tenantId,
		ownerType: "agent" as const,
		ownerId: agent.id as string,
	};

	// Run inspect (for literal match) and recall (for semantic) in parallel.
	// Either call is allowed to fail softly — search should degrade, not 500.
	const [inspectRecords, recallHits] = await Promise.all([
		adapter.inspect
			? adapter.inspect({ ...ownerRef, limit: INSPECT_SCAN }).catch(() => [] as ThinkWorkMemoryRecord[])
			: Promise.resolve([] as ThinkWorkMemoryRecord[]),
		recall
			.recall({ ...ownerRef, query: trimmed, limit: cappedLimit })
			.catch(() => []),
	]);

	const merged = new Map<string, ReturnType<typeof toMobileCapture>>();

	// Literal text matches first — sorted newest-first (inspect returns that way).
	for (const r of inspectRecords) {
		if (merged.size >= cappedLimit) break;
		const text = (r.content?.text || "").toLowerCase();
		if (!text.includes(needle)) continue;
		merged.set(r.id, toMobileCapture(r));
	}

	// Semantic hits fill remaining capacity.
	for (const hit of recallHits) {
		if (merged.size >= cappedLimit) break;
		if (merged.has(hit.record.id)) continue;
		merged.set(hit.record.id, toMobileCapture(hit.record));
	}

	return [...merged.values()];
};

function toMobileCapture(record: ThinkWorkMemoryRecord) {
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
