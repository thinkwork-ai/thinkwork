import { useMemo } from "react";
import { useQuery } from "urql";
import { AgentsQuery } from "../graphql/queries";
import type { Agent } from "../types";

export function useAgents({ tenantId }: { tenantId: string | null | undefined }) {
  const [{ data, fetching, error }, refetch] = useQuery<{ agents: Agent[] }>({
    query: AgentsQuery,
    variables: { tenantId },
    pause: !tenantId,
    requestPolicy: "cache-and-network",
  });

  const agents = useMemo(() => data?.agents ?? [], [data]);

  return {
    agents,
    loading: fetching,
    error,
    refetch: () => refetch({ requestPolicy: "network-only" }),
  };
}
