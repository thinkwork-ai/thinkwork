import { useCallback, useEffect, useMemo, useState } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { DataTable, Input, Skeleton, Switch } from "@thinkwork/ui";
import { useTenant } from "@/context/TenantContext";
import {
  listBuiltinTools,
  setBuiltinToolEnabled,
  type BuiltinTool,
} from "@/lib/builtin-tools-api";
import {
  SettingsHeader,
  SettingsPane,
} from "@/components/settings/SettingsContent";

export function SettingsTools() {
  const { tenant } = useTenant();
  const tenantSlug = tenant?.slug ?? null;
  const [tools, setTools] = useState<BuiltinTool[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<Record<string, boolean>>({});
  const [search, setSearch] = useState("");

  const load = useCallback(() => {
    if (!tenantSlug) return;
    setError(null);
    listBuiltinTools(tenantSlug)
      .then((r) => setTools(r.tools))
      .catch((e) =>
        setError(e instanceof Error ? e.message : "Failed to load"),
      );
  }, [tenantSlug]);

  useEffect(() => {
    load();
  }, [load]);

  const toggle = useCallback(
    async (slug: string, enabled: boolean) => {
      if (!tenantSlug) return;
      setPending((p) => ({ ...p, [slug]: true }));
      setTools(
        (prev) =>
          prev?.map((t) => (t.toolSlug === slug ? { ...t, enabled } : t)) ??
          prev,
      );
      try {
        await setBuiltinToolEnabled(tenantSlug, slug, enabled);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to update");
        load();
      } finally {
        setPending((p) => ({ ...p, [slug]: false }));
      }
    },
    [tenantSlug, load],
  );

  const columns = useMemo<ColumnDef<BuiltinTool>[]>(
    () => [
      {
        accessorKey: "toolSlug",
        header: "Tool",
        cell: ({ row }) => (
          <span className="font-medium">{row.original.toolSlug}</span>
        ),
      },
      {
        accessorKey: "provider",
        header: "Provider",
        size: 180,
        cell: ({ row }) => (
          <span className="text-muted-foreground">
            {row.original.provider ?? "—"}
          </span>
        ),
      },
      {
        id: "enabled",
        header: "Enabled",
        size: 90,
        cell: ({ row }) => (
          <Switch
            checked={row.original.enabled}
            disabled={pending[row.original.toolSlug]}
            onCheckedChange={(v) => toggle(row.original.toolSlug, v)}
          />
        ),
      },
    ],
    [pending, toggle],
  );

  if (!tools && !error) {
    return (
      <SettingsPane className="max-w-5xl">
        <SettingsHeader title="Built-in Tools" />
        <Skeleton className="h-64 w-full rounded-xl" />
      </SettingsPane>
    );
  }

  return (
    <SettingsPane className="max-w-5xl">
      <SettingsHeader
        title="Built-in Tools"
        description="Enable or disable the agent’s built-in tools."
      />
      {error ? (
        <p className="mb-4 text-sm text-destructive">{error}</p>
      ) : (
        <div className="mb-4">
          <Input
            placeholder="Search tools…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="max-w-sm"
          />
        </div>
      )}
      <DataTable
        columns={columns}
        data={tools ?? []}
        filterValue={search}
        filterColumn="toolSlug"
        pageSize={10}
        allowHorizontalScroll={false}
        tableClassName="table-fixed"
        emptyState={
          <div className="py-10 text-center text-sm text-muted-foreground">
            No built-in tools available.
          </div>
        }
      />
    </SettingsPane>
  );
}
