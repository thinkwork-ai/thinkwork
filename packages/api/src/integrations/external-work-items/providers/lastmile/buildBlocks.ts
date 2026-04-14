/**
 * LastMile default block layout for a single-task envelope.
 *
 * task_header → field_list → badge_row → action_bar
 *
 * The edit form is NOT inlined — it opens as a bottom sheet modal when the
 * user clicks an action button (Change status / Assign / Comment / Edit),
 * handled by ExternalTaskCard's action dispatch layer.
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
	];
}
