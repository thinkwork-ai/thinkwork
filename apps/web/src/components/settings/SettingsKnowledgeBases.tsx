import { useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import type { ColumnDef } from "@tanstack/react-table";
import { useQuery } from "urql";
import { Badge, DataTable, Input } from "@thinkwork/ui";
import { KnowledgeBasesListQuery } from "@/lib/kb-queries";
import { useTenant } from "@/context/TenantContext";
import {
  SettingsTablePane,
  settingsLinkActionClassName,
} from "@/components/settings/SettingsContent";
import { KnowledgeBaseFormDialog } from "@/components/settings/KnowledgeBaseFormDialog";

type KbRow = {
  id: string;
  name: string;
  description?: string | null;
  status: string;
  documentCount?: number | null;
  lastSyncAt?: string | null;
};

function relativeTime(iso?: string | null): string {
  if (!iso) return "Never";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "Never" : d.toLocaleDateString();
}

function statusVariant(
  status: string,
): "secondary" | "destructive" | "outline" {
  if (status === "active") return "secondary";
  if (status === "failed") return "destructive";
  return "outline";
}

export function SettingsKnowledgeBases({
  embedded,
}: {
  embedded?: boolean;
} = {}) {
  const { tenantId } = useTenant();
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [result, refetch] = useQuery({
    query: KnowledgeBasesListQuery,
    variables: { tenantId: tenantId ?? "" },
    pause: !tenantId,
    requestPolicy: "cache-and-network",
  });

  const rows = useMemo<KbRow[]>(
    () => (result.data?.knowledgeBases ?? []) as KbRow[],
    [result.data],
  );

  const columns = useMemo<ColumnDef<KbRow>[]>(
    () => [
      {
        accessorKey: "name",
        header: "Name",
        cell: ({ row }) => (
          <span className="font-medium">{row.original.name}</span>
        ),
      },
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
          <Badge variant={statusVariant(row.original.status)}>
            {row.original.status}
          </Badge>
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

  return (
    <>
      <SettingsTablePane
        title="Brain Sources"
        description="Manage retained Space document sources for the Hindsight Brain."
        embedded={embedded}
        loading={result.fetching && !result.data}
        toolbar={
          <Input
            placeholder="Search sources..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-56"
          />
        }
        actions={
          <button
            type="button"
            className={settingsLinkActionClassName}
            onClick={() => setCreateOpen(true)}
          >
            + New source
          </button>
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
          onRowClick={(row) =>
            navigate({
              to: "/settings/knowledge-bases/$kbId",
              params: { kbId: row.id },
            })
          }
          emptyState={
            <div className="py-10 text-center text-sm text-muted-foreground">
              No Brain Sources yet.
            </div>
          }
        />
      </SettingsTablePane>
      <KnowledgeBaseFormDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onSaved={() => refetch({ requestPolicy: "network-only" })}
      />
    </>
  );
}
