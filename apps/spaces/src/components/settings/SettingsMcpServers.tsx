import { useCallback, useEffect, useMemo, useState } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import {
  Badge,
  Button,
  DataTable,
  Input,
  Skeleton,
  Switch,
} from "@thinkwork/ui";
import { useTenant } from "@/context/TenantContext";
import {
  deleteMcpServer,
  listMcpServers,
  setMcpServerEnabled,
  type McpServer,
} from "@/lib/mcp-api";
import {
  SettingsHeader,
  SettingsPane,
  SettingsTablePane,
} from "@/components/settings/SettingsContent";

export function SettingsMcpServers() {
  const { tenant } = useTenant();
  const tenantSlug = tenant?.slug ?? null;
  const [servers, setServers] = useState<McpServer[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<Record<string, boolean>>({});
  const [search, setSearch] = useState("");

  const load = useCallback(() => {
    if (!tenantSlug) return;
    setError(null);
    listMcpServers(tenantSlug)
      .then((r) => setServers(r.servers))
      .catch((e) =>
        setError(e instanceof Error ? e.message : "Failed to load"),
      );
  }, [tenantSlug]);

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
        cell: ({ row }) =>
          row.original.status && row.original.status !== "approved" ? (
            <Badge variant="outline">{row.original.status}</Badge>
          ) : (
            <span className="text-muted-foreground">—</span>
          ),
      },
      {
        id: "enabled",
        header: "Enabled",
        size: 90,
        cell: ({ row }) => (
          <Switch
            checked={row.original.enabled}
            disabled={pending[row.original.id]}
            onCheckedChange={(v) => toggle(row.original.id, v)}
          />
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
            onClick={() => remove(row.original.id)}
          >
            Remove
          </Button>
        ),
      },
    ],
    [pending, toggle, remove],
  );

  if (!servers && !error) {
    return (
      <SettingsPane className="max-w-5xl">
        <SettingsHeader title="MCP Servers" />
        <Skeleton className="h-64 w-full rounded-xl" />
      </SettingsPane>
    );
  }

  return (
    <SettingsTablePane
      title="MCP Servers"
      description="Model Context Protocol servers available to the agent."
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
        emptyState={
          <div className="py-10 text-center text-sm text-muted-foreground">
            No MCP servers configured.
          </div>
        }
      />
    </SettingsTablePane>
  );
}
