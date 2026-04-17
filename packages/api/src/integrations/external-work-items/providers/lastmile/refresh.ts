/**
 * LastMile task refresh: `tasks_get` via the MCP server, normalized into an
 * envelope (item + blocks + form). Used by both the Phase 5 refresh branch
 * and the Phase 2 executeAction path after a mutation.
 *
 * The tool name is `tasks_get` (pluralized) and the argument is `task_id`.
 * Earlier naming (`task_get` + `id`) was inferred, not probed, and caused the
 * "MCP error" banner on the mobile ExternalTaskCard refresh path.
 *
 * The MCP URL is resolved from `tenant_mcp_servers.url` by the ctx-builder
 * upstream; this file has no hardcoded hostname.
 */

import type { AdapterCallContext, ExternalTaskEnvelope } from "../../types.js";
import { callMcpTool } from "../../mcpClient.js";
import { LASTMILE_TOOLS } from "./constants.js";
import { normalizeLastmileTask } from "./normalizeItem.js";
import { buildLastmileBlocks } from "./buildBlocks.js";
import { buildLastmileEditForm } from "./buildFormSchema.js";
import { forceRefreshLastmileUserToken } from "../../../../lib/oauth-token.js";

export async function refreshLastmileTask(args: {
	externalTaskId: string;
	ctx: AdapterCallContext;
}): Promise<ExternalTaskEnvelope> {
	const { externalTaskId, ctx } = args;

	if (!ctx.mcpServerUrl) {
		throw new Error(
			"[lastmile] refresh requires ctx.mcpServerUrl — resolve from tenant_mcp_servers.url before calling",
		);
	}
	if (!ctx.authToken) {
		throw new Error("[lastmile] refresh requires ctx.authToken");
	}

	const raw = await callMcpTool({
		url: ctx.mcpServerUrl,
		tool: LASTMILE_TOOLS.get,
		args: { task_id: externalTaskId },
		authToken: ctx.authToken,
		refreshToken:
			ctx.connectionId && ctx.tenantId
				? () => forceRefreshLastmileUserToken(ctx.connectionId!, ctx.tenantId)
				: undefined,
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
			params: { task_id: externalTaskId },
		},
		item,
		blocks,
		_refreshedAt: new Date().toISOString(),
	};
}
