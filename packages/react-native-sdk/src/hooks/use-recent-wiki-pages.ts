import { useQuery } from "urql";
import { RecentWikiPagesQuery } from "../graphql/queries";
import type { WikiPageType, WikiSearchHit } from "../types";

interface UseRecentWikiPagesArgs {
  agentId: string | null | undefined;
  limit?: number;
}

type ServerPage = {
  id: string;
  type: WikiPageType;
  slug: string;
  title: string;
  summary: string | null;
  lastCompiledAt: string | null;
  updatedAt: string;
};

type ServerResponse = {
  recentWikiPages: ServerPage[] | null;
};

/**
 * Newest compiled wiki pages for a given agent. Intended as the
 * Memories-tab's default feed so the user sees fresh pages before
 * they search. Paused until agentId is present.
 */
export function useRecentWikiPages({ agentId, limit }: UseRecentWikiPagesArgs) {
  const [{ data, fetching, error }, refetch] = useQuery<ServerResponse>({
    query: RecentWikiPagesQuery,
    variables: { agentId, limit },
    pause: !agentId,
    requestPolicy: "cache-and-network",
  });

  const pages = data?.recentWikiPages ?? [];
  const results: WikiSearchHit[] = pages.map((p) => ({
    id: p.id,
    type: p.type,
    slug: p.slug,
    title: p.title,
    summary: p.summary,
    lastCompiledAt: p.lastCompiledAt,
    score: 0,
    matchedAlias: null,
    matchingMemoryIds: [],
  }));

  return {
    results,
    loading: fetching,
    error,
    refetch: () => refetch({ requestPolicy: "network-only" }),
  };
}
