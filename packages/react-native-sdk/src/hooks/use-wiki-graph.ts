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
  userId?: string | null | undefined;
  /** @deprecated Use userId. Kept only for legacy callers during rollout. */
  ownerId?: string | null | undefined;
}

/**
 * Fetches the user-scoped force-graph payload — every active wiki page
 * + every page-to-page link in the `(tenant, user)` scope, in one
 * round-trip. Powers the mobile graph view's default "show everything"
 * mode (admin's `/wiki` route uses the same resolver).
 *
 * Paused until both `tenantId` and `userId` are present.
 */
export function useWikiGraph({ tenantId, userId, ownerId }: UseWikiGraphArgs) {
  const scopeUserId = userId ?? ownerId;
  const [{ data, fetching, error }, refetch] = useQuery<{
    wikiGraph: WikiGraphPayload | null;
  }>({
    query: WikiGraphQuery,
    variables: { tenantId, userId: scopeUserId },
    pause: !tenantId || !scopeUserId,
    requestPolicy: "cache-and-network",
  });

  return {
    graph: data?.wikiGraph ?? null,
    loading: fetching,
    error,
    refetch: () => refetch({ requestPolicy: "network-only" }),
  };
}
