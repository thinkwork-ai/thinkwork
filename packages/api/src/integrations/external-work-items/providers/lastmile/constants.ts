/**
 * LastMile Tasks MCP tool names + lookup tables.
 *
 * Every string like `task_update_status` lives here so the rest of the code
 * operates on `TaskActionType` enums only. When LastMile renames a tool, this
 * is the one file to touch.
 */

import type { TaskOption } from "../../types.js";

/** MCP tool names exposed by the LastMile Tasks server.
 *
 * Ground-truth names come from LastMile's `tools/list` JSON-RPC response
 * against dev-mcp.lastmile-tei.com. Reads are pluralized (`tasks_get`,
 * `tasks_list`); writes are singular (`task_update`, `task_update_status`,
 * `task_update_assignee`). **Every tool uses camelCase argument keys**
 * (`taskId`, `statusId`, `assigneeId`, `dueDate`, …) — snake_case args
 * are silently dropped by the dispatcher and produce "Task not found." /
 * no-op writes. See `executeAction.ts` for the per-tool mapping.
 *
 * There is NO comment tool on the server. The Comment action is
 * unsupported for now; `executeLastmileAction` throws a clear error when
 * invoked and `normalizeLastmileTask` sets `capabilities.commentOnTask =
 * false` so the mobile card hides the button via the capability gate.
 */
export const LASTMILE_TOOLS = {
	get: "tasks_get",
	list: "tasks_list",
	updateStatus: "task_update_status",
	assign: "task_update_assignee",
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
