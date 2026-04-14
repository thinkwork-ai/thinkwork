/**
 * LastMile task → NormalizedTask mapper.
 *
 * Defensive against both snake_case and camelCase keys since LastMile's MCP
 * response shape isn't pinned in this repo yet. When a real fixture lands in
 * __fixtures__/ tighten this to the exact shape.
 */

import type {
	NormalizedTask,
	TaskActionSpec,
	TaskFieldSpec,
} from "../../types.js";
import {
	LASTMILE_PRIORITY_OPTIONS,
	LASTMILE_STATUS_OPTIONS,
	priorityLabelFor,
	statusLabelFor,
} from "./constants.js";

function pick<T = unknown>(raw: Record<string, unknown>, ...keys: string[]): T | undefined {
	for (const k of keys) {
		const v = raw[k];
		if (v !== undefined && v !== null) return v as T;
	}
	return undefined;
}

function asString(v: unknown): string | undefined {
	return typeof v === "string" ? v : undefined;
}

function asArray<T = unknown>(v: unknown): T[] {
	return Array.isArray(v) ? (v as T[]) : [];
}

export function normalizeLastmileTask(raw: Record<string, unknown>): NormalizedTask {
	const id = asString(pick(raw, "id", "task_id", "taskId")) ?? "";
	const title = asString(pick(raw, "title", "name", "summary")) ?? "Untitled task";
	const description = asString(pick(raw, "description", "body", "details"));
	const statusRaw = asString(pick(raw, "status", "state"));
	const priorityRaw = asString(pick(raw, "priority", "importance"));
	const dueAt = asString(pick(raw, "due_at", "dueAt", "due_date", "dueDate"));
	const updatedAt = asString(pick(raw, "updated_at", "updatedAt", "modified_at"));
	const url = asString(pick(raw, "url", "web_url", "webUrl"));

	const assigneeRaw = pick<Record<string, unknown>>(raw, "assignee", "assigned_to", "assignedTo");
	const assignee = assigneeRaw
		? {
				id: asString(pick(assigneeRaw, "id", "user_id", "userId")),
				name:
					asString(pick(assigneeRaw, "name", "display_name", "displayName", "full_name")) ??
					asString(pick(assigneeRaw, "email")) ??
					"Unassigned",
				email: asString(pick(assigneeRaw, "email")),
			}
		: undefined;

	const labels = asArray<string | { name?: string; label?: string }>(
		pick(raw, "labels", "tags"),
	).map((l) => (typeof l === "string" ? l : (l?.name ?? l?.label ?? ""))).filter(Boolean);

	const fields: TaskFieldSpec[] = [
		{
			key: "status",
			label: "Status",
			type: "select",
			value: statusRaw,
			editable: true,
			options: LASTMILE_STATUS_OPTIONS,
		},
		{
			key: "priority",
			label: "Priority",
			type: "select",
			value: priorityRaw,
			editable: true,
			options: LASTMILE_PRIORITY_OPTIONS,
		},
		{
			key: "assignee",
			label: "Assignee",
			type: "user",
			value: assignee?.id ?? assignee?.email,
			editable: true,
		},
		{
			key: "dueAt",
			label: "Due",
			type: "date",
			value: dueAt,
			editable: true,
		},
		{
			key: "labels",
			label: "Labels",
			type: "chips",
			value: labels,
			editable: false,
		},
	];

	const actions: TaskActionSpec[] = [
		{
			id: "act_update_status",
			type: "external_task.update_status",
			label: "Change status",
			variant: "secondary",
			formId: "form_edit",
		},
		{
			id: "act_assign",
			type: "external_task.assign",
			label: "Assign",
			variant: "secondary",
			formId: "form_edit",
		},
		{
			id: "act_comment",
			type: "external_task.comment",
			label: "Comment",
			variant: "secondary",
		},
		{
			id: "act_edit_fields",
			type: "external_task.edit_fields",
			label: "Edit",
			variant: "primary",
			formId: "form_edit",
		},
	];

	return {
		core: {
			id,
			provider: "lastmile",
			title,
			description,
			status: statusLabelFor(statusRaw),
			priority: priorityLabelFor(priorityRaw),
			assignee,
			dueAt,
			url,
			updatedAt,
		},
		capabilities: {
			getTask: true,
			listTasks: true,
			updateStatus: true,
			assignTask: true,
			commentOnTask: true,
			editTaskFields: true,
			createTask: false,
		},
		fields,
		actions,
		raw,
	};
}
