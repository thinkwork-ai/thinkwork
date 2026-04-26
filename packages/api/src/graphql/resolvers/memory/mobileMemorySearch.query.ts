/**
 * mobileMemorySearch — semantic search over the user's
 * Hindsight bank via the recall service. One endpoint call, no
 * client-side filtering or DB scraping. Results mapped back into
 * MobileMemoryCapture so the Memories list can render them with
 * the same row component it uses for captures.
 */

import type { GraphQLContext } from "../../context.js";
import { getMemoryServices } from "../../../lib/memory/index.js";
import type { ThinkWorkMemoryRecord } from "../../../lib/memory/index.js";
import { requireMemoryUserScope } from "../core/require-user-scope.js";

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;

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
	const { query, limit = DEFAULT_LIMIT } = args as {
		tenantId?: string;
		userId?: string;
		agentId?: string;
		query: string;
		limit?: number;
	};

	const trimmed = (query || "").trim();
	if (!trimmed) return [];
	const { tenantId, userId } = await requireMemoryUserScope(ctx, args);

	const { recall } = getMemoryServices();
	const cappedLimit = Math.min(Math.max(1, limit), MAX_LIMIT);

	const hits = await recall.recall({
		tenantId,
		ownerType: "user",
		ownerId: userId as string,
		query: trimmed,
		limit: cappedLimit,
	});

	console.log(
		`[mobileMemorySearch] user=${userId} query=${JSON.stringify(trimmed)} hits=${hits.length}`,
	);

	return hits.map((hit) => recordToMobileCapture(hit.record, args.agentId ?? null));
};

function recordToMobileCapture(record: ThinkWorkMemoryRecord, agentId: string | null) {
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
		userId: record.ownerId,
		agentId,
		content: record.content.text,
		factType: resolvedFactType,
		capturedAt,
		syncedAt: record.createdAt || null,
		metadata: JSON.stringify(raw),
	};
}
