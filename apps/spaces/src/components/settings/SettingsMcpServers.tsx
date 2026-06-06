import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import type { ColumnDef } from "@tanstack/react-table";
import { Badge, Button, DataTable, Input, Switch } from "@thinkwork/ui";
import { useTenant } from "@/context/TenantContext";
import {
  deleteMcpServer,
  listMcpServers,
  listUserMcpServers,
  setMcpServerEnabled,
  type McpServer,
} from "@/lib/mcp-api";
import { SettingsTablePane } from "@/components/settings/SettingsContent";

export function SettingsMcpServers() {
  const { tenant, tenantId, userId } = useTenant();
  const navigate = useNavigate();
  const tenantSlug = tenant?.slug ?? null;
  const [servers, setServers] = useState<McpServer[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<Record<string, boolean>>({});
  const [search, setSearch] = useState("");

  const load = useCallback(() => {
    if (!tenantSlug) return;
    setError(null);
    Promise.all([
      listMcpServers(tenantSlug),
      tenantId && userId
        ? listUserMcpServers(tenantId, userId)
        : Promise.resolve({ servers: [] }),
    ])
      .then(([tenantResult, userResult]) => {
        const userById = new Map(userResult.servers.map((s) => [s.id, s]));
        setServers(
          tenantResult.servers.map((server) => ({
            ...server,
            authStatus: userById.get(server.id)?.authStatus,
          })),
        );
      })
      .catch((e) =>
        setError(e instanceof Error ? e.message : "Failed to load"),
      );
  }, [tenantId, tenantSlug, userId]);

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

  const remove = useCallback(
    async (id: string) => {
      if (!tenantSlug) return;
      setPending((p) => ({ ...p, [id]: true }));
      try {
        await deleteMcpServer(tenantSlug, id);
        setServers((prev) => prev?.filter((s) => s.id !== id) ?? prev);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to remove");
      } finally {
        setPending((p) => ({ ...p, [id]: false }));
      }
    },
    [tenantSlug],
  );

  const columns = useMemo<ColumnDef<McpServer>[]>(
    () => [
      {
        accessorKey: "name",
        header: "Name",
        size: 200,
        cell: ({ row }) => (
          <span className="font-medium">{row.original.name}</span>
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
          if (
            server.authType === "oauth" ||
            server.authType === "per_user_oauth"
          ) {
            return (
              <Badge
                variant={
                  server.authStatus === "active" ? "outline" : "secondary"
                }
                className={
                  server.authStatus === "active"
                    ? "border-emerald-500/40 text-emerald-400"
                    : undefined
                }
              >
                {server.authStatus === "active"
                  ? "connected"
                  : server.authStatus === "expired"
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
        cell: ({ row }) => (
          <span
            onClick={(e) => e.stopPropagation()}
            onPointerDown={(e) => e.stopPropagation()}
          >
            <Switch
              checked={row.original.enabled}
              disabled={pending[row.original.id]}
              onCheckedChange={(v) => toggle(row.original.id, v)}
            />
          </span>
        ),
      },
      {
        id: "actions",
        header: "",
        size: 90,
        cell: ({ row }) => (
          <Button
            size="sm"
            variant="ghost"
            disabled={pending[row.original.id]}
            onClick={(e) => {
              e.stopPropagation();
              remove(row.original.id);
            }}
          >
            Remove
          </Button>
        ),
      },
    ],
    [pending, toggle, remove],
  );

  return (
    <SettingsTablePane
      title="MCP Servers"
      description="Connect MCP tool servers and manage the tools they expose to agents."
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
      <DataTable
        columns={columns}
        data={servers ?? []}
        filterValue={search}
        filterColumn="name"
        scrollable
        allowHorizontalScroll={false}
        pageSize={25}
        tableClassName="table-fixed"
        onRowClick={(row) =>
          navigate({
            to: "/settings/mcp-servers/$serverId",
            params: { serverId: row.id },
          })
        }
        emptyState={
          <div className="py-10 text-center text-sm text-muted-foreground">
            No MCP servers configured.
          </div>
        }
      />
    </SettingsTablePane>
  );
}
