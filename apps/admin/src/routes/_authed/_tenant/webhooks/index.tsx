import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { type ColumnDef } from "@tanstack/react-table";
import { Search, Play, Pause, Bot, Repeat, Webhook, Plus, Copy, Check } from "lucide-react";
import { useState, useMemo, useEffect, useCallback } from "react";
import { useTenant } from "@/context/TenantContext";
import { useBreadcrumbs } from "@/context/BreadcrumbContext";
import { PageHeader } from "@/components/PageHeader";
import { PageLayout } from "@/components/PageLayout";
import { PageSkeleton } from "@/components/PageSkeleton";
import { EmptyState } from "@/components/EmptyState";
import { DataTable } from "@/components/ui/data-table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { WebhookFormDialog } from "@/components/webhooks/WebhookFormDialog";
import { relativeTime } from "@/lib/utils";
import { apiFetch as authedApiFetch } from "@/lib/api-fetch";

export const Route = createFileRoute("/_authed/_tenant/webhooks/")({
  component: WebhooksPage,
});

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type WebhookRow = {
  id: string;
  name: string;
  description: string | null;
  token: string;
  target_type: string;
  target_name: string | null;
  agent_id: string | null;
  routine_id: string | null;
  enabled: boolean;
  rate_limit: number | null;
  last_invoked_at: string | null;
  invocation_count: number;
  created_at: string;
};

// ---------------------------------------------------------------------------
// REST helpers
// ---------------------------------------------------------------------------

async function apiFetch<T>(path: string, tenantId: string, options: RequestInit = {}): Promise<T> {
  const { headers, ...rest } = options;
  return authedApiFetch<T>(path, {
    ...rest,
    extraHeaders: { "x-tenant-id": tenantId, ...(headers as Record<string, string> | undefined) },
  });
}

// ---------------------------------------------------------------------------
// Columns
// ---------------------------------------------------------------------------

function webhookColumns(): ColumnDef<WebhookRow>[] {
  return [
    {
      accessorKey: "name",
      header: "Name",
      cell: ({ row }) => (
        <span className="font-medium">{row.original.name}</span>
      ),
    },
    {
      accessorKey: "target_type",
      header: "Type",
      cell: ({ row }) => (
        <Badge variant="secondary" className={`text-xs gap-1 ${
          row.original.target_type === "agent"
            ? "bg-blue-500/15 text-blue-600 dark:text-blue-400"
            : "bg-green-500/15 text-green-600 dark:text-green-400"
        }`}>
          {row.original.target_type === "agent" ? <Bot className="h-3.5 w-3.5" /> : <Repeat className="h-3.5 w-3.5" />}
          {row.original.target_type === "agent" ? "Agent" : "Routine"}
        </Badge>
      ),
      size: 120,
    },
    {
      accessorKey: "target_name",
      header: "Target",
      cell: ({ row }) => (
        <span className="text-sm">
          {row.original.target_name || <span className="text-muted-foreground">—</span>}
        </span>
      ),
    },
    {
      accessorKey: "enabled",
      header: "Status",
      cell: ({ row }) => (
        row.original.enabled ? (
          <Badge variant="secondary" className="text-xs gap-1 bg-green-500/15 text-green-600 dark:text-green-400">
            <Play className="h-3 w-3 fill-current" /> Enabled
          </Badge>
        ) : (
          <Badge variant="secondary" className="text-xs gap-1 bg-muted text-muted-foreground">
            <Pause className="h-3 w-3" /> Disabled
          </Badge>
        )
      ),
      size: 110,
    },
    {
      accessorKey: "last_invoked_at",
      header: "Last Invoked",
      cell: ({ row }) => (
        <span className="text-xs text-muted-foreground">
          {row.original.last_invoked_at ? relativeTime(row.original.last_invoked_at) : "Never"}
        </span>
      ),
      size: 120,
    },
    {
      accessorKey: "invocation_count",
      header: "Invocations",
      cell: ({ row }) => (
        <span className="text-xs text-muted-foreground">{row.original.invocation_count}</span>
      ),
      size: 100,
    },
  ];
}

// ---------------------------------------------------------------------------
// Create Button
// ---------------------------------------------------------------------------

function CreateWebhookButton({ tenantId, onCreated }: { tenantId: string; onCreated: () => void }) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>
        <Plus className="h-4 w-4 mr-1" /> New Webhook
      </Button>
      <WebhookFormDialog
        open={open}
        onOpenChange={setOpen}
        mode="create"
        tenantId={tenantId}
        onSubmit={async (data) => {
          await apiFetch("/api/webhooks", tenantId, {
            method: "POST",
            body: JSON.stringify(data),
          });
          onCreated();
        }}
      />
    </>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

function WebhooksPage() {
  const { tenantId } = useTenant();
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const [webhooks, setWebhooks] = useState<WebhookRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  useBreadcrumbs([{ label: "Webhooks" }]);

  const fetchData = useCallback(async () => {
    if (!tenantId) return;
    try {
      const data = await apiFetch<WebhookRow[]>("/api/webhooks", tenantId);
      setWebhooks(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [tenantId]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const enabledWebhooks = useMemo(() => webhooks.filter((w) => w.enabled), [webhooks]);
  const disabledWebhooks = useMemo(() => webhooks.filter((w) => !w.enabled), [webhooks]);

  const filteredWebhooks = useMemo(() => {
    if (!search) return webhooks;
    const q = search.toLowerCase();
    return webhooks.filter(
      (w) =>
        w.name.toLowerCase().includes(q) ||
        w.target_type.toLowerCase().includes(q) ||
        (w.description?.toLowerCase().includes(q) ?? false),
    );
  }, [webhooks, search]);

  if (!tenantId || loading) return <PageSkeleton />;

  return (
    <PageLayout
      header={
        <>
          <PageHeader
            title="Webhooks"
            description={`${enabledWebhooks.length} active, ${disabledWebhooks.length} disabled`}
            actions={<CreateWebhookButton tenantId={tenantId} onCreated={fetchData} />}
          />

          {webhooks.length > 0 && (
            <div className="flex items-center gap-2 mt-4">
              <div className="relative flex-1 max-w-sm">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search webhooks..." className="pl-9" />
              </div>
              <Button variant="outline" size="sm" onClick={fetchData}>Refresh</Button>
            </div>
          )}
        </>
      }
    >
      {error && <p className="text-sm text-destructive">{error}</p>}

      {webhooks.length === 0 ? (
        <EmptyState
          icon={Webhook}
          title="No webhooks"
          description="Create a webhook to let external services trigger agent or routine work via HTTP."
        />
      ) : filteredWebhooks.length === 0 ? (
        <p className="text-sm text-muted-foreground py-4">No matching webhooks.</p>
      ) : (
        <DataTable
          columns={webhookColumns()}
          data={filteredWebhooks}
          filterValue={search}
          filterColumn="name"
          onRowClick={(row) => navigate({ to: "/webhooks/$webhookId", params: { webhookId: row.id } })}
        />
      )}
    </PageLayout>
  );
}
