import { useMemo, useState } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { useQuery } from "urql";
import { Badge, DataTable, Input } from "@thinkwork/ui";
import { useTenant } from "@/context/TenantContext";
import { SettingsWebhooksQuery } from "@/lib/settings-queries";
import { SettingsTablePane } from "@/components/settings/SettingsContent";

type WebhookRow = {
  id: string;
  name: string;
  description?: string | null;
  targetType: string;
  enabled: boolean;
  invocationCount: number;
  lastInvokedAt?: string | null;
};

function relativeTime(value: unknown): string {
  if (!value) return "Never";
  const d = new Date(value as string);
  return Number.isNaN(d.getTime()) ? "Never" : d.toLocaleDateString();
}

export function SettingsWebhooks() {
  const { tenantId } = useTenant();
  const [search, setSearch] = useState("");
  const [result] = useQuery({
    query: SettingsWebhooksQuery,
    variables: { tenantId: tenantId ?? "" },
    pause: !tenantId,
  });

  const rows = useMemo<WebhookRow[]>(
    () => (result.data?.webhooks ?? []) as WebhookRow[],
    [result.data],
  );

  const columns = useMemo<ColumnDef<WebhookRow>[]>(
    () => [
      { accessorKey: "name", header: "Name" },
      {
        accessorKey: "targetType",
        header: "Target",
        size: 120,
        cell: ({ row }) => (
          <Badge variant="outline">{row.original.targetType}</Badge>
        ),
      },
      {
        accessorKey: "enabled",
        header: "Status",
        size: 100,
        cell: ({ row }) => (
          <Badge variant={row.original.enabled ? "default" : "secondary"}>
            {row.original.enabled ? "Enabled" : "Disabled"}
          </Badge>
        ),
      },
      {
        accessorKey: "invocationCount",
        header: "Calls",
        size: 80,
        cell: ({ row }) => (
          <span className="tabular-nums">
            {row.original.invocationCount ?? 0}
          </span>
        ),
      },
      {
        accessorKey: "lastInvokedAt",
        header: "Last call",
        size: 120,
        cell: ({ row }) => (
          <span className="text-muted-foreground">
            {relativeTime(row.original.lastInvokedAt)}
          </span>
        ),
      },
    ],
    [],
  );

  return (
    <SettingsTablePane
      title="Webhooks"
      loading={result.fetching && !result.data}
      toolbar={
        <Input
          placeholder="Search webhooks…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-sm"
        />
      }
    >
      <DataTable
        columns={columns}
        data={rows}
        filterValue={search}
        filterColumn="name"
        scrollable
        allowHorizontalScroll={false}
        pageSize={25}
        tableClassName="table-fixed"
        emptyState={
          <div className="py-10 text-center text-sm text-muted-foreground">
            No webhooks configured.
          </div>
        }
      />
    </SettingsTablePane>
  );
}
