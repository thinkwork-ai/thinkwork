/**
 * WorkspaceFileBadge (Unit 9).
 *
 * Renders a source-indicator icon in the workspace tree — but ONLY when
 * the file is in a non-default state. Template / defaults inheritance is
 * the common case; rendering a per-file icon for it adds visual noise
 * without telling the operator anything actionable. So we return null
 * for those cases and only mark:
 *
 *   - updateAvailable → amber AlertCircle
 *   - agent-override(-pinned) → filled purple dot (VS Code "modified
 *     from base" convention)
 */

import { AlertCircle, Circle } from "lucide-react";

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
			<AlertCircle
				className="h-3.5 w-3.5 shrink-0 text-amber-500"
				aria-label="Template update available"
			>
				<title>Template update available</title>
			</AlertCircle>
		);
	}

	if (source === "agent-override" || source === "agent-override-pinned") {
		return (
			<Circle
				className="h-2 w-2 shrink-0 text-purple-500 fill-current"
				aria-label="Overridden"
			>
				<title>Overridden — agent-scoped edit</title>
			</Circle>
		);
	}

	// Template / defaults inheritance — render nothing. Clean state is
	// the common case; only non-default state earns a marker.
	return null;
}
