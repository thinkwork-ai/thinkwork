/**
 * LastMile edit-form schema.
 *
 * Returned by `buildFormSchema(item)` and bundled onto the envelope so the
 * renderer can show a form without a second round-trip. `actionType` is set to
 * `external_task.edit_fields` — the form block submits directly to
 * `executeExternalTaskAction`, bypassing any agent turn.
 */

import type { NormalizedTask, TaskFormSchema } from "../../types.js";
import { LASTMILE_PRIORITY_OPTIONS, LASTMILE_STATUS_OPTIONS } from "./constants.js";

export function buildLastmileEditForm(item: NormalizedTask): TaskFormSchema {
	return {
		id: "form_edit",
		title: "Edit task",
		description: `Edit ${item.core.title}`,
		submitLabel: "Save changes",
		cancelLabel: "Cancel",
		actionType: "external_task.edit_fields",
		fields: [
			{
				key: "status",
				label: "Status",
				type: "select",
				required: false,
				defaultValue: item.core.status?.value,
				options: LASTMILE_STATUS_OPTIONS,
			},
			{
				key: "priority",
				label: "Priority",
				type: "select",
				required: false,
				defaultValue: item.core.priority?.value,
				options: LASTMILE_PRIORITY_OPTIONS,
			},
			{
				key: "assignee",
				label: "Assignee",
				type: "user",
				required: false,
				defaultValue: item.core.assignee?.id ?? item.core.assignee?.email,
			},
			{
				key: "dueAt",
				label: "Due date",
				type: "date",
				required: false,
				defaultValue: item.core.dueAt,
			},
			{
				key: "description",
				label: "Description",
				type: "textarea",
				required: false,
				defaultValue: item.core.description,
				validation: { maxLength: 4000 },
			},
		],
	};
}
