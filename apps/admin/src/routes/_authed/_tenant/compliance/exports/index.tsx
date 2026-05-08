import { useEffect, useMemo, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "urql";
import {
	AlertCircle,
	ArrowLeft,
	CheckCircle,
	Download,
	Loader2,
	Plus,
} from "lucide-react";
import { ComplianceExportStatus } from "@/gql/graphql";
import { ComplianceExportsQuery } from "@/lib/compliance/export-queries";
import {
	validateComplianceSearch,
	type ComplianceSearchParams,
} from "@/lib/compliance/url-search-params";
import { useBreadcrumbs } from "@/context/BreadcrumbContext";
import { PageHeader } from "@/components/PageHeader";
import { PageLayout } from "@/components/PageLayout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import { ComplianceExportDialog } from "@/components/compliance/ComplianceExportDialog";
import { formatDateTime, relativeTime, cn } from "@/lib/utils";

interface ExportsRouteSearch extends ComplianceSearchParams {
	from?: "current-filter";
}

const SKELETON_ROW_COUNT = 5;
const POLL_INTERVAL_MS = 3000;

export const Route = createFileRoute("/_authed/_tenant/compliance/exports/")({
	component: ComplianceExportsPage,
	validateSearch: (search): ExportsRouteSearch => {
		const base = validateComplianceSearch(search);
		const from =
			search.from === "current-filter"
				? ("current-filter" as const)
				: undefined;
		return from ? { ...base, from } : base;
	},
});

function ComplianceExportsPage() {
	const search = Route.useSearch();
	const navigate = useNavigate();
	useBreadcrumbs([
		{ label: "Compliance", href: "/compliance" },
		{ label: "Exports" },
	]);

	const [dialogOpen, setDialogOpen] = useState(false);

	// Auto-open the dialog when the user navigated here via the
	// "Export this view" button (URL carries ?from=current-filter).
	useEffect(() => {
		if (search.from === "current-filter") {
			setDialogOpen(true);
			navigate({
				to: "/compliance/exports",
				search: (prev) => {
					const next = { ...prev } as Record<string, unknown>;
					delete next.from;
					return next as ExportsRouteSearch;
				},
				replace: true,
			});
		}
	}, [search.from, navigate]);

	// Always run the query; pollInterval is dynamic based on whether
	// any job is in QUEUED/RUNNING. urql treats 0 as "no polling".
	const [{ data, fetching, error }, refetch] = useQuery({
		query: ComplianceExportsQuery,
	});

	const jobs = useMemo(() => data?.complianceExports ?? [], [data]);
	const hasActiveJobs = useMemo(
		() =>
			jobs.some(
				(j) =>
					j.status === ComplianceExportStatus.Queued ||
					j.status === ComplianceExportStatus.Running,
			),
		[jobs],
	);

	// Polling effect — interval IDs cycle with hasActiveJobs.
	useEffect(() => {
		if (!hasActiveJobs) return;
		const id = setInterval(() => {
			refetch({ requestPolicy: "network-only" });
		}, POLL_INTERVAL_MS);
		return () => clearInterval(id);
	}, [hasActiveJobs, refetch]);

	const isFirstLoad = fetching && !data;

	return (
		<PageLayout
			header={
				<PageHeader
					title="Compliance exports"
					description="Async CSV / NDJSON exports of audit events."
					actions={
						<>
							<Button asChild variant="outline" size="sm">
								<Link to="/compliance" search={(prev) => prev}>
									<ArrowLeft className="size-3.5" />
									Back to events
								</Link>
							</Button>
							<Button
								type="button"
								size="sm"
								onClick={() => setDialogOpen(true)}
							>
								<Plus className="size-3.5" />
								New export
							</Button>
						</>
					}
				/>
			}
		>
			<div className="space-y-3">
				{error ? (
					<div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive flex items-center justify-between gap-3">
						<span>Failed to load exports: {error.message}</span>
						<Button
							type="button"
							size="sm"
							variant="outline"
							onClick={() => refetch({ requestPolicy: "network-only" })}
						>
							Retry
						</Button>
					</div>
				) : null}

				<Table>
					<TableHeader>
						<TableRow>
							<TableHead className="w-[10rem]">Status</TableHead>
							<TableHead className="w-[14rem]">Requested</TableHead>
							<TableHead className="w-[8rem]">Format</TableHead>
							<TableHead>Filter</TableHead>
							<TableHead className="w-[14rem]">Action</TableHead>
						</TableRow>
					</TableHeader>
					<TableBody>
						{isFirstLoad ? (
							Array.from({ length: SKELETON_ROW_COUNT }).map((_, i) => (
								<TableRow key={`skeleton-${i}`}>
									<TableCell><Skeleton className="h-4 w-24" /></TableCell>
									<TableCell><Skeleton className="h-4 w-32" /></TableCell>
									<TableCell><Skeleton className="h-4 w-12" /></TableCell>
									<TableCell><Skeleton className="h-4 w-48" /></TableCell>
									<TableCell><Skeleton className="h-4 w-28" /></TableCell>
								</TableRow>
							))
						) : jobs.length === 0 ? (
							<TableRow>
								<TableCell
									colSpan={5}
									className="text-center text-sm text-muted-foreground py-12"
								>
									No exports yet. Click "New export" to queue one.
								</TableCell>
							</TableRow>
						) : (
							jobs.map((job) => (
								<TableRow key={job.jobId}>
									<TableCell className="align-top">
										<StatusBadge status={job.status} />
										{job.status === ComplianceExportStatus.Failed &&
										job.jobError ? (
											<div
												className="mt-1 max-w-[10rem] truncate text-xs text-destructive"
												title={job.jobError}
											>
												{job.jobError}
											</div>
										) : null}
									</TableCell>
									<TableCell className="align-top">
										<div className="text-sm">{relativeTime(job.requestedAt)}</div>
										<div className="text-xs text-muted-foreground">
											{formatDateTime(job.requestedAt)}
										</div>
									</TableCell>
									<TableCell className="align-top">
										<Badge variant="secondary">{job.format}</Badge>
									</TableCell>
									<TableCell className="align-top">
										<FilterCell filter={job.filter} />
									</TableCell>
									<TableCell className="align-top">
										<ActionCell job={job} />
									</TableCell>
								</TableRow>
							))
						)}
					</TableBody>
				</Table>
			</div>

			<ComplianceExportDialog
				open={dialogOpen}
				onOpenChange={setDialogOpen}
				search={search}
				onSubmitted={() => refetch({ requestPolicy: "network-only" })}
			/>
		</PageLayout>
	);
}

function StatusBadge({ status }: { status: ComplianceExportStatus }) {
	if (status === ComplianceExportStatus.Complete) {
		return (
			<span className={cn("inline-flex items-center gap-1.5 text-xs font-medium text-emerald-700 dark:text-emerald-400")}>
				<CheckCircle className="size-3.5" />
				Complete
			</span>
		);
	}
	if (status === ComplianceExportStatus.Failed) {
		return (
			<span className={cn("inline-flex items-center gap-1.5 text-xs font-medium text-destructive")}>
				<AlertCircle className="size-3.5" />
				Failed
			</span>
		);
	}
	// QUEUED + RUNNING — both render with the spinner.
	return (
		<span className={cn("inline-flex items-center gap-1.5 text-xs font-medium text-amber-700 dark:text-amber-400")}>
			<Loader2 className="size-3.5 animate-spin" />
			{status === ComplianceExportStatus.Running ? "Running" : "Queued"}
		</span>
	);
}

function FilterCell({ filter }: { filter: unknown }) {
	const summary = useMemo(() => {
		const obj =
			typeof filter === "string"
				? safeParse(filter)
				: (filter as Record<string, unknown>);
		if (!obj || typeof obj !== "object") return [];
		const parts: string[] = [];
		for (const [key, value] of Object.entries(obj)) {
			if (value === null || value === undefined) continue;
			parts.push(`${key}=${value}`);
		}
		return parts;
	}, [filter]);

	if (summary.length === 0) {
		return (
			<span className="text-xs text-muted-foreground">No filter</span>
		);
	}
	return (
		<div className="font-mono text-xs space-y-0.5">
			{summary.map((p) => (
				<div key={p} className="truncate" title={p}>
					{p}
				</div>
			))}
		</div>
	);
}

function safeParse(s: string): unknown {
	try {
		return JSON.parse(s);
	} catch {
		return null;
	}
}

interface ExportJob {
	status: ComplianceExportStatus;
	presignedUrl?: string | null;
	presignedUrlExpiresAt?: string | null;
	jobId: string;
}

function ActionCell({ job }: { job: ExportJob }) {
	if (job.status === ComplianceExportStatus.Complete) {
		const expiresAt = job.presignedUrlExpiresAt
			? Date.parse(job.presignedUrlExpiresAt)
			: NaN;
		const expired = !job.presignedUrl || (Number.isFinite(expiresAt) && expiresAt < Date.now());
		if (expired) {
			return (
				<span className="text-xs text-muted-foreground">
					Download link expired — re-export.
				</span>
			);
		}
		return (
			<a
				href={job.presignedUrl ?? "#"}
				download
				className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline"
			>
				<Download className="size-3.5" />
				Download
			</a>
		);
	}
	if (job.status === ComplianceExportStatus.Failed) {
		return (
			<span className="text-xs text-muted-foreground">
				Re-queue with the same filter from the events list.
			</span>
		);
	}
	return (
		<span className="text-xs text-muted-foreground">Working…</span>
	);
}
