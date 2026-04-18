import { useMemo } from "react";
import { useQuery } from "urql";
import { ThreadsQuery } from "../graphql/queries";
import type { Thread } from "../types";

export interface UseThreadsArgs {
  tenantId: string | null | undefined;
  agentId?: string | null;
  /** Filter to threads assigned to a specific user/agent. */
  assigneeId?: string | null;
  /** `ThreadStatus` enum value (e.g. "IN_PROGRESS"). */
  status?: string | null;
  /** `ThreadPriority` enum value (e.g. "HIGH"). */
  priority?: string | null;
  /** `ThreadType` enum value (e.g. "TASK"). */
  type?: string | null;
  /** `ThreadChannel` enum value (e.g. "CHAT"). */
  channel?: string | null;
  /** Full-text search across thread title + description. */
  search?: string | null;
  limit?: number;
  /** Opaque cursor from a previous page (lexicographic `id` cursor). */
  cursor?: string | null;
}

export function useThreads({
  tenantId,
  agentId,
  assigneeId,
  status,
  priority,
  type,
  channel,
  search,
  limit,
  cursor,
}: UseThreadsArgs) {
  const [{ data, fetching, error }, refetch] = useQuery<{ threads: Thread[] }>({
    query: ThreadsQuery,
    variables: {
      tenantId,
      agentId: agentId ?? null,
      assigneeId: assigneeId ?? null,
      status: status ?? null,
      priority: priority ?? null,
      type: type ?? null,
      channel: channel ?? null,
      search: search ?? null,
      limit,
      cursor: cursor ?? null,
    },
    pause: !tenantId,
    requestPolicy: "cache-and-network",
    // Keeps the list in sync when any Thread mutation (createThread,
    // updateThread, archive, mark-read) runs through the same urql client.
    context: useMemo(() => ({ additionalTypenames: ["Thread"] }), []),
  });

  const threads = useMemo(() => data?.threads ?? [], [data]);

  return {
    threads,
    loading: fetching,
    error,
    refetch: () => refetch({ requestPolicy: "network-only" }),
  };
}
