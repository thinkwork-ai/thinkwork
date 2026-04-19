import { useQuery } from "urql";
import { MobileMemorySearchQuery } from "../graphql/queries";
import type { WikiPageType, WikiSearchHit } from "../types";

interface UseMobileMemorySearchArgs {
  agentId: string | null | undefined;
  query: string;
  limit?: number;
}

type ServerHit = {
  score: number;
  matchingMemoryIds: string[] | null;
  page: {
    id: string;
    type: WikiPageType;
    slug: string;
    title: string;
    summary: string | null;
    lastCompiledAt: string | null;
  };
};

type ServerResponse = {
  mobileWikiSearch: ServerHit[] | null;
};

/**
 * Searches the agent's memory bank via Hindsight recall and returns
 * compiled wiki pages ranked by the aggregate recall score of their
 * source memory units. One GraphQL round-trip — server handles recall,
 * dedup, and scoring. Paused until agentId + non-empty query are set.
 */
export function useMobileMemorySearch({ agentId, query, limit }: UseMobileMemorySearchArgs) {
  const trimmed = (query || "").trim();
  const [{ data, fetching, error }, refetch] = useQuery<ServerResponse>({
    query: MobileMemorySearchQuery,
    variables: { agentId, query: trimmed, limit },
    pause: !agentId || trimmed.length === 0,
    requestPolicy: "cache-and-network",
  });

  const hits = data?.mobileWikiSearch ?? [];
  const results: WikiSearchHit[] = hits.map((h) => ({
    id: h.page.id,
    type: h.page.type,
    slug: h.page.slug,
    title: h.page.title,
    summary: h.page.summary,
    lastCompiledAt: h.page.lastCompiledAt,
    score: h.score,
    matchedAlias: null,
    matchingMemoryIds: h.matchingMemoryIds ?? [],
  }));

  return {
    results,
    loading: fetching,
    error,
    refetch: () => refetch({ requestPolicy: "network-only" }),
  };
}
