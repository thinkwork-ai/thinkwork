/**
 * LastMile action mapper.
 *
 * Maps ThinkWork-native `TaskActionType` onto the LastMile MCP tool names.
 * After the mutation succeeds, re-fetches the task so callers get a fresh
 * envelope (same shape as `refresh()`).
 *
 * Wire format: every LastMile MCP tool uses camelCase argument keys
 * (`taskId`, `statusId`, `assigneeId`, `dueDate`, …) — verified against
 * `tools/list`. The server dispatcher does NOT enforce `required`, so a
 * snake_case arg silently becomes `undefined` and the handler returns
 * "Task not found." or writes nothing. This file is the one place that
 * does the snake_case → camelCase translation at the wire boundary;
 * call sites above pass the user-friendly ThinkWork keys.
 */

import type {
	AdapterCallContext,
	ExternalTaskEnvelope,
	TaskActionType,
} from "../../types.js";
import { callMcpTool } from "../../mcpClient.js";
import { LASTMILE_TOOLS } from "./constants.js";
import { refreshLastmileTask } from "./refresh.js";
import { forceRefreshLastmileUserToken } from "../../../../lib/oauth-token.js";

/**
 * Translate edit-form field keys → LastMile `task_update` MCP arg names.
 * The edit form (buildFormSchema.ts) emits user-friendly keys that differ
 * from what `task_update` expects. Pass through any key we don't know
 * about unchanged — LastMile validates + silently ignores unknowns.
 */
const EDIT_FIELD_MAP: Record<string, string> = {
	status: "statusId",
	assignee: "assigneeId",
	dueAt: "dueDate",
	// priority, description — keys already match MCP schema.
};

function translateEditFields(
	fields: Record<string, unknown>,
): Record<string, unknown> {
	const out: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(fields)) {
		if (value === undefined || value === null || value === "") continue;
		out[EDIT_FIELD_MAP[key] ?? key] = value;
	}
	return out;
}

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
	if (!ctx.mcpServerUrl) {
		throw new Error(
			"[lastmile] executeAction requires ctx.mcpServerUrl — resolve from tenant_mcp_servers.url before calling",
		);
	}

	const refreshToken =
		ctx.connectionId && ctx.tenantId
			? () => forceRefreshLastmileUserToken(ctx.connectionId!, ctx.tenantId)
			: undefined;

	switch (actionType) {
		case "external_task.update_status": {
			const statusId =
				params.statusId ?? params.status_id ?? params.value ?? params.status;
			if (!statusId) {
				throw new Error(
					"[lastmile] update_status requires params.statusId (opaque LastMile status id, e.g. 'status_hfcqtycmuaix6pjfnu3mb3ot')",
				);
			}
			await callMcpTool({
				url: ctx.mcpServerUrl,
				tool: LASTMILE_TOOLS.updateStatus,
				args: { taskId: externalTaskId, statusId },
				authToken: ctx.authToken,
				refreshToken,
			});
			break;
		}
		case "external_task.assign": {
			const assigneeId =
				params.assigneeId ??
				params.assignee_id ??
				params.userId ??
				params.assignee ??
				params.value;
			if (!assigneeId) {
				throw new Error(
					"[lastmile] assign requires params.assigneeId (LastMile user id)",
				);
			}
			await callMcpTool({
				url: ctx.mcpServerUrl,
				tool: LASTMILE_TOOLS.assign,
				args: { taskId: externalTaskId, assigneeId },
				authToken: ctx.authToken,
				refreshToken,
			});
			break;
		}
		case "external_task.comment": {
			throw new Error(
				"[lastmile] comment is not supported — LastMile MCP exposes no comment tool",
			);
		}
		case "external_task.edit_fields": {
			const { _formId: _ignoreFormId, ...fields } = params as Record<string, unknown>;
			await callMcpTool({
				url: ctx.mcpServerUrl,
				tool: LASTMILE_TOOLS.update,
				args: { taskId: externalTaskId, ...translateEditFields(fields) },
				authToken: ctx.authToken,
				refreshToken,
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
