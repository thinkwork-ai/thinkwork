import { useQuery } from "urql";
import { WikiGraphQuery } from "../graphql/queries";
import type { WikiPageType } from "../types";

export interface WikiGraphNodeFromServer {
  id: string;
  label: string;
  entityType: WikiPageType;
  slug: string;
  edgeCount: number;
}

export interface WikiGraphEdgeFromServer {
  source: string;
  target: string;
  label: string;
  weight: number;
}

export interface WikiGraphPayload {
  nodes: WikiGraphNodeFromServer[];
  edges: WikiGraphEdgeFromServer[];
}

interface UseWikiGraphArgs {
  tenantId: string | null | undefined;
  ownerId: string | null | undefined;
}

/**
 * Fetches the agent-scoped force-graph payload — every active wiki page
 * + every page-to-page link in the `(tenant, owner)` scope, in one
 * round-trip. Powers the mobile graph view's default "show everything"
 * mode (admin's `/wiki` route uses the same resolver).
 *
 * Paused until both `tenantId` and `ownerId` are present.
 */
export function useWikiGraph({ tenantId, ownerId }: UseWikiGraphArgs) {
  const [{ data, fetching, error }, refetch] = useQuery<{
    wikiGraph: WikiGraphPayload | null;
  }>({
    query: WikiGraphQuery,
    variables: { tenantId, ownerId },
    pause: !tenantId || !ownerId,
    requestPolicy: "cache-and-network",
  });

  return {
    graph: data?.wikiGraph ?? null,
    loading: fetching,
    error,
    refetch: () => refetch({ requestPolicy: "network-only" }),
  };
}
