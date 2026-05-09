import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useQuery, useSubscription } from "urql";
import {
  TaskDashboard,
  type TaskSummary,
} from "@/components/computer/TaskDashboard";
import { useTenant } from "@/context/TenantContext";
import {
  ThreadTurnUpdatedSubscription,
  ThreadUpdatedSubscription,
  ThreadsPagedQuery,
} from "@/lib/graphql-queries";

export const Route = createFileRoute("/_authed/_shell/computer")({
  component: ComputerPage,
});

interface ThreadsPagedResult {
  threadsPaged: {
    totalCount: number;
    items: Array<{
      id: string;
      number: number;
      identifier?: string | null;
      title?: string | null;
      status?: string | null;
      assigneeType?: string | null;
      assigneeId?: string | null;
      agentId?: string | null;
      computerId?: string | null;
      agent?: {
        id: string;
        name: string;
        avatarUrl?: string | null;
      } | null;
      checkoutRunId?: string | null;
      channel?: string | null;
      costSummary?: number | null;
      lastActivityAt?: string | null;
      lastTurnCompletedAt?: string | null;
      lastReadAt?: string | null;
      archivedAt?: string | null;
      createdAt?: string | null;
      updatedAt?: string | null;
    }>;
  };
}

const DEFAULT_PAGE_SIZE = 50;

function ComputerPage() {
  const { tenantId } = useTenant();
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [pageIndex, setPageIndex] = useState(0);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setDebouncedSearch(search);
      setPageIndex(0);
    }, 250);
    return () => window.clearTimeout(timeout);
  }, [search]);

  const [{ data, fetching, error }, reexecuteQuery] = useQuery<ThreadsPagedResult>({
    query: ThreadsPagedQuery,
    variables: {
      tenantId: tenantId ?? "",
      search: debouncedSearch.trim() || undefined,
      showArchived: false,
      sortField: "updated",
      sortDir: "desc",
      limit: pageSize,
      offset: pageIndex * pageSize,
    },
    pause: !tenantId,
    requestPolicy: "cache-and-network",
  });

  const [{ data: threadUpdate }] = useSubscription<{
    onThreadUpdated?: { tenantId?: string | null } | null;
  }>({
    query: ThreadUpdatedSubscription,
    variables: { tenantId },
    pause: !tenantId,
  });

  const [{ data: turnUpdate }] = useSubscription<{
    onThreadTurnUpdated?: { tenantId?: string | null } | null;
  }>({
    query: ThreadTurnUpdatedSubscription,
    variables: { tenantId },
    pause: !tenantId,
  });

  useEffect(() => {
    if (threadUpdate?.onThreadUpdated?.tenantId === tenantId) {
      reexecuteQuery({ requestPolicy: "network-only" });
    }
  }, [reexecuteQuery, tenantId, threadUpdate?.onThreadUpdated?.tenantId]);

  useEffect(() => {
    if (turnUpdate?.onThreadTurnUpdated?.tenantId === tenantId) {
      reexecuteQuery({ requestPolicy: "network-only" });
    }
  }, [reexecuteQuery, tenantId, turnUpdate?.onThreadTurnUpdated?.tenantId]);

  return (
    <TaskDashboard
      threads={(data?.threadsPaged.items ?? []).map(toThreadSummary)}
      totalCount={data?.threadsPaged.totalCount ?? 0}
      pageIndex={pageIndex}
      pageSize={pageSize}
      search={search}
      isLoading={fetching && !data}
      error={error?.message ?? null}
      onPageChange={setPageIndex}
      onPageSizeChange={(nextPageSize) => {
        setPageSize(nextPageSize);
        setPageIndex(0);
      }}
      onSearchChange={setSearch}
    />
  );
}

function toThreadSummary(
  thread: ThreadsPagedResult["threadsPaged"]["items"][number],
): TaskSummary {
  return {
    id: thread.id,
    number: thread.number,
    identifier: thread.identifier,
    title: thread.title,
    status: thread.status,
    assigneeType: thread.assigneeType,
    assigneeId: thread.assigneeId,
    agentId: thread.agentId,
    computerId: thread.computerId,
    agent: thread.agent,
    checkoutRunId: thread.checkoutRunId,
    channel: thread.channel,
    costSummary: thread.costSummary,
    lastActivityAt: thread.lastActivityAt,
    lastTurnCompletedAt: thread.lastTurnCompletedAt,
    lastReadAt: thread.lastReadAt,
    archivedAt: thread.archivedAt,
    createdAt: thread.createdAt,
    updatedAt: thread.updatedAt,
  };
}
