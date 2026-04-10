import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { type ColumnDef } from "@tanstack/react-table";
import { useQuery } from "urql";
import { CheckCircle2, XCircle, Clock, Inbox, Search } from "lucide-react";
import { useState, useMemo } from "react";
import { useTenant } from "@/context/TenantContext";
import { useBreadcrumbs } from "@/context/BreadcrumbContext";
import { PageHeader } from "@/components/PageHeader";
import { PageLayout } from "@/components/PageLayout";
import { PageSkeleton } from "@/components/PageSkeleton";
import { EmptyState } from "@/components/EmptyState";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { DataTable } from "@/components/ui/data-table";

import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { InboxItemsListQuery } from "@/lib/graphql-queries";
import { typeLabel, typeIcon, defaultTypeIcon } from "@/components/inbox/InboxItemPayload";
import { relativeTime } from "@/lib/utils";

export const Route = createFileRoute("/_authed/_tenant/inbox/")({
  component: InboxPage,
});

type InboxItemRow = {
  id: string;
  type: string;
  status: string;
  title: string;
  revision: number;
  requesterType: string | null;
  requesterId: string | null;
  createdAt: string;
};

function statusIcon(status: string) {
  const s = status.toLowerCase();
  if (s === "approved") return <CheckCircle2 className="h-3.5 w-3.5 text-green-600 dark:text-green-400" />;
  if (s === "rejected") return <XCircle className="h-3.5 w-3.5 text-red-600 dark:text-red-400" />;
  if (s === "revision_requested") return <Clock className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400" />;
  if (s === "pending") return <Clock className="h-3.5 w-3.5 text-yellow-600 dark:text-yellow-400" />;
  return null;
}

function statusLabel(status: string) {
  return status.toLowerCase().replace(/_/g, " ");
}

function InboxPage() {
  const { tenantId } = useTenant();
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const [tab, setTab] = useState("pending");
  useBreadcrumbs([{ label: "Inbox" }]);

  const [result] = useQuery({
    query: InboxItemsListQuery,
    variables: { tenantId: tenantId! },
    pause: !tenantId,
    requestPolicy: "cache-and-network",
  });

  const inboxItems = result.data?.inboxItems ?? [];

  const rows: InboxItemRow[] = useMemo(
    () =>
      inboxItems.map((a) => ({
        id: a.id,
        type: a.type,
        status: a.status,
        title: a.title || typeLabel[a.type] || a.type.replace(/_/g, " "),
        revision: a.revision,
        requesterType: a.requesterType ?? null,
        requesterId: a.requesterId ?? null,
        createdAt: a.createdAt,
      })),
    [inboxItems],
  );

  const pending = useMemo(
    () => rows.filter((r) => r.status === "PENDING" || r.status === "REVISION_REQUESTED"),
    [rows],
  );
  const resolved = useMemo(
    () => rows.filter((r) => r.status !== "PENDING" && r.status !== "REVISION_REQUESTED"),
    [rows],
  );

  if (!tenantId || (result.fetching && !result.data)) return <PageSkeleton />;

  const columns: ColumnDef<InboxItemRow>[] = [
    {
      accessorKey: "title",
      header: "Request",
      cell: ({ row }) => {
        const Icon = typeIcon[row.original.type] ?? defaultTypeIcon;
        return (
          <div className="flex items-center gap-2">
            <Icon className="h-4 w-4 text-muted-foreground shrink-0" />
            <span className="font-medium">{row.original.title}</span>
            {row.original.revision > 1 && (
              <span className="text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded-full">
                v{row.original.revision}
              </span>
            )}
          </div>
        );
      },
    },
    {
      accessorKey: "type",
      header: "Type",
      cell: ({ row }) => (
        <Badge variant="outline" className="text-xs capitalize">
          {typeLabel[row.original.type] ?? row.original.type.replace(/_/g, " ")}
        </Badge>
      ),
      size: 140,
    },
    {
      accessorKey: "status",
      header: "Status",
      cell: ({ row }) => (
        <div className="flex items-center gap-1.5">
          {statusIcon(row.original.status)}
          <span className="text-xs capitalize">{statusLabel(row.original.status)}</span>
        </div>
      ),
      size: 140,
    },
    {
      accessorKey: "createdAt",
      header: "Requested",
      cell: ({ row }) => (
        <span className="text-xs text-muted-foreground">
          {relativeTime(row.original.createdAt)}
        </span>
      ),
      size: 120,
    },
  ];

  return (
    <PageLayout
      header={
        <PageHeader
          title="Inbox"
          description={`${pending.length} pending, ${resolved.length} resolved`}
        />
      }
    >
      {rows.length === 0 ? (
        <EmptyState
          icon={Inbox}
          title="Inbox empty"
          description="Approval requests and notifications will appear here."
        />
      ) : (
        <div>
          <div className="flex items-center gap-2 mb-2">
            <div className="relative flex-1 max-w-sm">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search inbox..."
                className="pl-9"
              />
            </div>
            <ToggleGroup type="single" value={tab} onValueChange={(v) => v && setTab(v)} variant="outline">
              <ToggleGroupItem value="pending" className="px-4">
                Pending
                {pending.length > 0 && (
                  <Badge variant="secondary" className="ml-1.5 h-5 min-w-5 px-1.5 text-[10px] font-medium tabular-nums bg-yellow-500/20 text-yellow-500">
                    {pending.length}
                  </Badge>
                )}
              </ToggleGroupItem>
              <ToggleGroupItem value="resolved" className="px-4">
                Resolved
                {resolved.length > 0 && (
                  <Badge variant="secondary" className="ml-1.5 h-5 min-w-5 px-1.5 text-[10px] font-medium tabular-nums">
                    {resolved.length}
                  </Badge>
                )}
              </ToggleGroupItem>
            </ToggleGroup>
          </div>

          {tab === "pending" ? (
            pending.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4">No pending items.</p>
            ) : (
              <DataTable
                columns={columns}
                data={pending}
                filterValue={search}
                filterColumn="title"
                scrollable
                onRowClick={(row) => navigate({ to: "/inbox/$inboxItemId", params: { inboxItemId: row.id } })}
              />
            )
          ) : (
            resolved.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4">No resolved items.</p>
            ) : (
              <DataTable
                columns={columns}
                data={resolved}
                filterValue={search}
                scrollable
                filterColumn="title"
                onRowClick={(row) => navigate({ to: "/inbox/$inboxItemId", params: { inboxItemId: row.id } })}
              />
            )
          )}
        </div>
      )}
    </PageLayout>
  );
}
