/**
 * mobileMemorySearch — recall-based search over the selected agent's full
 * Hindsight bank. Returns results mapped to MobileMemoryCapture so the
 * mobile list can render captures and search hits with the same row
 * component. Unlike mobileMemoryCaptures, this is NOT filtered by
 * capture_source — search is "what does this agent know?", not "what did
 * I type into the Memories tab?".
 */

import type { GraphQLContext } from "../../context.js";
import { db, eq, agents } from "../../utils.js";
import { getMemoryServices } from "../../../lib/memory/index.js";

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

	return hits.map((hit) => {
		const record = hit.record;
		const meta = (record.metadata || {}) as Record<string, unknown>;
		const raw = (meta.raw || {}) as Record<string, unknown>;

		const factTypeOverride =
			typeof raw.fact_type_override === "string" ? raw.fact_type_override : null;
		const nativeFactType =
			typeof meta.factType === "string" ? meta.factType : null;
		const resolvedFactType =
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
	});
};
