/**
 * LastMile default block layout for a single-task envelope.
 *
 * task_header → field_list → badge_row → action_bar → activity_list
 *
 * The edit form is NOT inlined — it opens as a bottom sheet modal when the
 * user clicks an action button (Change status / Assign / Comment / Edit),
 * handled by ExternalTaskCard's action dispatch layer.
 *
 * The activity_list renders webhook-driven audit rows (status changes,
 * reassignments, comments) that arrive via the ingest pipeline and land in
 * the `messages` table with metadata.kind = "external_task_event". The
 * mobile renderer filters those system rows out of the chat timeline and
 * into this compact activity log on the task card.
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
			type: "activity_list",
			title: "Activity",
			limit: 10,
		},
	];
}
