/**
 * deleteMobileMemoryCapture — delete a single mobile quick-capture entry.
 *
 * Scope-checks the target record before deleting: we refuse to delete units
 * that weren't written by the mobile quick-capture path (i.e. chat-derived
 * observations or admin-authored reflections) even if the caller has access
 * to the agent. This keeps the mutation a "Captures list only" surface and
 * prevents the mobile app from accidentally wiping chat memory.
 */

import type { GraphQLContext } from "../../context.js";
import { getMemoryServices } from "../../../lib/memory/index.js";
import { requireMemoryUserScope } from "../core/require-user-scope.js";

const CAPTURE_SOURCE = "mobile_quick_capture";
const SCAN_LIMIT = 1000;

export const deleteMobileMemoryCapture = async (
	_parent: any,
	args: any,
	ctx: GraphQLContext,
) => {
	const { captureId } = args as {
		tenantId?: string;
		userId?: string;
		agentId?: string;
		captureId: string;
	};
	const { tenantId, userId } = await requireMemoryUserScope(ctx, args);

	const { adapter } = getMemoryServices();
	if (!adapter.inspect) {
		throw new Error("Memory inspect is not supported on the active engine");
	}
	if (!adapter.forget) {
		throw new Error("Memory delete is not supported on the active engine");
	}

	const records = await adapter.inspect({
		tenantId,
		ownerType: "user",
		ownerId: userId as string,
		limit: SCAN_LIMIT,
	});

	const target = records.find((r) => r.id === captureId);
	if (!target) {
		throw new Error("Capture not found");
	}
	const meta = (target.metadata || {}) as Record<string, unknown>;
	const raw = (meta.raw || {}) as Record<string, unknown>;
	if (raw.capture_source !== CAPTURE_SOURCE) {
		throw new Error("Only quick-capture entries can be deleted through this endpoint");
	}

	await adapter.forget(captureId);
	return true;
};
