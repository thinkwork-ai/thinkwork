/**
 * AcceptTemplateUpdateDialog (Unit 9).
 *
 * Shows a side-by-side diff of the agent's current pinned content vs. the
 * current template-base content for a single pinned-class file. On
 * accept, invokes the `acceptTemplateUpdate` GraphQL mutation which
 * advances the pin and deletes any agent-scoped override.
 *
 * Diff view is plain side-by-side <pre> blocks — keeps the admin bundle
 * free of a second editor dep (CodeMirror is already in use for the
 * workspace tab; Monaco would be a separate install just for this
 * dialog).
 */

import { useState } from "react";
import { gql, useMutation } from "urql";
import { Loader2 } from "lucide-react";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

const AcceptTemplateUpdateMutation = gql`
	mutation AcceptTemplateUpdate($agentId: ID!, $filename: String!) {
		acceptTemplateUpdate(agentId: $agentId, filename: $filename) {
			id
			name
			slug
		}
	}
`;

export interface AcceptTemplateUpdateDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	agentId: string;
	filename: string;
	pinnedContent: string | null;
	latestContent: string | null;
	onAccepted?: () => void;
}

export function AcceptTemplateUpdateDialog({
	open,
	onOpenChange,
	agentId,
	filename,
	pinnedContent,
	latestContent,
	onAccepted,
}: AcceptTemplateUpdateDialogProps) {
	const [, acceptMutation] = useMutation(AcceptTemplateUpdateMutation);
	const [submitting, setSubmitting] = useState(false);
	const [error, setError] = useState<string | null>(null);

	async function handleAccept() {
		setSubmitting(true);
		setError(null);
		try {
			const result = await acceptMutation({ agentId, filename });
			if (result.error) {
				setError(result.error.message);
				return;
			}
			onAccepted?.();
			onOpenChange(false);
		} catch (err) {
			setError(err instanceof Error ? err.message : "Unexpected error");
		} finally {
			setSubmitting(false);
		}
	}

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="max-w-5xl max-h-[85vh] flex flex-col">
				<DialogHeader>
					<DialogTitle>Accept template update: {filename}</DialogTitle>
					<DialogDescription>
						Reviewing changes to this guardrail-class file before advancing the
						agent's pin. Accepting will replace the agent's current pinned
						content with the latest template version and remove any local
						override.
					</DialogDescription>
				</DialogHeader>

				<div className="grid grid-cols-2 gap-3 flex-1 min-h-0 overflow-hidden">
					<div className="flex flex-col border rounded-md overflow-hidden">
						<div className="px-3 py-2 text-xs font-medium bg-muted/50 border-b">
							Current (pinned)
						</div>
						<pre className="flex-1 overflow-auto p-3 text-xs font-mono whitespace-pre-wrap break-words">
							{pinnedContent ?? "(pinned content unavailable — may have been lost from version store)"}
						</pre>
					</div>
					<div className="flex flex-col border rounded-md overflow-hidden">
						<div className="px-3 py-2 text-xs font-medium bg-muted/50 border-b text-amber-500">
							Latest (template)
						</div>
						<pre className="flex-1 overflow-auto p-3 text-xs font-mono whitespace-pre-wrap break-words">
							{latestContent ?? "(template content unavailable)"}
						</pre>
					</div>
				</div>

				{error && (
					<div className="text-xs text-destructive px-1 py-1">{error}</div>
				)}

				<DialogFooter>
					<Button
						variant="outline"
						onClick={() => onOpenChange(false)}
						disabled={submitting}
					>
						Cancel
					</Button>
					<Button onClick={handleAccept} disabled={submitting || !latestContent}>
						{submitting && <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />}
						Accept update
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
