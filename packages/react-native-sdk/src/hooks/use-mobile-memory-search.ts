import { useQuery } from "urql";
import { MobileMemorySearchQuery } from "../graphql/queries";
import type { MemorySearchHit, WikiPageRef } from "../types";

interface UseMobileMemorySearchArgs {
  agentId: string | null | undefined;
  query: string;
  limit?: number;
}

type ServerRecord = {
  memoryRecordId: string;
  content: { text: string | null } | null;
  createdAt: string | null;
  factType: string | null;
  score: number | null;
  wikiPages: WikiPageRef[] | null;
};

type ServerResponse = {
  memorySearch: {
    records: ServerRecord[];
    totalCount: number;
  } | null;
};

/**
 * Searches the active agent's memory bank via the canonical memorySearch
 * resolver. Each raw memory record carries any wiki pages it has been
 * compiled into (via wiki_section_sources); the UI prefers the wiki
 * page for display but falls back to raw content when nothing has been
 * compiled yet. Paused until agentId and a non-empty query are present.
 */
export function useMobileMemorySearch({ agentId, query, limit }: UseMobileMemorySearchArgs) {
  const trimmed = (query || "").trim();
  const [{ data, fetching, error }, refetch] = useQuery<ServerResponse>({
    query: MobileMemorySearchQuery,
    variables: { agentId, query: trimmed, limit },
    pause: !agentId || trimmed.length === 0,
    requestPolicy: "cache-and-network",
  });

  const records = data?.memorySearch?.records ?? [];
  const results: MemorySearchHit[] = records.map((r) => ({
    id: r.memoryRecordId,
    content: r.content?.text || "",
    factType: r.factType ?? null,
    createdAt: r.createdAt ?? null,
    score: r.score ?? null,
    wikiPages: r.wikiPages ?? [],
  }));

  return {
    results,
    loading: fetching,
    error,
    refetch: () => refetch({ requestPolicy: "network-only" }),
  };
}
