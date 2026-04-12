import { useState, useEffect, useCallback } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { type ColumnDef } from "@tanstack/react-table";
import {
  Plus,
  Loader2,
  CheckCircle2,
  AlertCircle,
  Trash2,
  TestTube,
  Cable,
} from "lucide-react";
import { useTenant } from "@/context/TenantContext";
import { useBreadcrumbs } from "@/context/BreadcrumbContext";
import { PageLayout } from "@/components/PageLayout";
import { PageSkeleton } from "@/components/PageSkeleton";
import { DataTable } from "@/components/ui/data-table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { Switch } from "@/components/ui/switch";
import {
  listMcpServers,
  registerMcpServer,
  deleteMcpServer,
  testMcpServer,
  updateMcpServer,
  type McpServer,
} from "@/lib/mcp-api";

export const Route = createFileRoute("/_authed/_tenant/mcp-servers")({
  component: McpServersPage,
});

// ---------------------------------------------------------------------------
// Columns
// ---------------------------------------------------------------------------

const columns: ColumnDef<McpServer>[] = [
  {
    accessorKey: "name",
    header: "Name",
    size: 180,
    cell: ({ row }) => (
      <div className="pl-3">
        <span className="font-medium">{row.original.name}</span>
      </div>
    ),
  },
  {
    accessorKey: "transport",
    header: "Transport",
    size: 130,
    cell: ({ row }) => (
      <Badge variant="secondary" className="text-xs font-mono">
        {row.original.transport}
      </Badge>
    ),
  },
  {
    accessorKey: "authType",
    header: "Auth",
    size: 130,
    cell: ({ row }) => {
      const t = row.original.authType;
      return (
        <span className="text-sm text-muted-foreground">
          {t === "oauth" ? "OAuth" : t === "tenant_api_key" ? "API Key" : "None"}
        </span>
      );
    },
  },
  {
    accessorKey: "tools",
    header: "Tools",
    size: 80,
    cell: ({ row }) => {
      const tools = row.original.tools;
      return (
        <span className="text-sm text-muted-foreground">
          {tools?.length ?? "---"}
        </span>
      );
    },
  },
  {
    accessorKey: "enabled",
    header: () => <div className="text-center">Status</div>,
    size: 100,
    cell: ({ row }) => (
      <div className="flex justify-center">
        <Badge
          variant="secondary"
          className={`text-xs gap-1 ${row.original.enabled ? "bg-green-500/15 text-green-600 dark:text-green-400" : "bg-muted text-muted-foreground"}`}
        >
          {row.original.enabled ? "Enabled" : "Disabled"}
        </Badge>
      </div>
    ),
  },
];

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

function McpServersPage() {
  const { tenant } = useTenant();
  const tenantSlug = tenant?.slug;
  useBreadcrumbs([{ label: "MCP Servers" }]);

  const [servers, setServers] = useState<McpServer[]>([]);
  const [loading, setLoading] = useState(true);
  const [addOpen, setAddOpen] = useState(false);
  const [detailServer, setDetailServer] = useState<McpServer | null>(null);

  const refresh = useCallback(() => {
    if (!tenantSlug) return;
    setLoading(true);
    listMcpServers(tenantSlug)
      .then((r) => setServers(r.servers || []))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [tenantSlug]);

  useEffect(() => { refresh(); }, [refresh]);

  if (!tenantSlug) return <PageSkeleton />;
  if (loading && servers.length === 0) return <PageSkeleton />;

  return (
    <PageLayout
      header={
        <div className="flex items-center justify-between w-full">
          <div className="flex items-center gap-2">
            <Cable className="h-5 w-5 text-muted-foreground" />
            <h1 className="text-2xl font-bold tracking-tight leading-tight text-foreground">
              MCP Servers
            </h1>
          </div>
          <Button variant="outline" size="sm" onClick={() => setAddOpen(true)}>
            <Plus className="h-3.5 w-3.5 mr-1.5" />
            Register Server
          </Button>
        </div>
      }
    >
      {servers.length === 0 ? (
        <div className="text-center py-12">
          <Cable className="h-10 w-10 mx-auto mb-3 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            No MCP servers registered. Add one to connect external tools to your agents.
          </p>
        </div>
      ) : (
        <DataTable
          columns={columns}
          data={servers}
          pageSize={0}
          tableClassName="table-fixed [&_tbody_tr]:h-10"
          onRowClick={(row) => setDetailServer(row)}
        />
      )}

      {/* Add Server Dialog */}
      <AddServerDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        tenantSlug={tenantSlug || ""}
        onAdded={refresh}
      />

      {/* Server Detail Dialog */}
      {detailServer && (
        <ServerDetailDialog
          server={detailServer}
          tenantSlug={tenantSlug || ""}
          onClose={() => setDetailServer(null)}
          onChanged={refresh}
        />
      )}
    </PageLayout>
  );
}

// ---------------------------------------------------------------------------
// Add Server Dialog
// ---------------------------------------------------------------------------

function AddServerDialog({
  open,
  onOpenChange,
  tenantSlug,
  onAdded,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tenantSlug: string;
  onAdded: () => void;
}) {
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [transport, setTransport] = useState("streamable-http");
  const [authType, setAuthType] = useState("none");
  const [apiKey, setApiKey] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  const reset = () => {
    setName(""); setUrl(""); setTransport("streamable-http");
    setAuthType("none"); setApiKey(""); setErr("");
  };

  const handleSave = async () => {
    if (!name || !url) return;
    setSaving(true); setErr("");
    try {
      await registerMcpServer(tenantSlug, {
        name,
        url,
        transport,
        authType: authType !== "none" ? authType : undefined,
        apiKey: authType === "tenant_api_key" ? apiKey : undefined,
      });
      reset();
      onOpenChange(false);
      onAdded();
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setSaving(false);
    }
  };

  const isValid = name.trim() && url.trim() &&
    (authType === "none" || authType === "oauth" ? true : apiKey.trim());

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) reset(); onOpenChange(o); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Register MCP Server</DialogTitle>
          <DialogDescription>
            Add an external MCP server to your tenant. Once registered, you can assign it to agent templates.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1">
            <Label htmlFor="mcp-name">Name</Label>
            <Input id="mcp-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Lastmile CRM" />
          </div>
          <div className="space-y-1">
            <Label htmlFor="mcp-url">URL</Label>
            <Input id="mcp-url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://mcp.example.com/sse" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>Transport</Label>
              <Select value={transport} onValueChange={setTransport}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="streamable-http">Streamable HTTP</SelectItem>
                  <SelectItem value="sse">SSE</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Authentication</Label>
              <Select value={authType} onValueChange={setAuthType}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">None</SelectItem>
                  <SelectItem value="tenant_api_key">Tenant API Key</SelectItem>
                  <SelectItem value="oauth">OAuth (server-managed)</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          {authType === "tenant_api_key" && (
            <div className="space-y-1">
              <Label htmlFor="mcp-apikey">API Key</Label>
              <Input id="mcp-apikey" type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder="API key or bearer token" />
            </div>
          )}
          {authType === "oauth" && (
            <p className="text-xs text-muted-foreground px-1">Each user will need to connect their own account from the mobile app before the agent can use this server.</p>
          )}
          {err && (
            <div className="flex items-center gap-2 p-3 rounded-md bg-destructive/10 text-destructive text-sm">
              <AlertCircle className="h-4 w-4 shrink-0" />{err}
            </div>
          )}
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="ghost" size="sm" onClick={() => { reset(); onOpenChange(false); }} disabled={saving}>Cancel</Button>
            <Button size="sm" onClick={handleSave} disabled={!isValid || saving}>
              {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : null}
              Register
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Server Detail Dialog (view, test, delete)
// ---------------------------------------------------------------------------

function ServerDetailDialog({
  server,
  tenantSlug,
  onClose,
  onChanged,
}: {
  server: McpServer;
  tenantSlug: string;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; tools?: Array<{ name: string; description?: string }>; error?: string } | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [toggling, setToggling] = useState(false);
  const [enabled, setEnabled] = useState(server.enabled !== false);
  const [showTools, setShowTools] = useState(false);

  const handleTest = async () => {
    setTesting(true); setTestResult(null);
    try {
      const result = await testMcpServer(tenantSlug, server.id);
      setTestResult(result);
      if (result.ok) toast.success(`Connected — ${result.tools?.length || 0} tools`);
    } catch (e: any) {
      setTestResult({ ok: false, error: e.message });
      toast.error("Connection failed");
    } finally {
      setTesting(false);
    }
  };

  const handleToggle = async (val: boolean) => {
    setToggling(true);
    try {
      await updateMcpServer(tenantSlug, server.id, { enabled: val });
      setEnabled(val);
      toast.success(val ? "Server enabled" : "Server disabled");
      onChanged();
    } catch {
      toast.error("Failed to update server");
    } finally {
      setToggling(false);
    }
  };

  const handleDelete = async () => {
    setDeleting(true);
    try {
      await deleteMcpServer(tenantSlug, server.id);
      toast.success("Server deleted");
      onClose();
      onChanged();
    } catch {
      toast.error("Delete failed");
    } finally {
      setDeleting(false);
    }
  };

  const handleAuthenticate = () => {
    const apiUrl = import.meta.env.VITE_API_URL || "";
    const authUrl = `${apiUrl}/api/skills/mcp-oauth/authorize?mcpServerId=${server.id}&tenantSlug=${tenantSlug}&force=true`;
    window.open(authUrl, "_blank", "width=600,height=700");
  };

  const isConnected = testResult?.ok === true || (server.tools && server.tools.length > 0);
  const toolCount = testResult?.tools?.length ?? server.tools?.length ?? 0;
  const authLabel = server.authType === "oauth" ? "OAuth" : server.authType === "tenant_api_key" ? "API Key" : "None";

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Cable className="h-5 w-5" />
            {server.name}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          {/* Status + URL */}
          <div className="space-y-2 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Status</span>
              <div className="flex items-center gap-1.5">
                {isConnected
                  ? <><CheckCircle2 className="h-3.5 w-3.5 text-green-500" /><span className="text-green-500">connected</span></>
                  : <><AlertCircle className="h-3.5 w-3.5 text-muted-foreground" /><span className="text-muted-foreground">unknown</span></>}
              </div>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Auth</span>
              <span>{authLabel}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">URL</span>
              <span className="font-mono text-xs truncate max-w-[280px]">{server.url}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Transport</span>
              <span className="font-mono text-xs">{server.transport}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Tools</span>
              <span>{toolCount} tool{toolCount !== 1 ? "s" : ""}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Enabled</span>
              <Switch checked={enabled} onCheckedChange={handleToggle} disabled={toggling} />
            </div>
          </div>

          {/* Test result */}
          {testResult && (
            <div className={`flex items-start gap-2 p-3 rounded-md text-sm ${testResult.ok ? "bg-green-500/10 text-green-600 dark:text-green-400" : "bg-destructive/10 text-destructive"}`}>
              {testResult.ok ? <CheckCircle2 className="h-4 w-4 mt-0.5 shrink-0" /> : <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />}
              <div>
                {testResult.ok
                  ? `Connected. ${testResult.tools?.length || 0} tools discovered.`
                  : `Failed: ${testResult.error}`}
              </div>
            </div>
          )}

          {/* Tools list (collapsible) */}
          {toolCount > 0 && (
            <div>
              <button
                className="text-sm font-medium flex items-center gap-1 hover:underline"
                onClick={() => setShowTools(!showTools)}
              >
                {showTools ? "Hide" : "View"} tools ({toolCount})
              </button>
              {showTools && (
                <div className="max-h-48 overflow-y-auto space-y-1 mt-2">
                  {(testResult?.tools ?? server.tools ?? []).map((t) => (
                    <div key={t.name} className="text-xs px-2 py-1.5 bg-muted rounded">
                      <span className="font-mono font-medium">{t.name}</span>
                      {t.description && <p className="text-muted-foreground mt-0.5">{t.description}</p>}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Actions */}
          <div className="border-t pt-3 space-y-2">
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" onClick={handleTest} disabled={testing}>
                {testing ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : <TestTube className="h-3.5 w-3.5 mr-1.5" />}
                Test Connection
              </Button>
              {server.authType === "oauth" && (
                <Button variant="outline" size="sm" onClick={handleAuthenticate}>
                  Authenticate
                </Button>
              )}
            </div>
            <div className="flex items-center gap-2">
              {confirmDelete ? (
                <div className="flex items-center gap-2">
                  <span className="text-sm text-muted-foreground">Are you sure?</span>
                  <Button variant="destructive" size="sm" onClick={handleDelete} disabled={deleting}>
                    {deleting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Delete"}
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => setConfirmDelete(false)}>Cancel</Button>
                </div>
              ) : (
                <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive" onClick={() => setConfirmDelete(true)}>
                  <Trash2 className="h-3.5 w-3.5 mr-1.5" />Delete Server
                </Button>
              )}
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
