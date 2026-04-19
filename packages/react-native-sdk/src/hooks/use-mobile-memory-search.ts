import { useQuery } from "urql";
import { MobileMemorySearchQuery } from "../graphql/queries";
import type { WikiPageType, WikiSearchHit } from "../types";

interface UseMobileMemorySearchArgs {
  tenantId: string | null | undefined;
  ownerId: string | null | undefined;
  query: string;
  limit?: number;
}

type ServerHit = {
  score: number;
  matchedAlias: string | null;
  page: {
    id: string;
    type: WikiPageType;
    slug: string;
    title: string;
    summary: string | null;
    status: string;
    lastCompiledAt: string | null;
    updatedAt: string;
  };
};

type ServerResponse = {
  wikiSearch: ServerHit[] | null;
};

/**
 * Searches compiled wiki pages (Entity / Topic / Decision) scoped to
 * (tenantId, ownerId). Paused until both ids and a non-empty query are
 * present. Results are returned in rank order (alias hits boosted).
 */
export function useMobileMemorySearch({
  tenantId,
  ownerId,
  query,
  limit,
}: UseMobileMemorySearchArgs) {
  const trimmed = (query || "").trim();
  const [{ data, fetching, error }, refetch] = useQuery<ServerResponse>({
    query: MobileMemorySearchQuery,
    variables: { tenantId, ownerId, query: trimmed, limit },
    pause: !tenantId || !ownerId || trimmed.length === 0,
    requestPolicy: "cache-and-network",
  });

  const hits = data?.wikiSearch ?? [];
  const results: WikiSearchHit[] = hits.map((h) => ({
    id: h.page.id,
    type: h.page.type,
    slug: h.page.slug,
    title: h.page.title,
    summary: h.page.summary,
    lastCompiledAt: h.page.lastCompiledAt,
    score: h.score,
    matchedAlias: h.matchedAlias,
  }));

  return {
    results,
    loading: fetching,
    error,
    refetch: () => refetch({ requestPolicy: "network-only" }),
  };
}
