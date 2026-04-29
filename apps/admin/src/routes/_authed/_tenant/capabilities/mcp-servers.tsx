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
  Search,
  ShieldCheck,
} from "lucide-react";
import { useTenant } from "@/context/TenantContext";
import { useBreadcrumbs } from "@/context/BreadcrumbContext";
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
  approveMcpServer,
  rejectMcpServer,
  listMcpContextTools,
  updateMcpContextTool,
  type McpServer,
  type McpContextTool,
} from "@/lib/mcp-api";

export const Route = createFileRoute(
  "/_authed/_tenant/capabilities/mcp-servers",
)({
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
          {t === "oauth"
            ? "OAuth"
            : t === "tenant_api_key"
              ? "API Key"
              : "None"}
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
    accessorKey: "status",
    header: () => <div className="text-center">Approval</div>,
    size: 110,
    cell: ({ row }) => {
      const status = row.original.status ?? "approved";
      const styles: Record<string, string> = {
        pending: "bg-amber-500/15 text-amber-600 dark:text-amber-400",
        approved: "bg-green-500/15 text-green-600 dark:text-green-400",
        rejected: "bg-muted text-muted-foreground line-through",
      };
      return (
        <div className="flex justify-center">
          <Badge
            variant="secondary"
            className={`text-xs ${styles[status] ?? ""}`}
          >
            {status}
          </Badge>
        </div>
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
  const tenantId = tenant?.id;
  useBreadcrumbs([
    { label: "Capabilities", href: "/capabilities" },
    { label: "MCP Servers" },
  ]);

  const [servers, setServers] = useState<McpServer[]>([]);
  const [loading, setLoading] = useState(true);
  const [addOpen, setAddOpen] = useState(false);
  const [detailServer, setDetailServer] = useState<McpServer | null>(null);
  const [search, setSearch] = useState("");

  const refresh = useCallback(() => {
    if (!tenantSlug) return;
    setLoading(true);
    listMcpServers(tenantSlug)
      .then((r) => setServers(r.servers || []))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [tenantSlug]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  if (!tenantSlug) return <PageSkeleton />;
  if (loading && servers.length === 0) return <PageSkeleton />;

  return (
    <>
      <div className="flex flex-col h-full min-h-0">
        <div className="shrink-0 flex items-center gap-4 mb-4">
          <div className="relative" style={{ width: "16rem" }}>
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search servers..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
            />
          </div>
          <div className="ml-auto">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setAddOpen(true)}
            >
              <Plus className="h-3.5 w-3.5 mr-1.5" />
              Register Server
            </Button>
          </div>
        </div>
        <div className="flex-1 min-h-0">
          {servers.length === 0 ? (
            <div className="text-center py-12">
              <Cable className="h-10 w-10 mx-auto mb-3 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">
                No MCP servers registered. Add one to connect external tools to
                your agents.
              </p>
            </div>
          ) : (
            <DataTable
              columns={columns}
              data={servers}
              filterValue={search}
              scrollable
              tableClassName="table-fixed [&_tbody_tr]:h-10"
              onRowClick={(row) => setDetailServer(row)}
            />
          )}
        </div>
      </div>

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
          tenantId={tenantId || ""}
          onClose={() => setDetailServer(null)}
          onChanged={refresh}
        />
      )}
    </>
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
    setName("");
    setUrl("");
    setTransport("streamable-http");
    setAuthType("none");
    setApiKey("");
    setErr("");
  };

  const handleSave = async () => {
    if (!name || !url) return;
    setSaving(true);
    setErr("");
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

  const isValid =
    name.trim() &&
    url.trim() &&
    (authType === "none" || authType === "oauth" ? true : apiKey.trim());

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) reset();
        onOpenChange(o);
      }}
    >
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Register MCP Server</DialogTitle>
          <DialogDescription>
            Add an external MCP server to your tenant. Once registered, you can
            assign it to agent templates.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1">
            <Label htmlFor="mcp-name">Name</Label>
            <Input
              id="mcp-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. CRM Tools"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="mcp-url">URL</Label>
            <Input
              id="mcp-url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://mcp.example.com/sse"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>Transport</Label>
              <Select value={transport} onValueChange={setTransport}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="streamable-http">
                    Streamable HTTP
                  </SelectItem>
                  <SelectItem value="sse">SSE</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Authentication</Label>
              <Select value={authType} onValueChange={setAuthType}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
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
              <Input
                id="mcp-apikey"
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="API key or bearer token"
              />
            </div>
          )}
          {authType === "oauth" && (
            <p className="text-xs text-muted-foreground px-1">
              Each user will need to connect their own account from the mobile
              app before the agent can use this server.
            </p>
          )}
          {err && (
            <div className="flex items-center gap-2 p-3 rounded-md bg-destructive/10 text-destructive text-sm">
              <AlertCircle className="h-4 w-4 shrink-0" />
              {err}
            </div>
          )}
          <div className="flex justify-end gap-2 pt-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                reset();
                onOpenChange(false);
              }}
              disabled={saving}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={handleSave}
              disabled={!isValid || saving}
            >
              {saving ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />
              ) : null}
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
  tenantId,
  onClose,
  onChanged,
}: {
  server: McpServer;
  tenantSlug: string;
  tenantId: string;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{
    ok: boolean;
    tools?: Array<{ name: string; description?: string }>;
    error?: string;
  } | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [toggling, setToggling] = useState(false);
  const [enabled, setEnabled] = useState(server.enabled !== false);
  const [showTools, setShowTools] = useState(false);
  const [approving, setApproving] = useState(false);
  const [rejectReason, setRejectReason] = useState("");
  const [showRejectInput, setShowRejectInput] = useState(false);
  const [contextTools, setContextTools] = useState<McpContextTool[]>([]);
  const [contextToolsLoading, setContextToolsLoading] = useState(false);
  const [contextToolSaving, setContextToolSaving] = useState<string | null>(
    null,
  );

  const loadContextTools = useCallback(async () => {
    if (!tenantSlug) return;
    setContextToolsLoading(true);
    try {
      const result = await listMcpContextTools(tenantSlug, server.id);
      setContextTools(result.tools);
    } catch (e) {
      console.warn("[MCP] Failed to load context tools", e);
    } finally {
      setContextToolsLoading(false);
    }
  }, [tenantSlug, server.id]);

  useEffect(() => {
    void loadContextTools();
  }, [loadContextTools]);

  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const result = await testMcpServer(tenantSlug, server.id);
      setTestResult(result);
      if (result.ok) {
        toast.success(`Connected — ${result.tools?.length || 0} tools`);
        await loadContextTools();
      }
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

  const handleApprove = async () => {
    if (!tenantId) {
      toast.error("Tenant context missing");
      return;
    }
    setApproving(true);
    try {
      await approveMcpServer(tenantId, server.id);
      toast.success("Server approved");
      onClose();
      onChanged();
    } catch (e) {
      toast.error(`Approve failed: ${(e as Error).message}`);
    } finally {
      setApproving(false);
    }
  };

  const handleReject = async () => {
    if (!tenantId) {
      toast.error("Tenant context missing");
      return;
    }
    setApproving(true);
    try {
      await rejectMcpServer(
        tenantId,
        server.id,
        rejectReason.trim() || undefined,
      );
      toast.success("Server rejected");
      onClose();
      onChanged();
    } catch (e) {
      toast.error(`Reject failed: ${(e as Error).message}`);
    } finally {
      setApproving(false);
    }
  };

  const handleAuthenticate = () => {
    const apiUrl = import.meta.env.VITE_API_URL || "";
    const authUrl = `${apiUrl}/api/skills/mcp-oauth/authorize?mcpServerId=${server.id}&tenantSlug=${tenantSlug}&force=true`;
    window.open(authUrl, "_blank", "width=600,height=700");
  };

  const handleContextToolUpdate = async (
    tool: McpContextTool,
    updates: { approved?: boolean; defaultEnabled?: boolean },
  ) => {
    setContextToolSaving(tool.id);
    try {
      const result = await updateMcpContextTool(tenantSlug, tool.id, updates);
      setContextTools((tools) =>
        tools.map((item) => (item.id === result.tool.id ? result.tool : item)),
      );
      toast.success("Context provider updated");
    } catch (e) {
      toast.error((e as Error).message || "Failed to update context provider");
    } finally {
      setContextToolSaving(null);
    }
  };

  const isConnected =
    testResult?.ok === true || (server.tools && server.tools.length > 0);
  const toolCount = testResult?.tools?.length ?? server.tools?.length ?? 0;
  const authLabel =
    server.authType === "oauth"
      ? "OAuth"
      : server.authType === "tenant_api_key"
        ? "API Key"
        : "None";

  return (
    <Dialog
      open
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
    >
      <DialogContent className="max-h-[min(90vh,760px)] max-w-3xl grid-rows-[auto_minmax(0,1fr)] overflow-hidden sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Cable className="h-5 w-5" />
            {server.name}
          </DialogTitle>
        </DialogHeader>
        <div className="min-h-0 space-y-4 overflow-x-hidden overflow-y-auto pr-1">
          {/* Status + URL */}
          <div className="space-y-2 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Status</span>
              <div className="flex items-center gap-1.5">
                {isConnected ? (
                  <>
                    <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />
                    <span className="text-green-500">connected</span>
                  </>
                ) : (
                  <>
                    <AlertCircle className="h-3.5 w-3.5 text-muted-foreground" />
                    <span className="text-muted-foreground">unknown</span>
                  </>
                )}
              </div>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Auth</span>
              <span>{authLabel}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">URL</span>
              <span className="font-mono text-xs truncate max-w-[280px]">
                {server.url}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Transport</span>
              <span className="font-mono text-xs">{server.transport}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Tools</span>
              <span>
                {toolCount} tool{toolCount !== 1 ? "s" : ""}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Enabled</span>
              <Switch
                checked={enabled}
                onCheckedChange={handleToggle}
                disabled={toggling}
              />
            </div>
          </div>

          {/* Test result */}
          {testResult && (
            <div
              className={`flex items-start gap-2 p-3 rounded-md text-sm ${testResult.ok ? "bg-green-500/10 text-green-600 dark:text-green-400" : "bg-destructive/10 text-destructive"}`}
            >
              {testResult.ok ? (
                <CheckCircle2 className="h-4 w-4 mt-0.5 shrink-0" />
              ) : (
                <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
              )}
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
                    <div
                      key={t.name}
                      className="text-xs px-2 py-1.5 bg-muted rounded"
                    >
                      <span className="font-mono font-medium">{t.name}</span>
                      {t.description && (
                        <p className="text-muted-foreground mt-0.5">
                          {t.description}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          <div className="border-t pt-4">
            <div className="mb-3 flex items-start justify-between gap-4">
              <div className="min-w-0 space-y-1">
                <div className="flex items-center gap-2 text-sm font-medium">
                  <ShieldCheck className="h-4 w-4 text-muted-foreground" />
                  Context Engine
                  {contextTools.length > 0 ? (
                    <Badge variant="secondary" className="text-[10px]">
                      {contextTools.length} provider
                      {contextTools.length === 1 ? "" : "s"}
                    </Badge>
                  ) : null}
                </div>
                <p className="max-w-2xl text-xs leading-5 text-muted-foreground">
                  Approve search-safe tools before they can participate in
                  Context Engine. Default search controls whether approved tools
                  are included automatically.
                </p>
              </div>
              {contextToolsLoading ? (
                <Loader2 className="mt-0.5 h-3.5 w-3.5 shrink-0 animate-spin text-muted-foreground" />
              ) : null}
            </div>
            {contextTools.length === 0 ? (
              <div className="rounded-md border border-dashed bg-muted/20 px-3 py-4 text-xs text-muted-foreground">
                No context providers discovered for this server.
              </div>
            ) : (
              <div className="rounded-md border">
                <div className="sticky top-0 z-10 hidden grid-cols-[minmax(0,1fr)_150px_112px_132px] gap-3 border-b bg-background/95 px-3 py-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground backdrop-blur sm:grid">
                  <div>Provider</div>
                  <div>Eligibility</div>
                  <div className="text-center">Approved</div>
                  <div className="text-center">Default search</div>
                </div>
                {contextTools.map((tool) => {
                  const saving = contextToolSaving === tool.id;
                  return (
                    <div
                      key={tool.id}
                      className="grid gap-3 border-b px-3 py-3 last:border-b-0 hover:bg-muted/25 sm:grid-cols-[minmax(0,1fr)_150px_112px_132px] sm:items-center"
                    >
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium">
                          {tool.displayName || tool.toolName}
                        </div>
                        <div className="truncate font-mono text-xs text-muted-foreground">
                          {tool.toolName}
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-1">
                        <Badge
                          variant={
                            tool.declaredReadOnly ? "secondary" : "outline"
                          }
                          className={
                            tool.declaredReadOnly
                              ? "text-[10px]"
                              : "text-[10px] text-muted-foreground"
                          }
                        >
                          {tool.declaredReadOnly
                            ? "read-only"
                            : "not read-only"}
                        </Badge>
                        <Badge
                          variant={
                            tool.declaredSearchSafe ? "secondary" : "outline"
                          }
                          className={
                            tool.declaredSearchSafe
                              ? "text-[10px]"
                              : "text-[10px] text-muted-foreground"
                          }
                        >
                          {tool.declaredSearchSafe
                            ? "search-safe"
                            : "not search-safe"}
                        </Badge>
                      </div>
                      <label className="flex items-center justify-between gap-3 rounded-md bg-muted/30 px-2 py-1.5 sm:justify-center sm:bg-transparent sm:p-0">
                        <span className="text-xs text-muted-foreground sm:sr-only">
                          Approve {tool.displayName || tool.toolName}
                        </span>
                        <Switch
                          size="sm"
                          checked={tool.approved}
                          disabled={saving}
                          onCheckedChange={(checked) =>
                            handleContextToolUpdate(tool, {
                              approved: checked,
                              defaultEnabled: checked
                                ? tool.defaultEnabled
                                : false,
                            })
                          }
                        />
                      </label>
                      <div className="flex flex-col gap-1 sm:items-center">
                        <label className="flex items-center justify-between gap-3 rounded-md bg-muted/30 px-2 py-1.5 sm:justify-center sm:bg-transparent sm:p-0">
                          <span className="text-xs text-muted-foreground sm:sr-only">
                            Include {tool.displayName || tool.toolName} in
                            default search
                          </span>
                          <Switch
                            size="sm"
                            checked={tool.defaultEnabled}
                            disabled={saving || !tool.approved}
                            onCheckedChange={(checked) =>
                              handleContextToolUpdate(tool, {
                                defaultEnabled: checked,
                              })
                            }
                          />
                        </label>
                        {!tool.approved ? (
                          <span className="text-[10px] text-muted-foreground">
                            approve first
                          </span>
                        ) : null}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Approval controls (plan §U11) — only render when status is set. */}
          {server.status === "pending" && (
            <div className="border-t pt-3 space-y-2">
              <div className="text-sm font-medium">Admin approval</div>
              <p className="text-xs text-muted-foreground">
                This MCP server was installed by a plugin and requires approval
                before any agent can invoke it. Approving pins the current URL
                and auth config — any later change reverts the row back to
                pending.
              </p>
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="default"
                  size="sm"
                  onClick={handleApprove}
                  disabled={approving}
                >
                  {approving ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />
                  ) : (
                    <CheckCircle2 className="h-3.5 w-3.5 mr-1.5" />
                  )}
                  Approve
                </Button>
                {!showRejectInput ? (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setShowRejectInput(true)}
                    disabled={approving}
                  >
                    Reject…
                  </Button>
                ) : (
                  <div className="flex items-center gap-2 w-full">
                    <Input
                      placeholder="Reason (optional, ≤500 chars)"
                      value={rejectReason}
                      onChange={(e) =>
                        setRejectReason(e.target.value.slice(0, 500))
                      }
                      className="flex-1"
                    />
                    <Button
                      variant="destructive"
                      size="sm"
                      onClick={handleReject}
                      disabled={approving}
                    >
                      Confirm reject
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setShowRejectInput(false);
                        setRejectReason("");
                      }}
                    >
                      Cancel
                    </Button>
                  </div>
                )}
              </div>
            </div>
          )}
          {server.status === "rejected" && (
            <div className="border-t pt-3">
              <Button
                variant="outline"
                size="sm"
                onClick={handleApprove}
                disabled={approving}
              >
                {approving ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />
                ) : (
                  <CheckCircle2 className="h-3.5 w-3.5 mr-1.5" />
                )}
                Re-approve
              </Button>
            </div>
          )}

          {/* Actions */}
          <div className="border-t pt-3">
            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={handleTest}
                disabled={testing}
              >
                {testing ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />
                ) : (
                  <TestTube className="h-3.5 w-3.5 mr-1.5" />
                )}
                Test Connection
              </Button>
              {server.authType === "oauth" && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleAuthenticate}
                >
                  Authenticate
                </Button>
              )}
              {confirmDelete ? (
                <>
                  <span className="text-sm text-muted-foreground">
                    Are you sure?
                  </span>
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={handleDelete}
                    disabled={deleting}
                  >
                    {deleting ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      "Delete"
                    )}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setConfirmDelete(false)}
                  >
                    Cancel
                  </Button>
                </>
              ) : (
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-destructive hover:text-destructive"
                  onClick={() => setConfirmDelete(true)}
                >
                  <Trash2 className="h-3.5 w-3.5 mr-1.5" />
                  Delete Server
                </Button>
              )}
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
