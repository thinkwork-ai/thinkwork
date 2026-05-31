import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { type ColumnDef } from "@tanstack/react-table";
import { Loader2, Search, Trash2 } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { toast } from "sonner";
import { useMutation, useQuery } from "urql";
import { Badge, Button, DataTable, Input } from "@thinkwork/ui";
import {
  DeleteThreadMutation,
  SpaceThreadsQuery,
  ThreadsPagedQuery,
} from "@/lib/graphql-queries";
import {
  type ChatThreadSummary,
  formatRelativeDate,
  threadTitle,
} from "@/components/shell/chat-sidebar-types";
import { useTenant } from "@/context/TenantContext";
import { usePageHeaderActions } from "@/context/PageHeaderContext";
import { PageSkeleton } from "@/components/PageSkeleton";

interface ThreadListSearch {
  spaceId?: string;
  spaceName?: string;
}

export const Route = createFileRoute("/_authed/_shell/threads/")({
  validateSearch: (search: Record<string, unknown>): ThreadListSearch => ({
    spaceId: typeof search.spaceId === "string" ? search.spaceId : undefined,
    spaceName:
      typeof search.spaceName === "string" ? search.spaceName : undefined,
  }),
  component: ThreadListPage,
});

const PAGE_SIZE = 25;
const COMPACT_TABLE_CELL = "flex h-10 min-w-0 items-center px-2";

interface ThreadsPagedResult {
  threadsPaged?: {
    totalCount?: number | null;
    items?: ChatThreadSummary[] | null;
  } | null;
}

function statusTone(status?: string | null): string {
  const value = (status ?? "").toLowerCase();
  if (["running", "queued", "in_progress"].includes(value)) {
    return "bg-blue-500/15 text-blue-600 dark:text-blue-400";
  }
  if (["failed", "error"].includes(value)) {
    return "bg-destructive/15 text-destructive";
  }
  if (["completed", "succeeded", "done"].includes(value)) {
    return "bg-green-500/15 text-green-600 dark:text-green-400";
  }
  return "bg-muted text-muted-foreground";
}

function threadIdentifier(thread: ChatThreadSummary): string {
  return (
    thread.identifier ?? (thread.number != null ? `#${thread.number}` : "")
  );
}

function threadColumns(
  deletingId: string | null,
  onDelete: (thread: ChatThreadSummary) => void,
  includeSpace: boolean,
): ColumnDef<ChatThreadSummary>[] {
  return [
    {
      // No explicit size → flexes to fill remaining width under table-fixed; the
      // truncate keeps long titles on one line instead of forcing a scrollbar.
      accessorKey: "title",
      header: "Title",
      cell: ({ row }) => (
        <span className={`${COMPACT_TABLE_CELL} font-medium`}>
          <span className="truncate">{threadTitle(row.original)}</span>
        </span>
      ),
    },
    {
      accessorKey: "identifier",
      header: "ID",
      size: 110,
      cell: ({ row }) => (
        <span
          className={`${COMPACT_TABLE_CELL} text-xs text-muted-foreground tabular-nums`}
        >
          <span className="truncate">
            {threadIdentifier(row.original) || "—"}
          </span>
        </span>
      ),
    },
    // The Space column is redundant when the table is already scoped to one
    // space (opened from a Space section's Thread list menu item).
    ...(includeSpace
      ? [
          {
            id: "space",
            header: "Space",
            size: 150,
            cell: ({ row }) => (
              <span
                className={`${COMPACT_TABLE_CELL} text-xs text-muted-foreground`}
              >
                <span className="truncate">
                  {row.original.space?.name ?? "—"}
                </span>
              </span>
            ),
          } as ColumnDef<ChatThreadSummary>,
        ]
      : []),
    {
      accessorKey: "status",
      header: "Status",
      size: 130,
      cell: ({ row }) =>
        row.original.status ? (
          <span className={COMPACT_TABLE_CELL}>
            <Badge
              variant="secondary"
              className={`truncate text-xs ${statusTone(row.original.status)}`}
            >
              {row.original.status}
            </Badge>
          </span>
        ) : (
          <span
            className={`${COMPACT_TABLE_CELL} text-xs text-muted-foreground`}
          >
            —
          </span>
        ),
    },
    {
      accessorKey: "lastActivityAt",
      header: "Last activity",
      size: 120,
      cell: ({ row }) => (
        <span className={`${COMPACT_TABLE_CELL} text-xs text-muted-foreground`}>
          {formatRelativeDate(
            row.original.lastActivityAt ??
              row.original.lastTurnCompletedAt ??
              row.original.updatedAt,
          ) || "—"}
        </span>
      ),
    },
    {
      id: "actions",
      header: "",
      size: 52,
      cell: ({ row }) => {
        const isDeleting = deletingId === row.original.id;
        return (
          <span className={`${COMPACT_TABLE_CELL} justify-end`}>
            <Button
              variant="ghost"
              size="icon"
              aria-label={`Delete ${threadTitle(row.original)}`}
              className="h-8 w-8 text-muted-foreground hover:text-destructive"
              disabled={isDeleting}
              onClick={(event) => {
                event.stopPropagation();
                onDelete(row.original);
              }}
            >
              {isDeleting ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Trash2 className="h-4 w-4" />
              )}
            </Button>
          </span>
        );
      },
    },
  ];
}

function ThreadListPage() {
  const { tenantId } = useTenant();
  const navigate = useNavigate();
  const { spaceId, spaceName } = Route.useSearch();
  const [search, setSearch] = useState("");
  const [pageIndex, setPageIndex] = useState(0);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  usePageHeaderActions({
    title: spaceName ? `${spaceName} · Threads` : "Thread List",
  });

  // Scoped to a Space (opened from its section menu) → the space-scoped query,
  // matching the Space detail page. Otherwise the tenant-wide paged query.
  const [{ data, fetching, error }, reexecuteQuery] =
    useQuery<ThreadsPagedResult>({
      query: spaceId ? SpaceThreadsQuery : ThreadsPagedQuery,
      variables: spaceId
        ? {
            tenantId: tenantId ?? "",
            spaceId,
            search: search || undefined,
            limit: PAGE_SIZE,
            offset: pageIndex * PAGE_SIZE,
          }
        : {
            tenantId: tenantId ?? "",
            search: search || undefined,
            showArchived: false,
            sortField: "updated",
            sortDir: "desc",
            limit: PAGE_SIZE,
            offset: pageIndex * PAGE_SIZE,
          },
      pause: !tenantId,
      requestPolicy: "cache-and-network",
    });

  const [{ fetching: deleteFetching }, executeDelete] =
    useMutation(DeleteThreadMutation);

  const rows = useMemo(
    () => data?.threadsPaged?.items ?? [],
    [data?.threadsPaged?.items],
  );
  const totalCount = data?.threadsPaged?.totalCount ?? 0;

  const handleDelete = useCallback(
    async (thread: ChatThreadSummary) => {
      if (deleteFetching) return;
      const confirmed = window.confirm(
        `Delete "${threadTitle(thread)}"? This can't be undone.`,
      );
      if (!confirmed) return;
      setDeletingId(thread.id);
      const result = await executeDelete({ id: thread.id });
      setDeletingId(null);
      if (result.error) {
        toast.error(`Couldn't delete thread: ${result.error.message}`);
        return;
      }
      toast.success("Thread deleted");
      reexecuteQuery({ requestPolicy: "network-only" });
    },
    [deleteFetching, executeDelete, reexecuteQuery],
  );

  const columns = useMemo(
    () => threadColumns(deletingId, handleDelete, !spaceId),
    [deletingId, handleDelete, spaceId],
  );

  if (!tenantId || (fetching && !data)) {
    return <PageSkeleton />;
  }

  return (
    <main className="flex h-full w-full flex-col overflow-hidden bg-background">
      <div className="flex h-full min-h-0 flex-col gap-4 px-2 py-4 sm:px-4">
        <header className="flex shrink-0 flex-wrap items-center justify-between gap-3">
          <label className="relative w-full max-w-sm">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPageIndex(0);
              }}
              className="pl-9"
              placeholder="Search threads..."
              aria-label="Search threads"
            />
          </label>
          <span className="text-xs text-muted-foreground">
            {totalCount} thread{totalCount === 1 ? "" : "s"}
          </span>
        </header>
        {error ? (
          <p className="shrink-0 text-sm text-destructive">{error.message}</p>
        ) : null}

        {/* min-h-0 flex-1 constrains the table so its body scrolls and the
            pagination bar stays pinned/visible at the bottom (see SettingsSpaces). */}
        <div className="min-h-0 flex-1">
          <DataTable
            columns={columns}
            data={rows}
            scrollable
            allowHorizontalScroll={false}
            tableClassName="table-fixed"
            pageSize={PAGE_SIZE}
            totalCount={totalCount}
            pageIndex={pageIndex}
            onPageChange={setPageIndex}
            emptyState={
              search ? "No threads match your search." : "No threads yet."
            }
            onRowClick={(row) =>
              navigate({ to: "/threads/$id", params: { id: row.id } })
            }
          />
        </div>
      </div>
    </main>
  );
}
