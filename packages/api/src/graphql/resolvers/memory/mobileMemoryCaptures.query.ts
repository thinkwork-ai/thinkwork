/**
 * mobileMemoryCaptures — list the mobile quick-capture entries for a given
 * agent. Filters the full Hindsight bank down to units stamped with
 * metadata.capture_source === 'mobile_quick_capture' so the Captures tab
 * segment shows only user-authored quick captures, not chat-derived memory.
 */

import type { GraphQLContext } from "../../context.js";
import { db, eq, agents } from "../../utils.js";
import { getMemoryServices } from "../../../lib/memory/index.js";

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;
const CAPTURE_SOURCE = "mobile_quick_capture";

type MobileCaptureFactType = "FACT" | "PREFERENCE" | "EXPERIENCE" | "OBSERVATION";

const FACT_TYPE_FROM_OVERRIDE: Record<string, MobileCaptureFactType> = {
	world: "FACT",
	opinion: "PREFERENCE",
	experience: "EXPERIENCE",
	observation: "OBSERVATION",
};

export const mobileMemoryCaptures = async (
	_parent: any,
	args: any,
	ctx: GraphQLContext,
) => {
	const { agentId, limit = DEFAULT_LIMIT } = args as {
		agentId: string;
		limit?: number;
	};

	if (!ctx.auth.tenantId) throw new Error("Tenant context required");

	const [agent] = await db
		.select({ id: agents.id, tenant_id: agents.tenant_id, slug: agents.slug })
		.from(agents)
		.where(eq(agents.id, agentId));
	if (!agent || agent.tenant_id !== ctx.auth.tenantId) {
		throw new Error("Agent not found or access denied");
	}

	const { adapter } = getMemoryServices();
	if (!adapter.inspect) return [];

	const cappedLimit = Math.min(Math.max(1, limit), MAX_LIMIT);
	const records = await adapter.inspect({
		tenantId: ctx.auth.tenantId,
		ownerType: "agent",
		ownerId: agent.id as string,
		// inspect pulls the full bank; we filter here so quick-capture entries
		// aren't drowned out by chat-derived units even when the bank is large.
		limit: Math.max(cappedLimit * 4, 200),
	});

	const captures = [] as Array<{
		id: string;
		tenantId: string;
		agentId: string;
		content: string;
		factType: MobileCaptureFactType;
		capturedAt: string;
		syncedAt: string | null;
		metadata: string;
	}>;

	for (const r of records) {
		const meta = (r.metadata || {}) as Record<string, unknown>;
		const raw = (meta.raw || {}) as Record<string, unknown>;
		if (raw.capture_source !== CAPTURE_SOURCE) continue;
		const factTypeOverride = typeof raw.fact_type_override === "string" ? raw.fact_type_override : null;
		const factType: MobileCaptureFactType = factTypeOverride
			? FACT_TYPE_FROM_OVERRIDE[factTypeOverride] ?? "FACT"
			: "FACT";
		captures.push({
			id: r.id,
			tenantId: r.tenantId,
			agentId: r.ownerId,
			content: r.content.text,
			factType,
			capturedAt: (typeof raw.captured_at === "string" ? raw.captured_at : r.createdAt) || new Date().toISOString(),
			syncedAt: r.createdAt || null,
			metadata: JSON.stringify(raw),
		});
		if (captures.length >= cappedLimit) break;
	}

	return captures;
};
