/**
 * ThreadsTable — shared presentational component used by both the
 * `/threads` route (tenant scope) and the Computer Detail Dashboard tab
 * (computer scope). Renders one `<DataTable>` with the thread row
 * column definition, status icon, identifier, title, runtime, model, user
 * attribution, last-activity timestamp, and inbox indicator.
 *
 * Plan: docs/plans/2026-05-13-005-refactor-computer-detail-cleanup-and-
 *       shared-threads-table-plan.md (U5).
 *
 * Data + handlers come in as props; the parent owns the GraphQL query,
 * pagination state, sort state, and the underlying mutation. The
 * `scope` exists as a single explicit toggle for future divergence —
 * v1 keeps the column set identical between scopes per user direction
 * ("EXACT same datatable that the Threads page uses, just filtered by
 * the Computer").
 */

import { useMemo } from "react";
import { type ColumnDef } from "@tanstack/react-table";
import { Lock } from "lucide-react";
import { DataTable } from "@/components/ui/data-table";
import { Badge } from "@/components/ui/badge";
import { StatusIcon } from "@/components/threads/StatusIcon";
import { relativeTime } from "@/lib/utils";

export type ThreadsTableItem = {
  readonly id: string;
  readonly number: number;
  readonly identifier?: string | null;
  readonly title: string;
  readonly status: string;
  readonly agentId?: string | null;
  readonly computerId?: string | null;
  readonly userId?: string | null;
  readonly agent?: {
    readonly id: string;
    readonly name: string;
    readonly avatarUrl?: string | null;
  } | null;
  readonly computer?: {
    readonly id: string;
    readonly name: string;
    readonly slug?: string | null;
  } | null;
  readonly user?: {
    readonly id: string;
    readonly name?: string | null;
    readonly email?: string | null;
    readonly image?: string | null;
  } | null;
  readonly assigneeType?: string | null;
  readonly assigneeId?: string | null;
  readonly checkoutRunId?: string | null;
  readonly lastActivityAt?: unknown;
  readonly lastTurnCompletedAt?: unknown;
  readonly lastRuntimeType?: string | null;
  readonly lastModel?: string | null;
  readonly lastReadAt?: unknown;
  readonly archivedAt?: unknown;
  readonly createdAt: unknown;
  readonly updatedAt: unknown;
};

export type ThreadsTableAgent = {
  readonly id: string;
  readonly name: string;
  readonly avatarUrl?: string | null;
};

export type ThreadInboxStatus = "running" | "unread" | "read";

export interface ThreadsTableProps {
  items: readonly ThreadsTableItem[];
  agents: readonly ThreadsTableAgent[];
  /**
   * Resolves the inbox indicator (running / unread / read) for a row.
   * Lifted to a prop so the parent can plug in its active-turns store
   * without ThreadsTable needing to know that store exists.
   */
  inboxStatusFor: (thread: ThreadsTableItem) => ThreadInboxStatus;
  onUpdateThread: (id: string, data: Record<string, unknown>) => void;
  onRowClick: (threadId: string) => void;
  /**
   * Optional pagination controls. Omit for grouped sub-tables that page
   * at the parent level.
   */
  pagination?: {
    totalCount: number;
    pageSize: number;
    pageIndex: number;
    onPageChange: (i: number) => void;
  };
  /** Pass-through `DataTable` chrome flags. */
  hideHeader?: boolean;
  scrollable?: boolean;
  /**
   * Future divergence point. v1 keeps column set identical — see
   * component-doc rationale.
   */
  scope?: "tenant" | "computer";
}

export function ThreadsTable({
  items,
  inboxStatusFor,
  onUpdateThread,
  onRowClick,
  pagination,
  hideHeader = false,
  scrollable = false,
  scope: _scope = "tenant",
}: ThreadsTableProps) {
  // Memoize the column definition — closure deps are the popover-state setters
  // (stable via useState) plus the prop callbacks. Without this, every parent
  // render rebuilds the entire column array on the highest-traffic admin page.
  // Matches the useMemo pattern the /threads route used pre-refactor.
  const columns: ColumnDef<ThreadsTableItem>[] = useMemo(
    () => [
      {
        id: "thread",
        header: "Thread",
        size: 620,
        cell: ({ row }) => {
          const thread = row.original;
          const identifier = thread.identifier ?? `#${thread.number}`;
          return (
            <div className="flex h-10 min-w-0 items-center gap-2 overflow-hidden pl-3 pr-3 text-sm sm:gap-3">
              <span className="flex shrink-0 items-center gap-2">
                <span
                  className="shrink-0"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                  }}
                >
                  <StatusIcon
                    status={thread.status}
                    onChange={(s) => onUpdateThread(thread.id, { status: s })}
                  />
                </span>
                <span className="shrink-0 font-mono text-xs text-muted-foreground">
                  {identifier}
                </span>
                {thread.checkoutRunId && (
                  <Lock className="h-3 w-3 text-yellow-500 shrink-0" />
                )}
              </span>

              <span className="min-w-0 flex-1 truncate">{thread.title}</span>
            </div>
          );
        },
      },
      {
        id: "runtime",
        header: "Runtime",
        size: 110,
        cell: ({ row }) => {
          const runtimeType = row.original.lastRuntimeType;
          return (
            <div className="flex h-10 items-center px-2">
              {runtimeType ? (
                <Badge
                  variant="secondary"
                  className="max-w-full truncate text-xs font-normal"
                  title={`Runtime: ${formatRuntimeType(runtimeType)}`}
                >
                  {formatRuntimeType(runtimeType)}
                </Badge>
              ) : (
                <span className="text-xs text-muted-foreground">—</span>
              )}
            </div>
          );
        },
      },
      {
        id: "model",
        header: "Model",
        size: 190,
        cell: ({ row }) => {
          const model = row.original.lastModel;
          return (
            <div className="flex h-10 items-center px-2">
              {model ? (
                <Badge
                  variant="outline"
                  className="max-w-full truncate text-xs font-normal"
                  title={`Model: ${model}`}
                >
                  {formatModelId(model)}
                </Badge>
              ) : (
                <span className="text-xs text-muted-foreground">—</span>
              )}
            </div>
          );
        },
      },
      {
        id: "user",
        header: "User",
        size: 150,
        cell: ({ row }) => {
          const label = threadUserLabel(row.original);
          return (
            <div
              className="h-10 truncate px-2 text-sm leading-10 text-muted-foreground"
              title={label}
            >
              {row.original.userId || row.original.user ? label : "—"}
            </div>
          );
        },
      },
      {
        id: "lastActivity",
        header: "Last Activity",
        size: 105,
        cell: ({ row }) => (
          <div className="h-10 truncate px-2 text-right text-sm leading-10 text-muted-foreground">
            {formatThreadActivityTime(
              row.original.lastActivityAt,
              row.original.updatedAt,
            )}
          </div>
        ),
      },
      {
        id: "inbox",
        header: "",
        size: 34,
        cell: ({ row }) => (
          <div className="flex h-10 items-center justify-center">
            <InboxIndicator status={inboxStatusFor(row.original)} />
          </div>
        ),
      },
    ],
    [inboxStatusFor, onUpdateThread],
  );

  return (
    <DataTable
      columns={columns}
      data={items as ThreadsTableItem[]}
      hideHeader={hideHeader}
      scrollable={scrollable}
      tableClassName="table-fixed"
      {...(pagination
        ? {
            pageSize: pagination.pageSize,
            totalCount: pagination.totalCount,
            pageIndex: pagination.pageIndex,
            onPageChange: pagination.onPageChange,
          }
        : {})}
      onRowClick={(thread: ThreadsTableItem) => onRowClick(thread.id)}
    />
  );
}

function InboxIndicator({ status }: { status: ThreadInboxStatus }) {
  if (status === "read") return null;
  if (status === "running") {
    return (
      <span
        className="relative flex h-2.5 w-2.5 shrink-0"
        title="Worker running"
      >
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-cyan-400 opacity-75" />
        <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-cyan-500" />
      </span>
    );
  }
  return (
    <span
      className="flex h-2.5 w-2.5 shrink-0 rounded-full bg-primary"
      title="New response"
    />
  );
}

/**
 * Inbox-status helper used by both ThreadsTable consumers. Exported so
 * the parent route can build its `inboxStatusFor` prop without
 * duplicating the running/unread/read decision.
 */
export function computeThreadInboxStatus(
  threadId: string,
  lastTurnCompletedAt: unknown,
  lastReadAt: unknown,
  activeThreadIds: Set<string>,
): ThreadInboxStatus {
  if (activeThreadIds.has(threadId)) return "running";
  if (!lastTurnCompletedAt) return "read";
  if (!lastReadAt) return "unread";
  return new Date(lastTurnCompletedAt as string).getTime() >
    new Date(lastReadAt as string).getTime()
    ? "unread"
    : "read";
}

export function threadComputerLabel(thread: ThreadsTableItem): string {
  return (
    thread.computer?.name ||
    (thread.computerId ? "Unknown Computer" : "Computer")
  );
}

export function threadUserLabel(thread: ThreadsTableItem): string {
  return (
    thread.user?.name ||
    thread.user?.email ||
    (thread.userId ? "Unknown User" : "Unknown User")
  );
}

function formatThreadActivityTime(primary: unknown, fallback: unknown): string {
  const value = primary || fallback;
  if (typeof value === "string" || value instanceof Date) {
    return relativeTime(value);
  }
  return "—";
}

export function formatRuntimeType(runtimeType: string): string {
  const normalized = runtimeType.trim().toLowerCase();
  if (normalized === "pi") return "Pi";
  if (normalized === "strands") return "Strands";
  return runtimeType.trim();
}

export function formatModelId(modelId: string): string {
  const trimmed = modelId.trim();
  const afterSlash = trimmed.includes("/")
    ? trimmed.split("/").pop()!
    : trimmed;
  return afterSlash
    .replace(/^us\.anthropic\./, "")
    .replace(/-\d{8,}/, "")
    .replace(/-v\d+:\d+$/, "");
}
