/**
 * ThreadsTable — shared presentational component used by both the
 * `/threads` route (tenant scope) and the Computer Detail Dashboard tab
 * (computer scope). Renders one `<DataTable>` with the thread row
 * column definition, status icon, identifier, title, assignee picker
 * popover, last-activity timestamp, and inbox indicator.
 *
 * Plan: docs/plans/2026-05-13-005-refactor-computer-detail-cleanup-and-
 *       shared-threads-table-plan.md (U5).
 *
 * Data + handlers come in as props; the parent owns the GraphQL query,
 * pagination state, sort state, and the underlying mutation. The
 * popover state (`assigneePickerIssueId`, `assigneeSearch`) is internal
 * since it's UI-only and would just be noise in the parent.
 *
 * `scope` exists as a single explicit toggle for future divergence —
 * v1 keeps the column set identical between scopes per user direction
 * ("EXACT same datatable that the Threads page uses, just filtered by
 * the Computer").
 */

import { useCallback, useMemo, useState } from "react";
import { type ColumnDef } from "@tanstack/react-table";
import { Lock, User } from "lucide-react";
import { DataTable } from "@/components/ui/data-table";
import { Badge } from "@/components/ui/badge";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { StatusIcon } from "@/components/threads/StatusIcon";
import { cn, relativeTime } from "@/lib/utils";

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
  agents,
  inboxStatusFor,
  onUpdateThread,
  onRowClick,
  pagination,
  hideHeader = true,
  scrollable = false,
  scope: _scope = "tenant",
}: ThreadsTableProps) {
  const [assigneePickerIssueId, setAssigneePickerIssueId] = useState<
    string | null
  >(null);
  const [assigneeSearch, setAssigneeSearch] = useState("");

  const assignThread = useCallback(
    (threadId: string, agentId: string | null) => {
      // Mirror the original route's handler shape: when the picker emits
      // an agentId, the mutation sets assigneeType=AGENT (or clears both
      // when null). Computer-owned threads can't reach this path because
      // the picker isn't rendered for them.
      onUpdateThread(threadId, { agentId });
      setAssigneePickerIssueId(null);
      setAssigneeSearch("");
    },
    [onUpdateThread],
  );

  // Memoize the column definition — closure deps are the popover-state setters
  // (stable via useState) plus the prop callbacks. Without this, every parent
  // render rebuilds the entire column array on the highest-traffic admin page.
  // Matches the useMemo pattern the /threads route used pre-refactor.
  const columns: ColumnDef<ThreadsTableItem>[] = useMemo(
    () => [
      {
        id: "row",
        cell: ({ row }) => {
          const thread = row.original;
          const inboxStatus = inboxStatusFor(thread);
          const identifier = thread.identifier ?? `#${thread.number}`;
          return (
            <div className="flex h-10 items-center gap-2 overflow-hidden pl-3 pr-3 text-sm sm:gap-3">
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

              <span className="ml-auto hidden shrink-0 items-center sm:flex">
                {thread.computerId ? (
                  <span
                    className="flex w-[220px] shrink-0 flex-col items-end justify-center gap-0.5 px-2 py-1"
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                    }}
                  >
                    <Badge
                      variant="outline"
                      className="max-w-full truncate text-xs"
                      title={threadComputerLabel(thread)}
                    >
                      {threadComputerLabel(thread)}
                    </Badge>
                    <span
                      className="max-w-full truncate text-[11px] leading-none text-muted-foreground"
                      title={threadUserLabel(thread)}
                    >
                      {threadUserLabel(thread)}
                    </span>
                  </span>
                ) : (
                  <Popover
                    open={assigneePickerIssueId === thread.id}
                    onOpenChange={(open) => {
                      setAssigneePickerIssueId(open ? thread.id : null);
                      if (!open) setAssigneeSearch("");
                    }}
                  >
                    <PopoverTrigger asChild>
                      <button
                        className="flex w-[160px] shrink-0 items-center justify-center rounded-md px-2 py-1 transition-colors hover:bg-accent/50"
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                        }}
                      >
                        {thread.agent ? (
                          <Badge variant="outline" className="text-xs">
                            {thread.agent.name}
                          </Badge>
                        ) : (
                          <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                            <span className="inline-flex h-5 w-5 items-center justify-center rounded-full border border-dashed border-muted-foreground/35 bg-muted/30">
                              <User className="h-3 w-3" />
                            </span>
                            Assignee
                          </span>
                        )}
                      </button>
                    </PopoverTrigger>
                    <PopoverContent
                      className="w-56 p-1"
                      align="end"
                      onClick={(e) => e.stopPropagation()}
                      onPointerDownOutside={() => setAssigneeSearch("")}
                    >
                      <input
                        className="mb-1 w-full border-b border-border bg-transparent px-2 py-1.5 text-xs outline-none placeholder:text-muted-foreground/50"
                        placeholder="Search agents..."
                        value={assigneeSearch}
                        onChange={(e) => setAssigneeSearch(e.target.value)}
                        autoFocus
                      />
                      <div className="max-h-48 overflow-y-auto overscroll-contain">
                        <button
                          className={cn(
                            "flex w-full items-center gap-2 rounded px-2 py-1.5 text-xs hover:bg-accent/50",
                            !thread.agentId && "bg-accent",
                          )}
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            assignThread(thread.id, null);
                          }}
                        >
                          No assignee
                        </button>
                        {agents
                          .filter((agent) => {
                            if (!assigneeSearch.trim()) return true;
                            return agent.name
                              .toLowerCase()
                              .includes(assigneeSearch.toLowerCase());
                          })
                          .map((agent) => (
                            <button
                              key={agent.id}
                              className={cn(
                                "flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs hover:bg-accent/50",
                                thread.agentId === agent.id && "bg-accent",
                              )}
                              onClick={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                assignThread(thread.id, agent.id);
                              }}
                            >
                              <span>{agent.name}</span>
                            </button>
                          ))}
                      </div>
                    </PopoverContent>
                  </Popover>
                )}
                <span className="w-[70px] text-right text-xs text-muted-foreground">
                  {relativeTime(thread.lastActivityAt || thread.updatedAt)}
                </span>
                <span className="flex w-[20px] items-center justify-center">
                  <InboxIndicator status={inboxStatus} />
                </span>
              </span>
            </div>
          );
        },
      },
    ],
    [
      agents,
      assigneePickerIssueId,
      assigneeSearch,
      inboxStatusFor,
      onUpdateThread,
      assignThread,
    ],
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
