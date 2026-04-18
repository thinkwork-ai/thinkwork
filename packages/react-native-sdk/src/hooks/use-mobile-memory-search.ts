import { useQuery } from "urql";
import { MobileMemorySearchQuery } from "../graphql/queries";
import type { MobileMemoryCapture } from "../types";

interface UseMobileMemorySearchArgs {
  agentId: string | null | undefined;
  query: string;
  limit?: number;
}

/**
 * Hits the mobile memory search endpoint (Hindsight recall scoped to the
 * selected agent's bank). Paused when agentId or query is empty — so
 * rendering with an empty query stays cheap.
 */
export function useMobileMemorySearch({ agentId, query, limit }: UseMobileMemorySearchArgs) {
  const trimmed = (query || "").trim();
  const [{ data, fetching, error }, refetch] = useQuery<{
    mobileMemorySearch: MobileMemoryCapture[];
  }>({
    query: MobileMemorySearchQuery,
    variables: { agentId, query: trimmed, limit },
    pause: !agentId || trimmed.length === 0,
    requestPolicy: "cache-and-network",
  });

  return {
    results: data?.mobileMemorySearch ?? [],
    loading: fetching,
    error,
    refetch: () => refetch({ requestPolicy: "network-only" }),
  };
}
