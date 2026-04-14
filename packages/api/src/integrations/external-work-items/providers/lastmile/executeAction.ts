/**
 * LastMile action mapper.
 *
 * Maps ThinkWork-native `TaskActionType` onto the LastMile MCP tool names.
 * After the mutation succeeds, re-fetches the task so callers get a fresh
 * envelope (same shape as `refresh()`).
 *
 * All LastMile-specific tool-name strings live here. No call site above this
 * module should know a string like `task_update_status`.
 */

import type {
	AdapterCallContext,
	ExternalTaskEnvelope,
	TaskActionType,
} from "../../types.js";
import { callMcpTool } from "../../mcpClient.js";
import { LASTMILE_MCP_SERVER, LASTMILE_TOOLS } from "./constants.js";
import { refreshLastmileTask } from "./refresh.js";

export async function executeLastmileAction(args: {
	actionType: TaskActionType;
	externalTaskId: string;
	params: Record<string, unknown>;
	ctx: AdapterCallContext;
}): Promise<ExternalTaskEnvelope> {
	const { actionType, externalTaskId, params, ctx } = args;

	if (!ctx.authToken) {
		throw new Error(
			"[lastmile] executeAction requires a per-user OAuth token in ctx.authToken",
		);
	}

	switch (actionType) {
		case "external_task.update_status": {
			const status = params.value ?? params.status;
			if (!status) throw new Error("[lastmile] update_status requires params.value or params.status");
			await callMcpTool({
				server: LASTMILE_MCP_SERVER,
				tool: LASTMILE_TOOLS.updateStatus,
				args: { id: externalTaskId, status },
				authToken: ctx.authToken,
			});
			break;
		}
		case "external_task.assign": {
			const userId = params.userId ?? params.assignee ?? params.value;
			if (!userId) throw new Error("[lastmile] assign requires params.userId");
			await callMcpTool({
				server: LASTMILE_MCP_SERVER,
				tool: LASTMILE_TOOLS.assign,
				args: { id: externalTaskId, userId },
				authToken: ctx.authToken,
			});
			break;
		}
		case "external_task.comment": {
			const body = params.body ?? params.value ?? params.text;
			if (!body) throw new Error("[lastmile] comment requires params.body");
			await callMcpTool({
				server: LASTMILE_MCP_SERVER,
				tool: LASTMILE_TOOLS.addComment,
				args: { id: externalTaskId, body },
				authToken: ctx.authToken,
			});
			break;
		}
		case "external_task.edit_fields": {
			const { _formId: _ignoreFormId, ...fields } = params as Record<string, unknown>;
			await callMcpTool({
				server: LASTMILE_MCP_SERVER,
				tool: LASTMILE_TOOLS.update,
				args: { id: externalTaskId, ...fields },
				authToken: ctx.authToken,
			});
			break;
		}
		case "external_task.refresh": {
			break;
		}
		default: {
			const _exhaustive: never = actionType;
			throw new Error(`[lastmile] unknown action type: ${String(_exhaustive)}`);
		}
	}

	return refreshLastmileTask({ externalTaskId, ctx });
}
