/**
 * LastMile default block layout for a single-task envelope.
 *
 * task_header → field_list → badge_row → activity_list
 *
 * The edit form is NOT inlined — it opens as a bottom sheet modal when the
 * user taps the pencil icon rendered in the task_header block by the mobile
 * renderer (see apps/mobile/components/genui/external-task/blocks/TaskHeader.tsx).
 *
 * The old action_bar block (Change status / Assign / Comment / Edit) was
 * removed because update_status / assign / comment were broken (PR F #80) and
 * the only working path was edit_fields. That action now lives as a compact
 * header button instead of a 4-button footer.
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
			columns: 1,
		},
		{
			type: "badge_row",
			fieldKeys: ["labels"],
		},
		{
			type: "activity_list",
			title: "Activity",
			limit: 10,
		},
	];
}
