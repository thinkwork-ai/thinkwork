import { useCallback, useEffect, useMemo, useState } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { DataTable, Input, Switch } from "@thinkwork/ui";
import { useTenant } from "@/context/TenantContext";
import {
  listBuiltinTools,
  setBuiltinToolEnabled,
  type BuiltinTool,
} from "@/lib/builtin-tools-api";
import { SettingsTablePane } from "@/components/settings/SettingsContent";

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

  return (
    <SettingsTablePane
      title="Built-in Tools"
      loading={!tools && !error}
      toolbar={
        error ? (
          <p className="text-sm text-destructive">{error}</p>
        ) : (
          <Input
            placeholder="Search tools…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="max-w-sm"
          />
        )
      }
    >
      <DataTable
        columns={columns}
        data={tools ?? []}
        filterValue={search}
        filterColumn="toolSlug"
        scrollable
        allowHorizontalScroll={false}
        pageSize={25}
        tableClassName="table-fixed"
        emptyState={
          <div className="py-10 text-center text-sm text-muted-foreground">
            No built-in tools available.
          </div>
        }
      />
    </SettingsTablePane>
  );
}
