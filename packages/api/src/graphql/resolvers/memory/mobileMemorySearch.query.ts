/**
 * mobileMemorySearch — semantic search over the selected agent's
 * Hindsight bank via the recall service. One endpoint call, no
 * client-side filtering or DB scraping. Results mapped back into
 * MobileMemoryCapture so the Memories list can render them with
 * the same row component it uses for captures.
 */

import type { GraphQLContext } from "../../context.js";
import { db, eq, agents } from "../../utils.js";
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

	const { recall } = getMemoryServices();
	const cappedLimit = Math.min(Math.max(1, limit), MAX_LIMIT);

	const hits = await recall.recall({
		tenantId: ctx.auth.tenantId,
		ownerType: "agent",
		ownerId: agent.id as string,
		query: trimmed,
		limit: cappedLimit,
	});

	console.log(
		`[mobileMemorySearch] agent=${agent.slug ?? agent.id} query=${JSON.stringify(trimmed)} hits=${hits.length}`,
	);

	return hits.map((hit) => recordToMobileCapture(hit.record));
};

function recordToMobileCapture(record: ThinkWorkMemoryRecord) {
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
