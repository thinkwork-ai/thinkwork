import { useQuery } from "urql";
import { MobileMemorySearchQuery } from "../graphql/queries";
import type { MobileCaptureFactType, MobileMemoryCapture } from "../types";

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
};

type ServerResponse = {
  memorySearch: {
    records: ServerRecord[];
    totalCount: number;
  } | null;
};

const FACT_TYPE_FROM_HINDSIGHT: Record<string, MobileCaptureFactType> = {
  world: "FACT",
  opinion: "PREFERENCE",
  experience: "EXPERIENCE",
  observation: "OBSERVATION",
};

/**
 * Searches the active agent's memory bank via the canonical memorySearch
 * resolver (same code path the admin UI uses). Paused when agentId or
 * query is empty. Results are mapped into MobileMemoryCapture so the
 * mobile list can render them with the existing row component.
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
  const results: MobileMemoryCapture[] = records.map((r) => ({
    id: r.memoryRecordId,
    tenantId: "",
    agentId: agentId || "",
    content: r.content?.text || "",
    factType:
      (r.factType && FACT_TYPE_FROM_HINDSIGHT[r.factType]) || "FACT",
    capturedAt: r.createdAt || new Date().toISOString(),
    syncedAt: r.createdAt ?? null,
    metadata: null,
  }));

  return {
    results,
    loading: fetching,
    error,
    refetch: () => refetch({ requestPolicy: "network-only" }),
  };
}
