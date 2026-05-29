import { useMemo, useState } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { useQuery } from "urql";
import { Badge, DataTable, Input, Skeleton } from "@thinkwork/ui";
import { ComputerRecentWikiPagesQuery } from "@/lib/graphql-queries";
import { useTenant } from "@/context/TenantContext";
import {
  SettingsHeader,
  SettingsPane,
} from "@/components/settings/SettingsContent";

type WikiRow = {
  id: string;
  type: string;
  slug: string;
  title: string;
  summary: string | null;
  updatedAt: string | null;
};

function relativeTime(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleDateString();
}

export function SettingsWiki() {
  const { tenantId } = useTenant();
  const [search, setSearch] = useState("");
  const [result] = useQuery<{ recentWikiPages?: WikiRow[] | null }>({
    query: ComputerRecentWikiPagesQuery,
    variables: { tenantId: tenantId ?? "", limit: 100 },
    pause: !tenantId,
  });

  const rows = useMemo<WikiRow[]>(
    () => (result.data?.recentWikiPages ?? []) as WikiRow[],
    [result.data],
  );

  const columns = useMemo<ColumnDef<WikiRow>[]>(
    () => [
      { accessorKey: "title", header: "Title" },
      {
        accessorKey: "type",
        header: "Type",
        size: 120,
        cell: ({ row }) => (
          <Badge variant="outline">{row.original.type?.toLowerCase()}</Badge>
        ),
      },
      {
        accessorKey: "summary",
        header: "Summary",
        cell: ({ row }) => (
          <span className="block max-w-md truncate text-muted-foreground">
            {row.original.summary ?? "—"}
          </span>
        ),
      },
      {
        accessorKey: "updatedAt",
        header: "Updated",
        size: 120,
        cell: ({ row }) => (
          <span className="text-muted-foreground">
            {relativeTime(row.original.updatedAt)}
          </span>
        ),
      },
    ],
    [],
  );

  if (result.fetching && !result.data) {
    return (
      <SettingsPane className="max-w-5xl">
        <SettingsHeader title="Wiki" />
        <Skeleton className="h-64 w-full rounded-xl" />
      </SettingsPane>
    );
  }

  return (
    <SettingsPane className="max-w-5xl">
      <SettingsHeader
        title="Wiki"
        description="Compiled knowledge pages distilled from memory."
      />
      <div className="mb-4">
        <Input
          placeholder="Search pages…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-sm"
        />
      </div>
      <DataTable
        columns={columns}
        data={rows}
        filterValue={search}
        filterColumn="title"
        pageSize={20}
        emptyState={
          <div className="py-10 text-center text-sm text-muted-foreground">
            No wiki pages yet.
          </div>
        }
      />
    </SettingsPane>
  );
}
