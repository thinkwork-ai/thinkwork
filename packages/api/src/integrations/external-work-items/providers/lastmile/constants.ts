/**
 * LastMile Tasks MCP tool names + lookup tables.
 *
 * Every string like `task_update_status` lives here so the rest of the code
 * operates on `TaskActionType` enums only. When LastMile renames a tool, this
 * is the one file to touch.
 */

import type { TaskOption } from "../../types.js";

/** MCP server subpath (appended to LASTMILE_MCP_BASE_URL). */
export const LASTMILE_MCP_SERVER = "tasks";

/** MCP tool names exposed by the LastMile Tasks server.
 *
 * Ground-truth names come from LastMile's `tools/list` JSON-RPC response.
 * Reads are pluralized (`tasks_get`, `tasks_list`); writes are singular
 * (`task_update`, `task_update_status`). The "get a task" tool requires
 * `task_id` (not `id`) as its argument — see refresh.ts.
 */
export const LASTMILE_TOOLS = {
	get: "tasks_get",
	list: "tasks_list",
	updateStatus: "task_update_status",
	assign: "task_assign",
	addComment: "task_add_comment",
	update: "task_update",
} as const;

export const LASTMILE_STATUS_OPTIONS: TaskOption[] = [
	{ value: "todo", label: "To do", color: "slate" },
	{ value: "in_progress", label: "In progress", color: "amber" },
	{ value: "blocked", label: "Blocked", color: "red" },
	{ value: "done", label: "Done", color: "green" },
	{ value: "cancelled", label: "Cancelled", color: "slate" },
];

export const LASTMILE_PRIORITY_OPTIONS: TaskOption[] = [
	{ value: "urgent", label: "Urgent", color: "red" },
	{ value: "high", label: "High", color: "amber" },
	{ value: "normal", label: "Normal", color: "slate" },
	{ value: "low", label: "Low", color: "slate" },
];

export function statusLabelFor(value: string | undefined): { value: string; label: string; color?: string } | undefined {
	if (!value) return undefined;
	const opt = LASTMILE_STATUS_OPTIONS.find((o) => o.value === value);
	return opt ? { value: opt.value, label: opt.label, color: opt.color } : { value, label: value };
}

export function priorityLabelFor(value: string | undefined): { value: string; label: string; color?: string } | undefined {
	if (!value) return undefined;
	const opt = LASTMILE_PRIORITY_OPTIONS.find((o) => o.value === value);
	return opt ? { value: opt.value, label: opt.label, color: opt.color } : { value, label: value };
}
