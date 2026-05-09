import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { type ColumnDef } from "@tanstack/react-table";
import { AppWindow, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { useQuery } from "urql";
import { useTenant } from "@/context/TenantContext";
import { useBreadcrumbs } from "@/context/BreadcrumbContext";
import { PageHeader } from "@/components/PageHeader";
import { PageLayout } from "@/components/PageLayout";
import { EmptyState } from "@/components/EmptyState";
import { PageSkeleton } from "@/components/PageSkeleton";
import { DataTable } from "@/components/ui/data-table";
import { Input } from "@/components/ui/input";
import { AdminAppletsQuery } from "@/lib/graphql-queries";
import { relativeTime } from "@/lib/utils";

export const Route = createFileRoute("/_authed/_tenant/applets/")({
  component: AppletsPage,
});

type AppletRow = {
  appId: string;
  name: string;
  version: number;
  threadId: string | null;
  agentId: string | null;
  prompt: string | null;
  generatedAt: string;
  stdlibVersionAtGeneration: string;
};

const columns: ColumnDef<AppletRow>[] = [
  {
    accessorKey: "name",
    header: "Applet",
    cell: ({ row }) => (
      <span className="flex min-w-0 items-center gap-2 font-medium">
        <AppWindow className="h-4 w-4 shrink-0 text-primary" />
        <span className="truncate max-w-[320px]">{row.original.name}</span>
      </span>
    ),
  },
  {
    accessorKey: "version",
    header: "Version",
    cell: ({ row }) => (
      <span className="text-sm text-muted-foreground tabular-nums">
        v{row.original.version}
      </span>
    ),
    size: 90,
  },
  {
    accessorKey: "threadId",
    header: "Thread",
    cell: ({ row }) => (
      <span className="block max-w-[220px] truncate text-sm text-muted-foreground">
        {row.original.threadId ?? "None"}
      </span>
    ),
  },
  {
    accessorKey: "generatedAt",
    header: "Generated",
    cell: ({ row }) => (
      <span className="whitespace-nowrap text-sm text-muted-foreground">
        {relativeTime(row.original.generatedAt)}
      </span>
    ),
    size: 120,
  },
];

function AppletsPage() {
  const { tenantId } = useTenant();
  const navigate = useNavigate();
  const [userFilter, setUserFilter] = useState("");
  const trimmedUserFilter = userFilter.trim();

  useBreadcrumbs([{ label: "Applets" }]);

  const [result] = useQuery({
    query: AdminAppletsQuery,
    variables: {
      tenantId: tenantId!,
      userId: trimmedUserFilter || null,
      limit: 50,
    },
    pause: !tenantId,
    requestPolicy: "cache-and-network",
  });

  const rows = useMemo<AppletRow[]>(() => {
    const nodes = result.data?.adminApplets.nodes ?? [];
    return nodes.map((applet) => ({
      appId: applet.appId,
      name: applet.name,
      version: applet.version,
      threadId: applet.threadId ?? applet.artifact.threadId ?? null,
      agentId: applet.artifact.agentId ?? null,
      prompt: applet.prompt ?? null,
      generatedAt: applet.generatedAt,
      stdlibVersionAtGeneration: applet.stdlibVersionAtGeneration,
    }));
  }, [result.data]);

  if (result.fetching && !result.data) return <PageSkeleton />;

  return (
    <PageLayout
      header={
        <PageHeader title="Applets">
          <div className="relative w-full max-w-sm">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={userFilter}
              onChange={(event) => setUserFilter(event.target.value)}
              placeholder="Filter by user ID"
              className="pl-8"
            />
          </div>
        </PageHeader>
      }
    >
      {rows.length === 0 ? (
        <EmptyState
          icon={AppWindow}
          title="No applets found"
          description="Applets created by Computer will appear here for read-only support inspection."
        />
      ) : (
        <DataTable
          columns={columns}
          data={rows}
          pageSize={10}
          onRowClick={(row) =>
            navigate({
              to: "/applets/$appId",
              params: { appId: row.appId },
            })
          }
        />
      )}
    </PageLayout>
  );
}
