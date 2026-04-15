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
			// `task_update_status` takes (task_id, status_id). Callers who
			// supply a raw value string (from the mobile form's select) are
			// responsible for mapping it to a LastMile opaque status id —
			// the value/id mapping is a product follow-up (see PR G scope).
			const statusId = params.status_id ?? params.value ?? params.status;
			if (!statusId) {
				throw new Error(
					"[lastmile] update_status requires params.status_id (opaque LastMile status id, e.g. 'status_hfcqtycmuaix6pjfnu3mb3ot')",
				);
			}
			await callMcpTool({
				server: LASTMILE_MCP_SERVER,
				tool: LASTMILE_TOOLS.updateStatus,
				args: { task_id: externalTaskId, status_id: statusId },
				authToken: ctx.authToken,
			});
			break;
		}
		case "external_task.assign": {
			// `task_update_assignee` takes (task_id, assignee_id) — the
			// assignee_id is a LastMile user id like `user_wv4f3er5wsd...`.
			const assigneeId =
				params.assignee_id ?? params.userId ?? params.assignee ?? params.value;
			if (!assigneeId) {
				throw new Error(
					"[lastmile] assign requires params.assignee_id (LastMile user id)",
				);
			}
			await callMcpTool({
				server: LASTMILE_MCP_SERVER,
				tool: LASTMILE_TOOLS.assign,
				args: { task_id: externalTaskId, assignee_id: assigneeId },
				authToken: ctx.authToken,
			});
			break;
		}
		case "external_task.comment": {
			// LastMile's MCP server does not expose a comment tool at all
			// (verified via `tools/list` — there is no `task_add_comment`
			// or equivalent). Fail fast with a clear message instead of
			// silently calling a non-existent tool; the mobile card should
			// hide the Comment button via `capabilities.commentOnTask` but
			// this is the defensive backstop.
			throw new Error(
				"[lastmile] comment is not supported — LastMile MCP exposes no comment tool",
			);
		}
		case "external_task.edit_fields": {
			const { _formId: _ignoreFormId, ...fields } = params as Record<string, unknown>;
			await callMcpTool({
				server: LASTMILE_MCP_SERVER,
				tool: LASTMILE_TOOLS.update,
				args: { task_id: externalTaskId, ...fields },
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
