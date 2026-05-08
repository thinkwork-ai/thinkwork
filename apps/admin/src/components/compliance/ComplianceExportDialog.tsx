import { useState } from "react";
import { useMutation } from "urql";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import {
	ComplianceActorType,
	ComplianceEventType,
	type ComplianceExportFormat,
} from "@/gql/graphql";
import {
	resolveSince,
	type ComplianceSearchParams,
} from "@/lib/compliance/url-search-params";
import { CreateComplianceExportMutation } from "@/lib/compliance/export-queries";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogBody,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

export interface ComplianceExportDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	/** Filter pulled from URL search-params (events list page state). */
	search: ComplianceSearchParams;
	/** Optional callback fired with the queued job — Exports page uses it to optimistically prepend. */
	onSubmitted?: (jobId: string) => void;
}

interface ExportFilter {
	tenantId?: string | null;
	actorType?: ComplianceActorType | null;
	eventType?: ComplianceEventType | null;
	since?: string | null;
	until?: string | null;
}

/** Build the ComplianceEventFilter input from URL search-params + resolved range. */
function buildFilter(search: ComplianceSearchParams): ExportFilter {
	const since = search.since ?? resolveSince(search);
	return {
		tenantId: search.tenantId ?? null,
		actorType: search.actorType ?? null,
		eventType: search.eventType ?? null,
		since: since ?? null,
		until: search.until ?? null,
	};
}

/** Render a compact "key=value · key=value" preview for the dialog. */
function summarizeFilter(filter: ExportFilter): string[] {
	const parts: string[] = [];
	if (filter.tenantId) parts.push(`tenantId=${filter.tenantId}`);
	if (filter.actorType) parts.push(`actorType=${filter.actorType}`);
	if (filter.eventType) parts.push(`eventType=${filter.eventType}`);
	if (filter.since) parts.push(`since=${filter.since}`);
	if (filter.until) parts.push(`until=${filter.until}`);
	return parts;
}

export function ComplianceExportDialog({
	open,
	onOpenChange,
	search,
	onSubmitted,
}: ComplianceExportDialogProps) {
	const [format, setFormat] = useState<ComplianceExportFormat>(
		"CSV" as ComplianceExportFormat,
	);
	const [, executeMutation] = useMutation(CreateComplianceExportMutation);
	const [submitting, setSubmitting] = useState(false);

	const filter = buildFilter(search);
	const summary = summarizeFilter(filter);

	const handleSubmit = async () => {
		setSubmitting(true);
		try {
			const result = await executeMutation({ filter, format });
			if (result.error) {
				const code =
					result.error.graphQLErrors?.[0]?.extensions?.code ?? "ERROR";
				toast.error(
					code === "RATE_LIMIT_EXCEEDED"
						? "Export rate limit exceeded (10/hour). Try again later."
						: code === "FILTER_RANGE_TOO_WIDE"
							? "Filter range exceeds the 90-day cap. Narrow the window and retry."
							: code === "FILTER_TOO_LARGE"
								? "Filter exceeds the 4 KB byte cap. Simplify the filter and retry."
								: result.error.message || "Failed to queue export.",
				);
				return;
			}
			const job = result.data?.createComplianceExport;
			if (job) {
				toast.success("Export queued.");
				onSubmitted?.(job.jobId);
				onOpenChange(false);
			}
		} finally {
			setSubmitting(false);
		}
	};

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>Request compliance export</DialogTitle>
					<DialogDescription>
						Queue an async export of audit events matching the current filter.
						Exports run in the background; you'll see the download link here
						when it's ready.
					</DialogDescription>
				</DialogHeader>
				<DialogBody className="space-y-4">
					<div className="space-y-1.5">
						<div className="text-xs text-muted-foreground">Format</div>
						<ToggleGroup
							type="single"
							value={format}
							onValueChange={(v) => {
								if (v) setFormat(v as ComplianceExportFormat);
							}}
							className="w-fit"
						>
							<ToggleGroupItem value="CSV">CSV</ToggleGroupItem>
							<ToggleGroupItem value="JSON">JSON (NDJSON)</ToggleGroupItem>
						</ToggleGroup>
					</div>

					<div className="space-y-1.5">
						<div className="text-xs text-muted-foreground">Filter</div>
						{summary.length === 0 ? (
							<p className="text-sm">
								<span className="text-muted-foreground">
									No filter applied — exports every audit event the caller can
									see (capped at 90 days by the server).
								</span>
							</p>
						) : (
							<div className="rounded-md border bg-muted/40 p-3">
								<ul className="space-y-1 font-mono text-xs">
									{summary.map((part) => (
										<li key={part}>{part}</li>
									))}
								</ul>
							</div>
						)}
					</div>

					<p className="text-xs text-muted-foreground">
						Hard caps: 90-day filter range · 4 KB filter size · 10 exports per
						hour per operator.
					</p>
				</DialogBody>
				<DialogFooter>
					<Button
						type="button"
						variant="ghost"
						onClick={() => onOpenChange(false)}
						disabled={submitting}
					>
						Cancel
					</Button>
					<Button type="button" onClick={handleSubmit} disabled={submitting}>
						{submitting ? (
							<>
								<Loader2 className="size-3.5 animate-spin" />
								Queuing…
							</>
						) : (
							"Queue export"
						)}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
