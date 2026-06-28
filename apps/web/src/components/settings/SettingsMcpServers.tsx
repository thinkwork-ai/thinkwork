import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import type { ColumnDef } from "@tanstack/react-table";
import {
  Badge,
  Button,
  DataTable,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Switch,
} from "@thinkwork/ui";
import { useAuth } from "@/context/AuthContext";
import { useTenant } from "@/context/TenantContext";
import {
  createMcpServer,
  isPluginInstalledMcpServer,
  listMcpServers,
  listUserMcpServers,
  setMcpServerEnabled,
  type McpServer,
} from "@/lib/mcp-api";
import {
  SettingsTablePane,
  settingsLinkActionClassName,
} from "@/components/settings/SettingsContent";

export function SettingsMcpServers() {
  const { user } = useAuth();
  const { tenant, tenantId, userId } = useTenant();
  const navigate = useNavigate();
  const tenantSlug = tenant?.slug ?? null;
  const oauthUserId = userId ?? user?.sub ?? null;
  const [servers, setServers] = useState<McpServer[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<Record<string, boolean>>({});
  const [search, setSearch] = useState("");
  const [addOpen, setAddOpen] = useState(false);
  const pluginServers = useMemo(
    () => sortMcpServers((servers ?? []).filter(isPluginInstalledMcpServer)),
    [servers],
  );
  const pluginServerUrls = useMemo(
    () => new Set(pluginServers.map((server) => normalizeMcpServerUrl(server))),
    [pluginServers],
  );
  const individualServers = useMemo(
    () =>
      sortMcpServers(
        (servers ?? []).filter(
          (server) =>
            !isPluginInstalledMcpServer(server) &&
            !pluginServerUrls.has(normalizeMcpServerUrl(server)),
        ),
      ),
    [pluginServerUrls, servers],
  );

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
            authStatus: userById.get(server.id)?.authStatus ?? server.authStatus,
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

  const columns = useMemo<ColumnDef<McpServer>[]>(
    () => [
      {
        accessorKey: "name",
        header: "Name",
        size: 200,
        cell: ({ row }) => {
          const server = row.original;
          return (
            <div className="flex min-w-0 items-center gap-2">
              <span className="truncate font-medium">{server.name}</span>
              {isPluginInstalledMcpServer(server) ? (
                <Badge variant="outline" className="shrink-0">
                  plugin
                </Badge>
              ) : null}
            </div>
          );
        },
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
            server.authType === "per_user_oauth";
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
                disabled={
                  pending[server.id] || isPluginInstalledMcpServer(server)
                }
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

  return (
    <>
      <SettingsTablePane
        title="MCP Servers"
        description="Connect MCP tool servers and manage the tools they expose to agents."
        loading={!servers && !error}
        actions={
          <button
            type="button"
            onClick={() => setAddOpen(true)}
            className={settingsLinkActionClassName}
          >
            + New MCP Server
          </button>
        }
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
        <div className="space-y-8">
          <McpServerSection
            columns={columns}
            servers={individualServers}
            search={search}
            emptyText="No individual MCP servers configured."
            onOpen={(serverId) =>
              navigate({
                to: "/settings/mcp-servers/$serverId",
                params: { serverId },
              })
            }
          />
          <McpServerSection
            title="From plugins"
            columns={columns}
            servers={pluginServers}
            search={search}
            emptyText="No MCP servers installed by plugins."
            onOpen={(serverId) =>
              navigate({
                to: "/settings/mcp-servers/$serverId",
                params: { serverId },
              })
            }
          />
        </div>
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
}: {
  title?: string;
  columns: ColumnDef<McpServer>[];
  servers: McpServer[];
  search: string;
  emptyText: string;
  onOpen: (serverId: string) => void;
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
        tableClassName="table-fixed"
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
                <SelectItem value="tenant_api_key">API key</SelectItem>
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
