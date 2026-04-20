import { useQuery } from "urql";
import { WikiSubgraphQuery } from "../graphql/queries";
import type { WikiPageType } from "../types";

export interface WikiSubgraphPage {
  id: string;
  type: WikiPageType;
  slug: string;
  title: string;
  summary: string | null;
  status: string;
  lastCompiledAt: string | null;
  updatedAt: string;
}

export interface WikiSubgraphLink {
  id: string;
  fromPageId: string;
  toPageId: string;
  kind: string;
  context: string | null;
  firstSeenAt: string | null;
  lastSeenAt: string | null;
  isCurrent: boolean | null;
  weight: number | null;
}

export interface WikiSubgraphHasMoreEntry {
  pageId: string;
  hasMore: boolean;
}

export interface WikiSubgraphPayload {
  focalPageId: string;
  depth: number;
  atTime: string;
  truncatedNodeCount: number;
  nodes: WikiSubgraphPage[];
  edges: WikiSubgraphLink[];
  hasMore: WikiSubgraphHasMoreEntry[];
}

interface UseWikiSubgraphArgs {
  tenantId: string | null | undefined;
  ownerId: string | null | undefined;
  focalPageId: string | null | undefined;
  depth?: number;
  atTime?: string;
  pageType?: WikiPageType;
}

/**
 * Fetches the agent-scoped subgraph reachable within `depth` hops from
 * `focalPageId`. Powers the mobile force-graph viewer. Paused until
 * `tenantId`, `ownerId`, and `focalPageId` are all present.
 *
 * `atTime` is accepted but currently ignored by the resolver — temporal
 * scrub semantics land with Unit 5 of the mobile force-graph plan.
 */
export function useWikiSubgraph({
  tenantId,
  ownerId,
  focalPageId,
  depth = 1,
  atTime,
  pageType,
}: UseWikiSubgraphArgs) {
  const [{ data, fetching, error }, refetch] = useQuery<{
    wikiSubgraph: WikiSubgraphPayload | null;
  }>({
    query: WikiSubgraphQuery,
    variables: { tenantId, ownerId, focalPageId, depth, atTime, pageType },
    pause: !tenantId || !ownerId || !focalPageId,
    requestPolicy: "cache-and-network",
  });

  return {
    subgraph: data?.wikiSubgraph ?? null,
    loading: fetching,
    error,
    refetch: () => refetch({ requestPolicy: "network-only" }),
  };
}
