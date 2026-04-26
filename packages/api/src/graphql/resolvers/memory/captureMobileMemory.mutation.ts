/**
 * captureMobileMemory — Mobile quick-capture footer writes a user-authored
 * fact directly into the user's Hindsight bank. Not a chat turn;
 * the agent is not invoked. The captured unit will surface on the user's
 * next recall because it lives in the same bank the agent reads from.
 *
 * Factor:
 *   FACT        → sourceType explicit_remember, native world
 *   PREFERENCE  → sourceType explicit_remember, fact_type_override opinion
 *   EXPERIENCE  → sourceType explicit_remember, fact_type_override experience
 *   OBSERVATION → sourceType explicit_remember, fact_type_override observation
 *
 * Metadata merge order: resolver defaults ← caller metadata ← forced stamps.
 * `capture_source: 'mobile_quick_capture'` is always stamped and cannot be
 * overridden by the caller (used by the PR B Captures list filter).
 */

import type { GraphQLContext } from "../../context.js";
import { getMemoryServices } from "../../../lib/memory/index.js";
import { requireMemoryUserScope } from "../core/require-user-scope.js";

const MAX_CONTENT_LENGTH = 2000;
const CAPTURE_SOURCE = "mobile_quick_capture";

type MobileCaptureFactType = "FACT" | "PREFERENCE" | "EXPERIENCE" | "OBSERVATION";

const FACT_TYPE_OVERRIDES: Record<MobileCaptureFactType, string | null> = {
	FACT: null,
	PREFERENCE: "opinion",
	EXPERIENCE: "experience",
	OBSERVATION: "observation",
};

export const captureMobileMemory = async (
	_parent: any,
	args: any,
	ctx: GraphQLContext,
) => {
	const {
		content,
		factType = "FACT",
		metadata: callerMetadata,
		clientCaptureId,
	} = args as {
		tenantId?: string;
		userId?: string;
		agentId?: string;
		content: string;
		factType?: MobileCaptureFactType;
		metadata?: Record<string, unknown> | string | null;
		clientCaptureId?: string;
	};

	const trimmed = (content || "").trim();
	if (!trimmed) {
		throw new Error("Capture content is required");
	}
	if (trimmed.length > MAX_CONTENT_LENGTH) {
		throw new Error(`Capture content exceeds ${MAX_CONTENT_LENGTH} characters`);
	}

	const { tenantId, userId } = await requireMemoryUserScope(ctx, args);

	const parsedCallerMetadata = parseMetadata(callerMetadata);
	const factTypeOverride = FACT_TYPE_OVERRIDES[factType];

	const metadata: Record<string, unknown> = {
		...parsedCallerMetadata,
		capture_source: CAPTURE_SOURCE,
	};
	if (factTypeOverride) metadata.fact_type_override = factTypeOverride;
	if (clientCaptureId) metadata.client_capture_id = clientCaptureId;

	const capturedAt = new Date().toISOString();
	metadata.captured_at = capturedAt;

	const { adapter } = getMemoryServices();
	if (!adapter.retain) {
		throw new Error("Memory retain is not supported on the active engine");
	}

	const result = await adapter.retain({
		tenantId,
		ownerType: "user",
		ownerId: userId as string,
		sourceType: "explicit_remember",
		content: trimmed,
		role: "user",
		metadata,
	});

	return {
		id: result.record.id,
		tenantId,
		userId: userId,
		agentId: args.agentId ?? null,
		content: trimmed,
		factType,
		capturedAt,
		syncedAt: capturedAt,
		metadata: JSON.stringify(metadata),
	};
};

function parseMetadata(
	raw: Record<string, unknown> | string | null | undefined,
): Record<string, unknown> {
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
		return raw;
	}
	return {};
}
