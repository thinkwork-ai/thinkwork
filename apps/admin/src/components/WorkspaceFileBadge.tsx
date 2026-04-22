/**
 * WorkspaceFileBadge (Unit 9).
 *
 * Renders a tiny source-indicator icon for a workspace file in the overlay
 * tree view. Filenames can run long — text badges push the name into
 * ellipsis truncation — so this is an icon + tooltip instead of a label.
 *
 * Priority (top wins):
 *   1. updateAvailable → amber AlertCircle
 *   2. agent-override(-pinned) → purple FilePen (file with edit pencil)
 *   3. template(-pinned)       → blue LayoutTemplate
 *   4. defaults                → muted Layers
 */

import { AlertCircle, Circle, Layers, LayoutTemplate } from "lucide-react";

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

	switch (source) {
		case "agent-override":
		case "agent-override-pinned":
			return (
				<Circle
					className="h-2 w-2 shrink-0 text-purple-500 fill-current"
					aria-label="Overridden"
				>
					<title>Overridden — agent-scoped edit</title>
				</Circle>
			);
		case "template":
		case "template-pinned":
			return (
				<LayoutTemplate
					className="h-3.5 w-3.5 shrink-0 text-blue-400/70"
					aria-label="Template"
				>
					<title>Inherited from template</title>
				</LayoutTemplate>
			);
		case "defaults":
		default:
			return (
				<Layers
					className="h-3.5 w-3.5 shrink-0 text-muted-foreground/60"
					aria-label="Defaults"
				>
					<title>Inherited from defaults</title>
				</Layers>
			);
	}
}
