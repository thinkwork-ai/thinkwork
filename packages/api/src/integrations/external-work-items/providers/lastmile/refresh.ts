/**
 * LastMile task refresh: `tasks_get` via the MCP server, normalized into an
 * envelope (item + blocks + form). Used by both the Phase 5 refresh branch
 * and the Phase 2 executeAction path after a mutation.
 *
 * The server's tool is `tasks_get` (pluralized, tool names stay snake_case)
 * and it takes a `taskId` argument (tool input schemas are camelCase after
 * LastMile's 2026-04 API rewrite).
 */

import type { AdapterCallContext, ExternalTaskEnvelope } from "../../types.js";
import { callMcpTool } from "../../mcpClient.js";
import { LASTMILE_MCP_SERVER, LASTMILE_TOOLS } from "./constants.js";
import { normalizeLastmileTask } from "./normalizeItem.js";
import { buildLastmileBlocks } from "./buildBlocks.js";
import { buildLastmileEditForm } from "./buildFormSchema.js";

export async function refreshLastmileTask(args: {
	externalTaskId: string;
	ctx: AdapterCallContext;
}): Promise<ExternalTaskEnvelope> {
	const { externalTaskId, ctx } = args;

	const raw = await callMcpTool({
		server: LASTMILE_MCP_SERVER,
		tool: LASTMILE_TOOLS.get,
		args: { taskId: externalTaskId },
		authToken: ctx.authToken,
	});

	if (!raw || typeof raw !== "object") {
		throw new Error(`[lastmile] ${LASTMILE_TOOLS.get} returned non-object payload for ${externalTaskId}`);
	}

	return envelopeFromRaw(raw as Record<string, unknown>, externalTaskId);
}

export function envelopeFromRaw(
	raw: Record<string, unknown>,
	externalTaskId: string,
): ExternalTaskEnvelope {
	const item = normalizeLastmileTask(raw);
	const blocks = buildLastmileBlocks(item);
	const editForm = buildLastmileEditForm(item);
	item.forms = { ...(item.forms ?? {}), edit: editForm };

	return {
		_type: "external_task",
		_source: {
			provider: "lastmile",
			tool: LASTMILE_TOOLS.get,
			params: { taskId: externalTaskId },
		},
		item,
		blocks,
		_refreshedAt: new Date().toISOString(),
	};
}
