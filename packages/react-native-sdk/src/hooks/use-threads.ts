import { useMemo } from "react";
import { useQuery } from "urql";
import { ThreadsQuery } from "../graphql/queries";
import type { Thread } from "../types";

export function useThreads({
  tenantId,
  agentId,
  limit,
}: {
  tenantId: string | null | undefined;
  agentId?: string | null;
  limit?: number;
}) {
  const [{ data, fetching, error }, refetch] = useQuery<{ threads: Thread[] }>({
    query: ThreadsQuery,
    variables: { tenantId, agentId: agentId ?? null, limit },
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
