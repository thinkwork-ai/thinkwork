import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "@tanstack/react-router";
import type { ColumnDef } from "@tanstack/react-table";
import { Plus } from "lucide-react";
import {
  Badge,
  Button,
  DataTable,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Switch,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  TooltipIconButton,
} from "@thinkwork/ui";
import { useAuth } from "@/context/AuthContext";
import { usePageHeaderActions } from "@/context/PageHeaderContext";
import { useTenant } from "@/context/TenantContext";
import {
  createMcpServer,
  listMcpServers,
  listUserMcpServers,
  setMcpServerEnabled,
  type McpServer,
} from "@/lib/mcp-api";
import { SettingsTablePane } from "@/components/settings/SettingsContent";
import { SettingsConnections } from "@/components/settings/SettingsConnections";

const CONNECTIONS_ROUTE = "/settings/mcp-servers";
const MCP_SERVERS_ROUTE = "/settings/mcp-servers/servers";

type ConnectionsTab = "connections" | "servers";

function tabForPath(pathname: string): ConnectionsTab {
  // The merged MCP list lives at /servers. The section index is the
  // Connections tab (per-user integrations).
  if (pathname.startsWith(MCP_SERVERS_ROUTE)) return "servers";
  return "connections";
}

export function SettingsMcpServers() {
  const { user } = useAuth();
  const { tenant, tenantId, userId, isOperator } = useTenant();
  const navigate = useNavigate();
  const pathname = useLocation({ select: (location) => location.pathname });
  const activeTab = tabForPath(pathname);
  const tenantSlug = tenant?.slug ?? null;
  const oauthUserId = userId ?? user?.sub ?? null;
  const [servers, setServers] = useState<McpServer[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<Record<string, boolean>>({});
  const [search, setSearch] = useState("");
  const [addOpen, setAddOpen] = useState(false);
  // Every server is tenant-registered now: the plugin system is gone and
  // migration 0279 moved its servers to `manual` provenance.
  const mergedServers = useMemo(() => sortMcpServers(servers ?? []), [servers]);

  const load = useCallback(() => {
    if (!tenantSlug) return;
    setError(null);
    Promise.all([
      listMcpServers(tenantSlug),
      tenantId && oauthUserId
        ? listUserMcpServers(tenantId, oauthUserId)
        : Promise.resolve({ servers: [] }),
    ])
      .then(([tenantResult, userResult]) => {
        const userById = new Map(userResult.servers.map((s) => [s.id, s]));
        setServers(
          tenantResult.servers.map((server) => ({
            ...server,
            authStatus:
              userById.get(server.id)?.authStatus ?? server.authStatus,
          })),
        );
      })
      .catch((e) =>
        setError(e instanceof Error ? e.message : "Failed to load"),
      );
  }, [oauthUserId, tenantId, tenantSlug]);

  useEffect(() => {
    load();
  }, [load]);

  const toggle = useCallback(
    async (id: string, enabled: boolean) => {
      if (!tenantSlug) return;
      setPending((p) => ({ ...p, [id]: true }));
      setServers(
        (prev) =>
          prev?.map((s) => (s.id === id ? { ...s, enabled } : s)) ?? prev,
      );
      try {
        await setMcpServerEnabled(tenantSlug, id, enabled);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to update");
        load();
      } finally {
        setPending((p) => ({ ...p, [id]: false }));
      }
    },
    [tenantSlug, load],
  );

  const makeColumns = useCallback(
    (): ColumnDef<McpServer>[] => [
      {
        accessorKey: "name",
        header: "Name",
        size: 200,
        cell: ({ row }) => (
          <span className="block truncate font-medium">
            {row.original.name}
          </span>
        ),
      },
      {
        accessorKey: "url",
        header: "URL",
        cell: ({ row }) => (
          <span className="block max-w-md truncate font-mono text-xs text-muted-foreground">
            {row.original.url}
          </span>
        ),
      },
      {
        accessorKey: "status",
        header: "Status",
        size: 110,
        cell: ({ row }) => {
          const server = row.original;
          const requiresUserAuth =
            server.authType === "oauth" ||
            server.authType === "per_user_oauth" ||
            server.authType === "per_user_api_key";
          const authStatus =
            server.authStatus ??
            (requiresUserAuth ? "not_connected" : undefined);
          if (authStatus) {
            return (
              <Badge
                variant={authStatus === "active" ? "outline" : "secondary"}
                className={
                  authStatus === "active"
                    ? "border-emerald-500/40 text-emerald-400"
                    : undefined
                }
              >
                {authStatus === "active"
                  ? "connected"
                  : authStatus === "expired"
                    ? "expired"
                    : "not connected"}
              </Badge>
            );
          }
          return server.status && server.status !== "approved" ? (
            <Badge variant="outline">{server.status}</Badge>
          ) : (
            <span className="text-muted-foreground">—</span>
          );
        },
      },
      {
        id: "enabled",
        header: "Enabled",
        size: 90,
        cell: ({ row }) => {
          const server = row.original;
          return (
            <span
              onClick={(e) => e.stopPropagation()}
              onPointerDown={(e) => e.stopPropagation()}
            >
              <Switch
                checked={server.enabled}
                disabled={pending[server.id]}
                onCheckedChange={(v) => toggle(server.id, v)}
                aria-label={`Toggle ${server.name}`}
              />
            </span>
          );
        },
      },
    ],
    [pending, toggle],
  );
  const serverColumns = useMemo(() => makeColumns(), [makeColumns]);

  usePageHeaderActions({
    title: "Connectors",
    breadcrumbs: [{ label: "Connectors" }],
    tabs: isOperator
      ? [
          { to: CONNECTIONS_ROUTE, label: "Connections" },
          { to: MCP_SERVERS_ROUTE, label: "MCP Servers" },
        ]
      : [{ to: CONNECTIONS_ROUTE, label: "Connections" }],
    // Each tab shows only the action that creates the thing it lists — New
    // MCP Server on the servers tab, nothing on the per-user Connections tab.
    action:
      isOperator && activeTab === "servers" ? (
        <TooltipIconButton
          label="New MCP Server — register an MCP server for the tenant."
          aria-label="New MCP Server"
          onClick={() => setAddOpen(true)}
        >
          <Plus className="size-4" />
        </TooltipIconButton>
      ) : undefined,
    actionKey: `mcp-servers:${activeTab}`,
  });

  if (activeTab === "connections") {
    return (
      <SettingsTablePane
        embedded
        title="Connections"
        description="Your personal integrations — connect the accounts your agent works with on your behalf. Credentials are stored per user; other members connect their own."
        loading={false}
      >
        <SettingsConnections />
      </SettingsTablePane>
    );
  }

  const openServer = (serverId: string) =>
    navigate({
      to: "/settings/mcp-servers/$serverId",
      params: { serverId },
    });

  return (
    <>
      <SettingsTablePane
        embedded
        title="MCP Servers"
        description="The tenant MCP server registry. Register servers, configure credentials and OAuth, and manage the tools they expose. Assign a server to the agent in the Composer."
        loading={!servers && !error}
        toolbar={
          error ? (
            <p className="text-sm text-destructive">{error}</p>
          ) : (
            <Input
              placeholder="Search servers…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="max-w-sm"
            />
          )
        }
      >
        <McpServerSection
          columns={serverColumns}
          servers={mergedServers}
          search={search}
          emptyText="No MCP servers configured."
          onOpen={openServer}
        />
      </SettingsTablePane>
      <NewMcpServerDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        tenantSlug={tenantSlug}
        onCreated={() => {
          setAddOpen(false);
          load();
        }}
      />
    </>
  );
}

function McpServerSection({
  title,
  columns,
  servers,
  search,
  emptyText,
  onOpen,
  fitContent,
}: {
  title?: string;
  columns: ColumnDef<McpServer>[];
  servers: McpServer[];
  search: string;
  emptyText: string;
  onOpen: (serverId: string) => void;
  /** Auto table layout so w-px/whitespace-nowrap columns hug their content
   *  (fixed layout would collapse them to 1px). */
  fitContent?: boolean;
}) {
  return (
    <section>
      {title ? (
        <h2 className="mb-3 text-base font-medium text-foreground">{title}</h2>
      ) : null}
      <DataTable
        columns={columns}
        data={servers}
        filterValue={search}
        filterColumn="name"
        scrollable
        allowHorizontalScroll={false}
        pageSize={0}
        tableClassName={fitContent ? "table-auto" : "table-fixed"}
        onRowClick={(row) => onOpen(row.id)}
        emptyState={
          <div className="py-10 text-center text-sm text-muted-foreground">
            {emptyText}
          </div>
        }
      />
    </section>
  );
}

function normalizeMcpServerUrl(server: McpServer): string {
  return server.url.trim().replace(/\/+$/, "").toLowerCase();
}

function sortMcpServers(servers: McpServer[]): McpServer[] {
  return [...servers].sort((left, right) => {
    const byName = left.name.localeCompare(right.name, undefined, {
      numeric: true,
      sensitivity: "base",
    });
    if (byName !== 0) return byName;
    return normalizeMcpServerUrl(left).localeCompare(
      normalizeMcpServerUrl(right),
      undefined,
      { numeric: true, sensitivity: "base" },
    );
  });
}

function NewMcpServerDialog({
  open,
  onOpenChange,
  tenantSlug,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tenantSlug: string | null;
  onCreated: () => void;
}) {
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [authType, setAuthType] = useState("none");
  const [apiKey, setApiKey] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Reset the form each time the dialog opens.
  useEffect(() => {
    if (open) {
      setName("");
      setUrl("");
      setAuthType("none");
      setApiKey("");
      setErrorMsg(null);
      setSubmitting(false);
    }
  }, [open]);

  const canSubmit =
    !!tenantSlug &&
    name.trim().length > 0 &&
    url.trim().length > 0 &&
    (authType !== "tenant_api_key" || apiKey.trim().length > 0) &&
    !submitting;

  async function onSubmit() {
    if (!tenantSlug || !canSubmit) return;
    setSubmitting(true);
    setErrorMsg(null);
    try {
      await createMcpServer(tenantSlug, {
        name: name.trim(),
        url: url.trim(),
        authType,
        ...(authType === "tenant_api_key" ? { apiKey: apiKey.trim() } : {}),
      });
      onCreated();
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : "Failed to add server");
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New MCP server</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Name</label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="My MCP server"
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium">URL</label>
            <Input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://example.com/mcp"
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Authentication</label>
            <Select value={authType} onValueChange={setAuthType}>
              <SelectTrigger className="w-48">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">None</SelectItem>
                <SelectItem value="tenant_api_key">API key (tenant)</SelectItem>
                <SelectItem value="per_user_api_key">
                  API key (per user)
                </SelectItem>
                <SelectItem value="oauth">OAuth</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {authType === "tenant_api_key" ? (
            <div className="space-y-1.5">
              <label className="text-sm font-medium">API key</label>
              <Input
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="Secret token"
              />
            </div>
          ) : null}
          {authType === "oauth" ? (
            <p className="text-xs text-muted-foreground">
              Connect this server&apos;s OAuth from its detail page after adding
              it.
            </p>
          ) : null}
          {authType === "per_user_api_key" ? (
            <p className="text-xs text-muted-foreground">
              Each member saves their own API key from this server&apos;s detail
              page. The server stays inactive for anyone who hasn&apos;t added a
              key.
            </p>
          ) : null}
          {errorMsg ? (
            <p className="text-sm text-destructive">{errorMsg}</p>
          ) : null}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={onSubmit} disabled={!canSubmit}>
            {submitting ? "Adding…" : "Add server"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
