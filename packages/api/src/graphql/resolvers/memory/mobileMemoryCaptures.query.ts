/**
 * mobileMemoryCaptures — list the mobile quick-capture entries for a given
 * agent. Filters the full Hindsight bank down to units stamped with
 * metadata.capture_source === 'mobile_quick_capture' so the Captures tab
 * segment shows only user-authored quick captures, not chat-derived memory.
 */

import type { GraphQLContext } from "../../context.js";
import { getMemoryServices } from "../../../lib/memory/index.js";
import { requireMemoryUserScope } from "../core/require-user-scope.js";

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
	const { limit = DEFAULT_LIMIT } = args as {
		tenantId?: string;
		userId?: string;
		agentId?: string;
		limit?: number;
	};

	const { tenantId, userId } = await requireMemoryUserScope(ctx, args);

	const { adapter } = getMemoryServices();
	if (!adapter.inspect) return [];

	const cappedLimit = Math.min(Math.max(1, limit), MAX_LIMIT);
	const records = await adapter.inspect({
		tenantId,
		ownerType: "user",
		ownerId: userId as string,
		// inspect pulls the full bank; we filter here so quick-capture entries
		// aren't drowned out by chat-derived units even when the bank is large.
		limit: Math.max(cappedLimit * 4, 200),
	});

	const captures = [] as Array<{
		id: string;
		tenantId: string;
		userId: string;
		agentId: string | null;
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
			userId: r.ownerId,
			agentId: args.agentId ?? null,
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
