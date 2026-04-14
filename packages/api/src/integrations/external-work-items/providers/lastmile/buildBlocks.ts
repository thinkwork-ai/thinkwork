/**
 * LastMile default block layout for a single-task envelope.
 *
 * task_header → field_list → badge_row → action_bar → form
 */

import type { NormalizedTask, TaskBlock } from "../../types.js";

export function buildLastmileBlocks(_item: NormalizedTask): TaskBlock[] {
	return [
		{
			type: "task_header",
			showSource: true,
			showUpdatedAt: true,
		},
		{
			type: "field_list",
			fieldKeys: ["status", "priority", "assignee", "dueAt"],
			columns: 2,
		},
		{
			type: "badge_row",
			fieldKeys: ["labels"],
		},
		{
			type: "action_bar",
			actionIds: ["act_update_status", "act_assign", "act_comment", "act_edit_fields"],
		},
		{
			type: "form",
			formId: "form_edit",
		},
	];
}
