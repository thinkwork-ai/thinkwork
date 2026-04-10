import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery, useMutation } from "urql";
import { type ColumnDef } from "@tanstack/react-table";
import { BookOpen, Plus } from "lucide-react";
import { useState, useMemo, useCallback } from "react";
import { useTenant } from "@/context/TenantContext";
import { useBreadcrumbs } from "@/context/BreadcrumbContext";
import { PageLayout } from "@/components/PageLayout";
import { StatusBadge } from "@/components/StatusBadge";
import { EmptyState } from "@/components/EmptyState";
import { PageSkeleton } from "@/components/PageSkeleton";
import { DataTable } from "@/components/ui/data-table";
import { Button } from "@/components/ui/button";
import { FilterBarSearch } from "@/components/ui/data-table-filter-bar";
import { KnowledgeBasesListQuery } from "@/lib/graphql-queries";
import { KnowledgeBaseFormDialog } from "@/components/knowledge-bases/KnowledgeBaseFormDialog";
import { relativeTime } from "@/lib/utils";

export const Route = createFileRoute(
  "/_authed/_tenant/knowledge-bases/",
)({
  component: KnowledgeBasesPage,
});

type KbRow = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  status: string;
  documentCount: number;
  lastSyncAt: string | null;
  lastSyncStatus: string | null;
  createdAt: string;
};

const columns: ColumnDef<KbRow>[] = [
  {
    accessorKey: "name",
    header: "Name",
    cell: ({ row }) => (
      <span className="flex items-center gap-1.5 font-medium whitespace-nowrap">
        <BookOpen className="h-3.5 w-3.5 shrink-0 text-primary" />
        {row.original.name}
      </span>
    ),
  },
  {
    accessorKey: "status",
    header: "Status",
    cell: ({ row }) => (
      <span className="whitespace-nowrap">
        <StatusBadge status={row.original.status} size="sm" />
      </span>
    ),
    size: 100,
  },
  {
    accessorKey: "documentCount",
    header: "Docs",
    cell: ({ row }) => (
      <span className="text-sm text-muted-foreground">
        {row.original.documentCount ?? 0}
      </span>
    ),
    size: 70,
  },
  {
    accessorKey: "lastSyncAt",
    header: "Last Sync",
    cell: ({ row }) => (
      <span className="text-sm text-muted-foreground whitespace-nowrap">
        {row.original.lastSyncAt ? relativeTime(row.original.lastSyncAt) : "Never"}
      </span>
    ),
    size: 120,
  },
  {
    accessorKey: "description",
    header: "Description",
    cell: ({ row }) => (
      <span className="text-sm text-muted-foreground truncate max-w-[300px] block">
        {row.original.description || "—"}
      </span>
    ),
  },
];

function KnowledgeBasesPage() {
  const { tenantId } = useTenant();
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const [createOpen, setCreateOpen] = useState(false);

  useBreadcrumbs([{ label: "Knowledge Bases" }]);

  const [result, reexecute] = useQuery({
    query: KnowledgeBasesListQuery,
    variables: { tenantId: tenantId! },
    pause: !tenantId,
    requestPolicy: "cache-and-network",
  });

  const rows = useMemo<KbRow[]>(() => {
    const kbs = (result.data as any)?.knowledgeBases ?? [];
    return kbs
      .map((kb: any) => ({
        id: kb.id,
        name: kb.name,
        slug: kb.slug,
        description: kb.description,
        status: kb.status,
        documentCount: kb.documentCount ?? 0,
        lastSyncAt: kb.lastSyncAt,
        lastSyncStatus: kb.lastSyncStatus,
        createdAt: kb.createdAt,
      }))
      .filter((kb: KbRow) =>
        !search || kb.name.toLowerCase().includes(search.toLowerCase()),
      );
  }, [result.data, search]);

  const handleCreated = useCallback(() => {
    setCreateOpen(false);
    reexecute({ requestPolicy: "network-only" });
  }, [reexecute]);

  if (result.fetching && !result.data) return <PageSkeleton />;

  return (
    <PageLayout
      header={
        <>
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-lg font-semibold">Knowledge Bases</h1>
              <p className="text-xs text-muted-foreground">Manage document-backed knowledge for your agents</p>
            </div>
            <div className="flex items-center gap-2">
              <Button onClick={() => setCreateOpen(true)}>
                <Plus className="h-4 w-4" />
                New KB
              </Button>
            </div>
          </div>
          <div className="flex items-center gap-2 mt-4">
            <FilterBarSearch value={search} onChange={setSearch} placeholder="Search..." />
          </div>
        </>
      }
    >
      {rows.length === 0 && !search ? (
        <EmptyState
          icon={BookOpen}
          title="No knowledge bases"
          description="Create a knowledge base to give agents access to your documents."
          action={{
            label: "Create Knowledge Base",
            onClick: () => setCreateOpen(true),
          }}
        />
      ) : (
        <DataTable
          columns={columns}
          data={rows}
          onRowClick={(row) =>
            navigate({
              to: "/knowledge-bases/$kbId",
              params: { kbId: row.id },
            })
          }
        />
      )}

      <KnowledgeBaseFormDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onSaved={handleCreated}
      />
    </PageLayout>
  );
}
