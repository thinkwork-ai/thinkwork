import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { type ColumnDef } from "@tanstack/react-table";
import {
	Plug,
	Plus,
	Copy,
	Check,
	AlertTriangle,
	ListChecks,
	KeyRound,
	Send,
	Power,
	PowerOff,
	Trash2,
} from "lucide-react";
import { useState, useMemo, useEffect, useCallback } from "react";
import { useTenant } from "@/context/TenantContext";
import { useBreadcrumbs } from "@/context/BreadcrumbContext";
import { PageHeader } from "@/components/PageHeader";
import { PageLayout } from "@/components/PageLayout";
import { PageSkeleton } from "@/components/PageSkeleton";
import { EmptyState } from "@/components/EmptyState";
import { DataTable } from "@/components/ui/data-table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
	Dialog,
	DialogContent,
	DialogHeader,
	DialogTitle,
	DialogDescription,
	DialogFooter,
} from "@/components/ui/dialog";
import {
	DropdownMenu,
	DropdownMenuTrigger,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { toast } from "sonner";
import { relativeTime } from "@/lib/utils";

const API_URL = import.meta.env.VITE_API_URL || "";
const API_AUTH_SECRET = import.meta.env.VITE_API_AUTH_SECRET || "";

export const Route = createFileRoute("/_authed/_tenant/connectors/")({
	component: ConnectorsPage,
});

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ConnectorRow = {
	slug: string;
	display_name: string;
	provider_id: string;
	provider_type: string;
	is_available: boolean;
	/** Whether a webhook row has been created (enabled or disabled). */
	configured: boolean;
	/** Whether the webhook row is currently accepting events. */
	enabled: boolean;
	webhook_id: string | null;
	webhook_url: string | null;
	has_secret: boolean;
	secret_status: "configured" | "missing";
	connection_count: number;
	last_delivery_at: string | null;
	delivery_count_24h: number;
	recent_failures: number;
};

// ---------------------------------------------------------------------------
// REST helper
// ---------------------------------------------------------------------------

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
// Copy-to-clipboard helper
// ---------------------------------------------------------------------------

function CopyButton({ value, label }: { value: string; label?: string }) {
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
					toast.error("Couldn't copy to clipboard");
				}
			}}
			className="gap-1"
		>
			{copied ? (
				<Check className="h-3.5 w-3.5 text-green-500" />
			) : (
				<Copy className="h-3.5 w-3.5" />
			)}
			{label ?? (copied ? "Copied" : "Copy")}
		</Button>
	);
}

// ---------------------------------------------------------------------------
// Columns
// ---------------------------------------------------------------------------

function connectorColumns(): ColumnDef<ConnectorRow>[] {
	return [
		{
			accessorKey: "display_name",
			header: "Connector",
			cell: ({ row }) => (
				<div className="flex items-center gap-2">
					<ListChecks className="h-4 w-4 text-muted-foreground" />
					<span className="font-medium">{row.original.display_name}</span>
					<span className="text-xs text-muted-foreground font-mono">
						{row.original.slug}
					</span>
				</div>
			),
			size: 240,
		},
		{
			accessorKey: "enabled",
			header: "Status",
			cell: ({ row }) => {
				const r = row.original;
				if (r.enabled) {
					return (
						<Badge
							variant="secondary"
							className="text-xs gap-1 bg-green-500/15 text-green-600 dark:text-green-400"
						>
							Enabled
						</Badge>
					);
				}
				if (r.configured) {
					return (
						<Badge
							variant="secondary"
							className="text-xs gap-1 bg-amber-500/15 text-amber-600 dark:text-amber-400"
						>
							Disabled
						</Badge>
					);
				}
				return (
					<Badge variant="secondary" className="text-xs bg-muted text-muted-foreground">
						Available
					</Badge>
				);
			},
			size: 110,
		},
		{
			accessorKey: "secret_status",
			header: "Signing",
			cell: ({ row }) =>
				row.original.has_secret ? (
					<Badge
						variant="secondary"
						className="text-xs gap-1 bg-blue-500/15 text-blue-600 dark:text-blue-400"
					>
						<KeyRound className="h-3 w-3" />
						Signed
					</Badge>
				) : (
					<Badge variant="secondary" className="text-xs bg-muted text-muted-foreground">
						Token only
					</Badge>
				),
			size: 110,
		},
		{
			accessorKey: "connection_count",
			header: "Users",
			cell: ({ row }) => (
				<span className="text-sm tabular-nums">
					{row.original.connection_count}
				</span>
			),
			size: 70,
		},
		{
			accessorKey: "delivery_count_24h",
			header: "Recent activity (24h)",
			cell: ({ row }) => {
				const d = row.original.delivery_count_24h;
				const f = row.original.recent_failures;
				return (
					<div className="flex items-center gap-2 text-xs">
						<span className="tabular-nums">
							{d} event{d === 1 ? "" : "s"}
						</span>
						{f > 0 && (
							<span className="flex items-center gap-1 text-destructive">
								<AlertTriangle className="h-3 w-3" />
								{f} failure{f === 1 ? "" : "s"}
							</span>
						)}
						{row.original.last_delivery_at && (
							<span className="text-muted-foreground">
								· {relativeTime(row.original.last_delivery_at)}
							</span>
						)}
					</div>
				);
			},
			size: 230,
		},
	];
}

// ---------------------------------------------------------------------------
// Add Connector Dialog
// ---------------------------------------------------------------------------

type AddResult = {
	ok: boolean;
	slug: string;
	webhook_url: string;
	already_enabled: boolean;
};

function AddConnectorDialog({
	open,
	onOpenChange,
	tenantId,
	availableConnectors,
	onCreated,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	tenantId: string;
	availableConnectors: ConnectorRow[];
	onCreated: (result: AddResult) => void;
}) {
	const [submitting, setSubmitting] = useState<string | null>(null);

	const handleAdd = async (slug: string) => {
		setSubmitting(slug);
		try {
			const res = await apiFetch<AddResult>(`/api/task-connectors/${slug}`, tenantId, {
				method: "POST",
			});
			onCreated(res);
			onOpenChange(false);
		} catch (err) {
			toast.error(err instanceof Error ? err.message : String(err));
		} finally {
			setSubmitting(null);
		}
	};

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="sm:max-w-md">
				<DialogHeader>
					<DialogTitle>Add Task Connector</DialogTitle>
					<DialogDescription>
						Pick a task provider to wire up. Enabling a connector creates a
						unique webhook URL that you'll paste into the provider's dashboard.
					</DialogDescription>
				</DialogHeader>

				<div className="flex flex-col gap-2 py-2">
					{availableConnectors.length === 0 ? (
						<p className="text-sm text-muted-foreground">
							All available task connectors are already enabled.
						</p>
					) : (
						availableConnectors.map((c) => (
							<button
								key={c.slug}
								type="button"
								disabled={!!submitting}
								onClick={() => handleAdd(c.slug)}
								className="flex items-center justify-between gap-3 rounded-lg border p-3 text-left hover:bg-accent disabled:opacity-60"
							>
								<div className="flex items-center gap-3">
									<ListChecks className="h-5 w-5 text-muted-foreground" />
									<div>
										<div className="font-medium text-sm">{c.display_name}</div>
										<div className="text-xs text-muted-foreground font-mono">
											{c.slug}
										</div>
									</div>
								</div>
								<Badge variant="secondary" className="text-xs">
									{submitting === c.slug ? "Adding…" : "Add"}
								</Badge>
							</button>
						))
					)}
				</div>

				<DialogFooter>
					<Button variant="outline" onClick={() => onOpenChange(false)}>
						Close
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

// ---------------------------------------------------------------------------
// Setup Instructions Dialog — shown after a successful enable.
// ---------------------------------------------------------------------------

function SetupInstructionsDialog({
	open,
	onOpenChange,
	tenantId,
	result,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	tenantId: string;
	result: AddResult | null;
}) {
	const [secret, setSecret] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);

	useEffect(() => {
		if (!open) setSecret(null);
	}, [open]);

	if (!result) return null;

	const handleGenerate = async () => {
		setBusy(true);
		try {
			const res = await apiFetch<{ ok: boolean; secret: string }>(
				`/api/task-connectors/${result.slug}/generate-secret`,
				tenantId,
				{ method: "POST" },
			);
			setSecret(res.secret);
		} catch (err) {
			toast.error(err instanceof Error ? err.message : String(err));
		} finally {
			setBusy(false);
		}
	};

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="sm:max-w-lg">
				<DialogHeader>
					<DialogTitle>
						✓ {result.already_enabled ? "Connector already enabled" : "Connector enabled"}
					</DialogTitle>
					<DialogDescription>
						Paste this webhook URL into your task provider's dashboard so it can
						deliver events to ThinkWork.
					</DialogDescription>
				</DialogHeader>

				<div className="space-y-4 py-2">
					<div>
						<div className="text-xs font-medium text-muted-foreground mb-1.5">
							Webhook URL
						</div>
						<div className="flex items-center gap-2 rounded-lg border bg-muted/30 p-2.5">
							<code className="text-xs font-mono flex-1 truncate">
								{result.webhook_url}
							</code>
							<CopyButton value={result.webhook_url} label="Copy" />
						</div>
					</div>

					{secret ? (
						<div>
							<div className="text-xs font-medium text-muted-foreground mb-1.5">
								Signing secret
							</div>
							<div className="flex items-center gap-2 rounded-lg border bg-muted/30 p-2.5">
								<code className="text-xs font-mono flex-1 truncate">{secret}</code>
								<CopyButton value={secret} label="Copy" />
							</div>
							<p className="flex items-start gap-1.5 mt-2 text-xs text-amber-600 dark:text-amber-400">
								<AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
								This value will not be shown again. Copy it now and paste it
								into your provider's signing secret field.
							</p>
						</div>
					) : (
						<div className="rounded-lg border border-dashed p-3 text-xs text-muted-foreground">
							<p className="mb-2">
								<strong>Optional:</strong> If your provider dashboard supports
								HMAC signature verification, generate a signing secret below.
								The webhook works without it — the 32-byte random token in the
								URL is already cryptographically strong and tenant-scoped.
							</p>
							<Button
								size="sm"
								variant="outline"
								onClick={handleGenerate}
								disabled={busy}
							>
								<KeyRound className="h-3.5 w-3.5 mr-1.5" />
								{busy ? "Generating…" : "Generate signing secret"}
							</Button>
						</div>
					)}
				</div>

				<DialogFooter>
					<Button onClick={() => onOpenChange(false)}>Done</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

function ConnectorsPage() {
	const { tenantId } = useTenant();
	const navigate = useNavigate();
	useBreadcrumbs([{ label: "Connectors" }]);

	const [connectors, setConnectors] = useState<ConnectorRow[]>([]);
	const [loading, setLoading] = useState(true);
	const [err, setErr] = useState<string | null>(null);

	const [addOpen, setAddOpen] = useState(false);
	const [setupResult, setSetupResult] = useState<AddResult | null>(null);

	const fetchData = useCallback(async () => {
		if (!tenantId) return;
		try {
			const data = await apiFetch<ConnectorRow[]>("/api/task-connectors", tenantId);
			setConnectors(data);
			setErr(null);
		} catch (e) {
			setErr(e instanceof Error ? e.message : String(e));
		} finally {
			setLoading(false);
		}
	}, [tenantId]);

	useEffect(() => {
		fetchData();
	}, [fetchData]);

	const enabledConnectors = useMemo(
		() => connectors.filter((c) => c.enabled),
		[connectors],
	);
	// Connectors in the catalog that this tenant has NOT yet added. Disabled
	// rows are re-enabled via the row's own Re-enable action, not the Add
	// flow, so they are excluded here.
	const unconfiguredConnectors = useMemo(
		() => connectors.filter((c) => !c.configured && c.is_available),
		[connectors],
	);
	const disabledConnectors = useMemo(
		() => connectors.filter((c) => c.configured && !c.enabled),
		[connectors],
	);

	if (!tenantId || loading) return <PageSkeleton />;

	const description = (() => {
		const parts: string[] = [`${enabledConnectors.length} enabled`];
		if (disabledConnectors.length > 0)
			parts.push(`${disabledConnectors.length} disabled`);
		if (unconfiguredConnectors.length > 0)
			parts.push(`${unconfiguredConnectors.length} available`);
		return parts.join(", ");
	})();

	return (
		<PageLayout
			header={
				<PageHeader
					title="Connectors"
					description={description}
					actions={
						<Button
							size="sm"
							onClick={() => setAddOpen(true)}
							disabled={unconfiguredConnectors.length === 0}
						>
							<Plus className="h-4 w-4 mr-1" /> Add Connector
						</Button>
					}
				/>
			}
		>
			{err && <p className="text-sm text-destructive mb-2">{err}</p>}

			{connectors.length === 0 ? (
				<EmptyState
					icon={Plug}
					title="No task connectors available"
					description="Task connectors come from the connect_providers catalog. Add a provider via seed SQL to see it here."
				/>
			) : (
				<DataTable
					columns={connectorColumns()}
					data={connectors}
					onRowClick={(row) =>
						row.configured
							? navigate({
									to: "/connectors/$slug",
									params: { slug: row.slug },
								})
							: setAddOpen(true)
					}
				/>
			)}

			<AddConnectorDialog
				open={addOpen}
				onOpenChange={setAddOpen}
				tenantId={tenantId}
				availableConnectors={unconfiguredConnectors}
				onCreated={(res) => {
					setSetupResult(res);
					fetchData();
				}}
			/>

			<SetupInstructionsDialog
				open={!!setupResult}
				onOpenChange={(open) => {
					if (!open) setSetupResult(null);
				}}
				tenantId={tenantId}
				result={setupResult}
			/>
		</PageLayout>
	);
}
