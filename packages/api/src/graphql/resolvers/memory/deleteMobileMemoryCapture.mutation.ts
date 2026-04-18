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
import { db, eq, agents } from "../../utils.js";
import { getMemoryServices } from "../../../lib/memory/index.js";

const CAPTURE_SOURCE = "mobile_quick_capture";
const SCAN_LIMIT = 1000;

export const deleteMobileMemoryCapture = async (
	_parent: any,
	args: any,
	ctx: GraphQLContext,
) => {
	const { agentId, captureId } = args as { agentId: string; captureId: string };

	if (!ctx.auth.tenantId) throw new Error("Tenant context required");

	const [agent] = await db
		.select({ id: agents.id, tenant_id: agents.tenant_id })
		.from(agents)
		.where(eq(agents.id, agentId));
	if (!agent || agent.tenant_id !== ctx.auth.tenantId) {
		throw new Error("Agent not found or access denied");
	}

	const { adapter } = getMemoryServices();
	if (!adapter.inspect) {
		throw new Error("Memory inspect is not supported on the active engine");
	}
	if (!adapter.forget) {
		throw new Error("Memory delete is not supported on the active engine");
	}

	const records = await adapter.inspect({
		tenantId: ctx.auth.tenantId,
		ownerType: "agent",
		ownerId: agent.id as string,
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
