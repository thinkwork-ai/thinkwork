/**
 * WorkspaceFileBadge (Unit 9).
 *
 * Renders a single badge describing where a workspace file is resolved
 * from in the overlay chain. Used in the agent + template workspace tree
 * views.
 *
 * Priority (top wins):
 *   1. updateAvailable → "Update available" (only meaningful for pinned
 *      files — caller is responsible for only setting it on PINNED_FILES)
 *   2. source === "agent-override" | "agent-override-pinned" → "Overridden"
 *   3. source === "template" | "template-pinned" → "Template"
 *   4. source === "defaults" → "Defaults"
 *
 * Pinned source labels collapse into the two operator-facing categories
 * (overridden / template) — the distinction between pinned and live
 * template content is not useful in the tree, only inside the accept
 * dialog.
 */

import { Badge } from "@/components/ui/badge";

export type ComposeSource =
	| "agent-override"
	| "agent-override-pinned"
	| "template"
	| "template-pinned"
	| "defaults";

export interface WorkspaceFileBadgeProps {
	source: ComposeSource;
	updateAvailable?: boolean;
}

export function WorkspaceFileBadge({
	source,
	updateAvailable,
}: WorkspaceFileBadgeProps) {
	if (updateAvailable) {
		return (
			<Badge
				variant="outline"
				className="text-[10px] px-1 py-0 border-amber-500 text-amber-500"
			>
				Update available
			</Badge>
		);
	}

	switch (source) {
		case "agent-override":
		case "agent-override-pinned":
			return (
				<Badge
					variant="outline"
					className="text-[10px] px-1 py-0 border-purple-500 text-purple-500"
				>
					Overridden
				</Badge>
			);
		case "template":
		case "template-pinned":
			return (
				<Badge
					variant="outline"
					className="text-[10px] px-1 py-0 text-muted-foreground"
				>
					Template
				</Badge>
			);
		case "defaults":
		default:
			return (
				<Badge
					variant="outline"
					className="text-[10px] px-1 py-0 text-muted-foreground"
				>
					Defaults
				</Badge>
			);
	}
}
