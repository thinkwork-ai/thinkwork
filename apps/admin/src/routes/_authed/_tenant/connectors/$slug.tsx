import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { type ColumnDef } from "@tanstack/react-table";
import {
	ArrowLeft,
	Copy,
	Check,
	Send,
	KeyRound,
	Trash2,
	AlertTriangle,
} from "lucide-react";
import { useState, useEffect, useCallback, useMemo } from "react";
import { useTenant } from "@/context/TenantContext";
import { useBreadcrumbs } from "@/context/BreadcrumbContext";
import { PageHeader } from "@/components/PageHeader";
import { PageLayout } from "@/components/PageLayout";
import { PageSkeleton } from "@/components/PageSkeleton";
import { DataTable } from "@/components/ui/data-table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { relativeTime } from "@/lib/utils";

const API_URL = import.meta.env.VITE_API_URL || "";
const API_AUTH_SECRET = import.meta.env.VITE_API_AUTH_SECRET || "";

export const Route = createFileRoute("/_authed/_tenant/connectors/$slug")({
	component: ConnectorDetailPage,
});

// ---------------------------------------------------------------------------
// Types + REST helper
// ---------------------------------------------------------------------------

type ConnectorRow = {
	slug: string;
	display_name: string;
	configured: boolean;
	enabled: boolean;
	webhook_id: string | null;
	webhook_url: string | null;
	has_secret: boolean;
	connection_count: number;
	last_delivery_at: string | null;
	delivery_count_24h: number;
	recent_failures: number;
};

type Delivery = {
	id: string;
	received_at: string;
	resolution_status: string;
	signature_status: string;
	normalized_kind: string | null;
	external_task_id: string | null;
	provider_user_id: string | null;
	thread_id: string | null;
	thread_created: boolean | null;
	status_code: number | null;
	error_message: string | null;
	duration_ms: number | null;
	body_preview: string | null;
	body_size_bytes: number | null;
	is_replay: boolean;
};

async function apiFetch<T>(
	path: string,
	tenantId: string,
	options: RequestInit = {},
): Promise<T> {
	const res = await fetch(`${API_URL}${path}`, {
		...options,
		headers: {
			"Content-Type": "application/json",
			...(API_AUTH_SECRET ? { Authorization: `Bearer ${API_AUTH_SECRET}` } : {}),
			"x-tenant-id": tenantId,
			...options.headers,
		},
	});
	if (!res.ok) {
		const body = await res.text();
		throw new Error(`${res.status}: ${body}`);
	}
	return res.json() as Promise<T>;
}

// ---------------------------------------------------------------------------
// Copy button
// ---------------------------------------------------------------------------

function CopyButton({ value }: { value: string }) {
	const [copied, setCopied] = useState(false);
	return (
		<Button
			variant="outline"
			size="sm"
			onClick={async () => {
				try {
					await navigator.clipboard.writeText(value);
					setCopied(true);
					setTimeout(() => setCopied(false), 2000);
				} catch {
					toast.error("Couldn't copy");
				}
			}}
			className="gap-1"
		>
			{copied ? (
				<Check className="h-3.5 w-3.5 text-green-500" />
			) : (
				<Copy className="h-3.5 w-3.5" />
			)}
			{copied ? "Copied" : "Copy"}
		</Button>
	);
}

// ---------------------------------------------------------------------------
// Delivery columns
// ---------------------------------------------------------------------------

function statusBadge(status: string) {
	if (status === "ok") {
		return (
			<Badge
				variant="secondary"
				className="text-xs bg-green-500/15 text-green-600 dark:text-green-400"
			>
				ok
			</Badge>
		);
	}
	if (status === "rate_limited") {
		return (
			<Badge
				variant="secondary"
				className="text-xs bg-amber-500/15 text-amber-600 dark:text-amber-400"
			>
				rate limited
			</Badge>
		);
	}
	if (status === "unverified") {
		return (
			<Badge variant="secondary" className="text-xs bg-red-500/15 text-red-600">
				unverified
			</Badge>
		);
	}
	if (status === "unresolved_connection") {
		return (
			<Badge
				variant="secondary"
				className="text-xs bg-muted text-muted-foreground"
			>
				no user match
			</Badge>
		);
	}
	if (status === "unresolved_token" || status === "invalid_body") {
		return (
			<Badge
				variant="secondary"
				className="text-xs bg-red-500/15 text-red-600"
			>
				{status.replace("_", " ")}
			</Badge>
		);
	}
	return (
		<Badge variant="secondary" className="text-xs">
			{status}
		</Badge>
	);
}

function deliveryColumns(): ColumnDef<Delivery>[] {
	return [
		{
			accessorKey: "received_at",
			header: "Received",
			cell: ({ row }) => (
				<span className="text-xs text-muted-foreground tabular-nums">
					{relativeTime(row.original.received_at)}
				</span>
			),
			size: 130,
		},
		{
			accessorKey: "resolution_status",
			header: "Status",
			cell: ({ row }) => statusBadge(row.original.resolution_status),
			size: 120,
		},
		{
			accessorKey: "normalized_kind",
			header: "Event",
			cell: ({ row }) => (
				<span className="text-xs font-mono">
					{row.original.normalized_kind ?? "—"}
				</span>
			),
			size: 160,
		},
		{
			accessorKey: "external_task_id",
			header: "Task",
			cell: ({ row }) => (
				<span className="text-xs font-mono text-muted-foreground truncate max-w-[180px] block">
					{row.original.external_task_id ?? "—"}
				</span>
			),
			size: 200,
		},
		{
			accessorKey: "thread_id",
			header: "Thread",
			cell: ({ row }) => {
				if (!row.original.thread_id)
					return <span className="text-xs text-muted-foreground">—</span>;
				return (
					<span className="text-xs font-mono text-muted-foreground">
						{row.original.thread_created ? "created" : "updated"}
					</span>
				);
			},
			size: 90,
		},
		{
			accessorKey: "duration_ms",
			header: "Duration",
			cell: ({ row }) => (
				<span className="text-xs tabular-nums text-muted-foreground">
					{row.original.duration_ms ? `${row.original.duration_ms}ms` : "—"}
				</span>
			),
			size: 80,
		},
		{
			accessorKey: "error_message",
			header: "Error",
			cell: ({ row }) => (
				<span className="text-xs text-destructive truncate max-w-[240px] block">
					{row.original.error_message ?? ""}
				</span>
			),
			size: 260,
		},
	];
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

function ConnectorDetailPage() {
	const { tenantId } = useTenant();
	const { slug } = Route.useParams();
	const navigate = useNavigate();
	useBreadcrumbs([{ label: "Connectors" }, { label: slug }]);

	const [connector, setConnector] = useState<ConnectorRow | null>(null);
	const [deliveries, setDeliveries] = useState<Delivery[]>([]);
	const [loading, setLoading] = useState(true);
	const [err, setErr] = useState<string | null>(null);

	const fetchData = useCallback(async () => {
		if (!tenantId) return;
		try {
			const [all, hist] = await Promise.all([
				apiFetch<ConnectorRow[]>("/api/task-connectors", tenantId),
				apiFetch<Delivery[]>(
					`/api/task-connectors/${slug}/deliveries`,
					tenantId,
				),
			]);
			const found = all.find((c) => c.slug === slug) ?? null;
			setConnector(found);
			setDeliveries(hist);
			setErr(null);
		} catch (e) {
			setErr(e instanceof Error ? e.message : String(e));
		} finally {
			setLoading(false);
		}
	}, [tenantId, slug]);

	useEffect(() => {
		fetchData();
	}, [fetchData]);

	const handleTest = async () => {
		if (!tenantId || !connector) return;
		try {
			const res = await apiFetch<{ ok: boolean; status: number }>(
				`/api/task-connectors/${slug}/test`,
				tenantId,
				{ method: "POST" },
			);
			if (res.ok) toast.success("Test event delivered");
			else toast.error(`Test failed (${res.status})`);
			fetchData();
		} catch (e) {
			toast.error(e instanceof Error ? e.message : String(e));
		}
	};

	const handleGenerateSecret = async () => {
		if (!tenantId) return;
		try {
			const res = await apiFetch<{ secret: string }>(
				`/api/task-connectors/${slug}/generate-secret`,
				tenantId,
				{ method: "POST" },
			);
			try {
				await navigator.clipboard.writeText(res.secret);
				toast.success(
					"Signing secret generated + copied to clipboard. Paste it into your provider dashboard now — it won't be shown again.",
					{ duration: 10000 },
				);
			} catch {
				toast.info(`Signing secret: ${res.secret}`, { duration: 30000 });
			}
			fetchData();
		} catch (e) {
			toast.error(e instanceof Error ? e.message : String(e));
		}
	};

	const handleRemoveSecret = async () => {
		if (!tenantId) return;
		if (
			!window.confirm(
				"Remove the signing secret? The webhook will rely on token-only auth.",
			)
		) {
			return;
		}
		try {
			await apiFetch(`/api/task-connectors/${slug}/secret`, tenantId, {
				method: "DELETE",
			});
			toast.success("Signing secret removed");
			fetchData();
		} catch (e) {
			toast.error(e instanceof Error ? e.message : String(e));
		}
	};

	const handleDisable = async () => {
		if (!tenantId || !connector) return;
		if (
			!window.confirm(
				`Disable ${connector.display_name}? Existing threads stay, new events will be dropped.`,
			)
		) {
			return;
		}
		try {
			await apiFetch(`/api/task-connectors/${slug}`, tenantId, {
				method: "DELETE",
			});
			toast.success("Connector disabled");
			navigate({ to: "/connectors" });
		} catch (e) {
			toast.error(e instanceof Error ? e.message : String(e));
		}
	};

	const columns = useMemo(() => deliveryColumns(), []);

	if (!tenantId || loading) return <PageSkeleton />;

	if (!connector || !connector.configured) {
		return (
			<PageLayout
				header={<PageHeader title={slug} description="Connector not added" />}
			>
				<p className="text-sm text-muted-foreground mb-4">
					{err ?? "This connector has not been added for your tenant. Go back and click Add Connector."}
				</p>
				<Button variant="outline" onClick={() => navigate({ to: "/connectors" })}>
					<ArrowLeft className="h-4 w-4 mr-1" /> Back to Connectors
				</Button>
			</PageLayout>
		);
	}

	const handleReEnable = async () => {
		if (!tenantId) return;
		try {
			await apiFetch(`/api/task-connectors/${slug}`, tenantId, { method: "POST" });
			toast.success("Re-enabled");
			fetchData();
		} catch (e) {
			toast.error(e instanceof Error ? e.message : String(e));
		}
	};

	return (
		<PageLayout
			header={
				<PageHeader
					title={connector.display_name}
					description={
						connector.enabled
							? `${connector.connection_count} user${
									connector.connection_count === 1 ? "" : "s"
								} connected · ${connector.delivery_count_24h} event${
									connector.delivery_count_24h === 1 ? "" : "s"
								} in the last 24h`
							: "Disabled — new events are dropped. Row + history preserved."
					}
					actions={
						<div className="flex items-center gap-2">
							<Button
								variant="outline"
								size="sm"
								onClick={() => navigate({ to: "/connectors" })}
							>
								<ArrowLeft className="h-4 w-4 mr-1" /> Back
							</Button>
							{connector.enabled ? (
								<>
									<Button size="sm" variant="outline" onClick={handleTest}>
										<Send className="h-3.5 w-3.5 mr-1.5" /> Send test event
									</Button>
									<Button
										size="sm"
										variant="outline"
										onClick={handleGenerateSecret}
									>
										<KeyRound className="h-3.5 w-3.5 mr-1.5" />
										{connector.has_secret ? "Rotate secret" : "Generate secret"}
									</Button>
									{connector.has_secret && (
										<Button
											size="sm"
											variant="outline"
											onClick={handleRemoveSecret}
										>
											<Trash2 className="h-3.5 w-3.5 mr-1.5" /> Remove secret
										</Button>
									)}
									<Button size="sm" variant="outline" onClick={handleDisable}>
										Disable
									</Button>
								</>
							) : (
								<Button size="sm" variant="outline" onClick={handleReEnable}>
									Re-enable
								</Button>
							)}
						</div>
					}
				/>
			}
		>
			{err && <p className="text-sm text-destructive mb-2">{err}</p>}

			{connector.webhook_url && (
				<div className="rounded-lg border bg-muted/20 p-3 mb-4">
					<div className="flex items-center justify-between gap-3">
						<div className="min-w-0">
							<div className="text-xs font-medium text-muted-foreground mb-1">
								Webhook URL (paste into provider dashboard)
							</div>
							<code className="text-xs font-mono truncate block">
								{connector.webhook_url}
							</code>
						</div>
						<CopyButton value={connector.webhook_url} />
					</div>
					<div className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
						{connector.has_secret ? (
							<>
								<KeyRound className="h-3.5 w-3.5" />
								Signing secret is configured — HMAC signatures will be verified.
							</>
						) : (
							<>
								<AlertTriangle className="h-3.5 w-3.5 text-amber-500" />
								Token-only auth. No signing secret configured — optional.
							</>
						)}
					</div>
				</div>
			)}

			<div>
				<h2 className="text-sm font-medium mb-2">Recent deliveries</h2>
				{deliveries.length === 0 ? (
					<p className="text-sm text-muted-foreground py-4">
						No deliveries yet. Fire a test event to verify the pipeline.
					</p>
				) : (
					<DataTable columns={columns} data={deliveries} />
				)}
			</div>
		</PageLayout>
	);
}
