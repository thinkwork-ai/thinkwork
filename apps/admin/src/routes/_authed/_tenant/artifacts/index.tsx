import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "urql";
import { type ColumnDef } from "@tanstack/react-table";
import { FileText, BarChart3, Notebook, ClipboardList, PenLine, Mail } from "lucide-react";
import { useState, useMemo } from "react";
import { useTenant } from "@/context/TenantContext";
import { useBreadcrumbs } from "@/context/BreadcrumbContext";
import { PageHeader } from "@/components/PageHeader";
import { PageLayout } from "@/components/PageLayout";
import { StatusBadge } from "@/components/StatusBadge";
import { EmptyState } from "@/components/EmptyState";
import { PageSkeleton } from "@/components/PageSkeleton";
import { DataTable } from "@/components/ui/data-table";
import { FilterBarSearch } from "@/components/ui/data-table-filter-bar";
import { ArtifactViewDialog } from "@/components/threads/ArtifactViewDialog";
import { ArtifactsListQuery, ArtifactDetailQuery } from "@/lib/graphql-queries";
import { relativeTime } from "@/lib/utils";

export const Route = createFileRoute("/_authed/_tenant/artifacts/")({
  component: ArtifactsPage,
});

type ArtifactRow = {
  id: string;
  title: string;
  type: string;
  status: string;
  summary: string | null;
  agentId: string | null;
  threadId: string | null;
  createdAt: string;
  updatedAt: string;
};

const TYPE_ICONS: Record<string, typeof FileText> = {
  REPORT: BarChart3,
  DATA_VIEW: BarChart3,
  NOTE: Notebook,
  PLAN: ClipboardList,
  DRAFT: PenLine,
  DIGEST: Mail,
};

const columns: ColumnDef<ArtifactRow>[] = [
  {
    accessorKey: "title",
    header: "Title",
    cell: ({ row }) => {
      const Icon = TYPE_ICONS[row.original.type] ?? FileText;
      return (
        <span className="flex items-center gap-1.5 font-medium">
          <Icon className="h-3.5 w-3.5 shrink-0 text-primary" />
          <span className="truncate max-w-[300px]">{row.original.title}</span>
        </span>
      );
    },
  },
  {
    accessorKey: "type",
    header: "Type",
    cell: ({ row }) => (
      <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide whitespace-nowrap">
        {row.original.type.replace(/_/g, " ")}
      </span>
    ),
    size: 100,
  },
  {
    accessorKey: "status",
    header: "Status",
    cell: ({ row }) => (
      <span className="whitespace-nowrap">
        <StatusBadge status={row.original.status} size="sm" />
      </span>
    ),
    size: 90,
  },
  {
    accessorKey: "createdAt",
    header: "Created",
    cell: ({ row }) => (
      <span className="text-sm text-muted-foreground whitespace-nowrap">
        {relativeTime(row.original.createdAt)}
      </span>
    ),
    size: 120,
  },
];

function ArtifactsPage() {
  const { tenantId } = useTenant();
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useBreadcrumbs([{ label: "Artifacts" }]);

  const [result] = useQuery({
    query: ArtifactsListQuery,
    variables: { tenantId: tenantId!, limit: 200 },
    pause: !tenantId,
    requestPolicy: "cache-and-network",
  });

  const [detailResult] = useQuery({
    query: ArtifactDetailQuery,
    variables: { id: selectedId! },
    pause: !selectedId,
    requestPolicy: "cache-and-network",
  });

  const rows = useMemo<ArtifactRow[]>(() => {
    const items = (result.data as any)?.artifacts ?? [];
    return items
      .map((a: any) => ({
        id: a.id,
        title: a.title,
        type: a.type,
        status: a.status,
        summary: a.summary,
        agentId: a.agentId,
        threadId: a.threadId,
        createdAt: a.createdAt,
        updatedAt: a.updatedAt,
      }))
      .filter(
        (a: ArtifactRow) =>
          !search ||
          a.title.toLowerCase().includes(search.toLowerCase()) ||
          a.summary?.toLowerCase().includes(search.toLowerCase()),
      );
  }, [result.data, search]);

  const detail = (detailResult.data as any)?.artifact ?? null;

  if (result.fetching && !result.data) return <PageSkeleton />;

  return (
    <PageLayout
      header={
        <PageHeader title="Artifacts">
          <div className="flex items-center gap-2">
            <FilterBarSearch
              value={search}
              onChange={setSearch}
              placeholder="Search artifacts..."
            />
          </div>
        </PageHeader>
      }
    >
      {rows.length === 0 && !search ? (
        <EmptyState
          icon={FileText}
          title="No artifacts yet"
          description="Artifacts are created by agents when they produce reports, plans, digests, and other structured output."
        />
      ) : (
        <DataTable
          columns={columns}
          data={rows}
          pageSize={10}
          onRowClick={(row) => setSelectedId(row.id)}
        />
      )}

      <ArtifactViewDialog
        open={!!selectedId}
        onOpenChange={(open) => !open && setSelectedId(null)}
        artifact={detail}
      />
    </PageLayout>
  );
}
