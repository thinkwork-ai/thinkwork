import { useMemo, useState } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { useQuery } from "urql";
import { Badge, DataTable, Input, Skeleton } from "@thinkwork/ui";
import { ComputerKnowledgeBasesQuery } from "@/lib/graphql-queries";
import { useTenant } from "@/context/TenantContext";
import {
  SettingsHeader,
  SettingsPane,
  SettingsTablePane,
} from "@/components/settings/SettingsContent";

type KbRow = {
  id: string;
  name: string;
  description: string | null;
  status: string;
  documentCount: number;
  lastSyncAt: string | null;
};

function relativeTime(iso: string | null): string {
  if (!iso) return "Never";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "Never" : d.toLocaleDateString();
}

export function SettingsKnowledgeBases() {
  const { tenantId } = useTenant();
  const [search, setSearch] = useState("");
  const [result] = useQuery<{ knowledgeBases?: KbRow[] | null }>({
    query: ComputerKnowledgeBasesQuery,
    variables: { tenantId: tenantId ?? "" },
    pause: !tenantId,
  });

  const rows = useMemo<KbRow[]>(
    () => (result.data?.knowledgeBases ?? []) as KbRow[],
    [result.data],
  );

  const columns = useMemo<ColumnDef<KbRow>[]>(
    () => [
      { accessorKey: "name", header: "Name" },
      {
        accessorKey: "description",
        header: "Description",
        cell: ({ row }) => (
          <span className="block max-w-md truncate text-muted-foreground">
            {row.original.description ?? "—"}
          </span>
        ),
      },
      {
        accessorKey: "status",
        header: "Status",
        size: 110,
        cell: ({ row }) => (
          <Badge variant="outline">{row.original.status}</Badge>
        ),
      },
      {
        accessorKey: "documentCount",
        header: "Docs",
        size: 80,
        cell: ({ row }) => (
          <span className="tabular-nums">
            {row.original.documentCount ?? 0}
          </span>
        ),
      },
      {
        accessorKey: "lastSyncAt",
        header: "Last sync",
        size: 120,
        cell: ({ row }) => (
          <span className="text-muted-foreground">
            {relativeTime(row.original.lastSyncAt)}
          </span>
        ),
      },
    ],
    [],
  );

  if (result.fetching && !result.data) {
    return (
      <SettingsPane className="max-w-5xl">
        <SettingsHeader title="Knowledge Bases" />
        <Skeleton className="h-64 w-full rounded-xl" />
      </SettingsPane>
    );
  }

  return (
    <SettingsTablePane
      title="Knowledge Bases"
      description="Document collections the agent can search."
      toolbar={
        <Input
          placeholder="Search knowledge bases…"
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
            No knowledge bases yet.
          </div>
        }
      />
    </SettingsTablePane>
  );
}
