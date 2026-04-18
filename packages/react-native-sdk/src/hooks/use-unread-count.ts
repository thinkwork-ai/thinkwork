import { useMemo } from "react";
import { useQuery } from "urql";
import { UnreadThreadCountQuery } from "../graphql/queries";

export function useUnreadThreadCount({
  tenantId,
  agentId,
}: {
  tenantId: string | null | undefined;
  agentId?: string | null;
}) {
  const [{ data, fetching, error }] = useQuery<{ unreadThreadCount: number }>({
    query: UnreadThreadCountQuery,
    variables: { tenantId, agentId: agentId ?? null },
    pause: !tenantId,
    requestPolicy: "cache-and-network",
    // Tied to the same Thread typename as `useThreads`, so mark-read /
    // archive / new-thread mutations re-drive the count without manual
    // refetch plumbing.
    context: useMemo(() => ({ additionalTypenames: ["Thread"] }), []),
  });

  return {
    count: data?.unreadThreadCount ?? 0,
    loading: fetching,
    error,
  };
}
