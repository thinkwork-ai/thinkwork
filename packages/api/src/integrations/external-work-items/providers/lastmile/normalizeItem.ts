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
	TaskOption,
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

/**
 * LastMile's `tasks_get` returns `status` / `priority` as populated
 * objects — `{id, name, color, icon}` — not the legacy value strings
 * older fixtures used. Unwrap whichever we're handed:
 *
 * - string like `"in_progress"` → fall through to `statusLabelFor()`
 *   which maps it against the curated option set (legacy fixture path)
 * - object like `{id: "status_hfcq...", name: "Backlog", color: "#..."}`
 *   → emit `{value: id, label: name, color}` so the card renders the
 *   LastMile-native label and the id round-trips on future updates
 * - anything else → undefined
 */
function unwrapOption(
	v: unknown,
	legacyLookup: (s: string) => { value: string; label: string; color?: string } | undefined,
): { value: string; label: string; color?: string } | undefined {
	if (v === undefined || v === null) return undefined;
	if (typeof v === "string") return legacyLookup(v);
	if (typeof v === "object" && !Array.isArray(v)) {
		const obj = v as Record<string, unknown>;
		const id = asString(pick(obj, "id", "value"));
		const name = asString(pick(obj, "name", "label"));
		if (id && name) {
			const color = asString(pick(obj, "color"));
			return color ? { value: id, label: name, color } : { value: id, label: name };
		}
	}
	return undefined;
}

export function normalizeLastmileTask(raw: Record<string, unknown>): NormalizedTask {
	const id = asString(pick(raw, "id", "task_id", "taskId")) ?? "";
	const title = asString(pick(raw, "title", "name", "summary")) ?? "Untitled task";
	const description = asString(pick(raw, "description", "body", "details"));
	const statusRaw = pick(raw, "status", "state");
	const priorityRaw = pick(raw, "priority", "importance");
	const status = unwrapOption(statusRaw, statusLabelFor);
	const priority = unwrapOption(priorityRaw, priorityLabelFor);
	const dueAt = asString(pick(raw, "due_at", "dueAt", "due_date", "dueDate"));
	const updatedAt = asString(pick(raw, "updated_at", "updatedAt", "modified_at"));
	const url = asString(pick(raw, "url", "web_url", "webUrl"));

	// LastMile's real `tasks_get` response nests a populated `assignee`
	// object — `{id, first_name, last_name, email}`. Older fixtures used
	// `{id, name, email}` or a direct `assignee_id` string. Support all
	// three shapes and prefer the richest. Name resolution chain:
	//   1. explicit `name` / `display_name` / `displayName` / `full_name`
	//   2. `"${first_name} ${last_name}"` (what LastMile actually ships)
	//   3. `first_name` alone
	//   4. `email`
	//   5. raw id as last resort
	const assigneeRaw = pick<Record<string, unknown>>(raw, "assignee", "assigned_to", "assignedTo");
	const assigneeIdDirect = asString(pick(raw, "assignee_id", "owner_id", "assigneeId", "ownerId"));
	function resolveAssigneeName(obj: Record<string, unknown>): string | undefined {
		const direct = asString(
			pick(obj, "name", "display_name", "displayName", "full_name"),
		);
		if (direct) return direct;
		const first = asString(pick(obj, "first_name", "firstName"));
		const last = asString(pick(obj, "last_name", "lastName"));
		if (first && last) return `${first} ${last}`;
		if (first) return first;
		return asString(pick(obj, "email"));
	}
	const assignee = assigneeRaw
		? {
				id: asString(pick(assigneeRaw, "id", "user_id", "userId")),
				name: resolveAssigneeName(assigneeRaw) ?? "Unassigned",
				email: asString(pick(assigneeRaw, "email")),
			}
		: assigneeIdDirect
			? { id: assigneeIdDirect, name: assigneeIdDirect }
			: undefined;

	const labels = asArray<string | { name?: string; label?: string }>(
		pick(raw, "labels", "tags"),
	).map((l) => (typeof l === "string" ? l : (l?.name ?? l?.label ?? ""))).filter(Boolean);

	// Inject the unwrapped option into each select's option set so the mobile
	// FieldList renderer (which looks up `field.value` in `field.options` for
	// a label) finds a match when the value is a real LastMile opaque id like
	// `status_hfcqtycmuaix6pjfnu3mb3ot`. Without this the renderer falls back
	// to `String(field.value)` and shows the raw id in the card.
	function mergeOption(
		base: readonly TaskOption[],
		extra: { value: string; label: string; color?: string } | undefined,
	): TaskOption[] {
		if (!extra) return [...base];
		if (base.some((o) => o.value === extra.value)) return [...base];
		return [...base, { value: extra.value, label: extra.label, color: extra.color }];
	}
	const statusOptions = mergeOption(LASTMILE_STATUS_OPTIONS, status);
	const priorityOptions = mergeOption(LASTMILE_PRIORITY_OPTIONS, priority);

	const fields: TaskFieldSpec[] = [
		{
			key: "status",
			label: "Status",
			type: "select",
			// Prefer the unwrapped id so a future save-edit round-trips the
			// real LastMile opaque id; fall through to the raw string for
			// legacy fixture compatibility.
			value: status?.value ?? asString(statusRaw),
			editable: true,
			options: statusOptions,
		},
		{
			key: "priority",
			label: "Priority",
			type: "select",
			value: priority?.value ?? asString(priorityRaw),
			editable: true,
			options: priorityOptions,
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

	// Comment action omitted — LastMile MCP exposes no comment tool, so
	// surfacing a button that always throws would be worse UX than just
	// hiding it. `capabilities.commentOnTask` is also false below.
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
			status,
			priority,
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
			commentOnTask: false,
			editTaskFields: true,
			createTask: false,
		},
		fields,
		actions,
		raw,
	};
}
