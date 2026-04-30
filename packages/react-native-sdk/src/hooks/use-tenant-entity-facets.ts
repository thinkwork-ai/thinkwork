import { useMutation, useQuery } from "urql";
import {
  EditTenantEntityFactMutation,
  RejectTenantEntityFactMutation,
  TenantEntityFacetsQuery,
} from "../graphql/queries";

export interface TenantEntityFacet {
  id: string;
  sectionSlug: string;
  heading: string;
  bodyMd: string;
  facetType?: string | null;
  updatedAt: string;
}

export function useTenantEntityFacets(args: {
  pageId: string | null | undefined;
  limit?: number;
}) {
  const [{ data, fetching, error }, refetch] = useQuery<{
    tenantEntityFacets: {
      edges: Array<{ node: TenantEntityFacet; cursor: string }>;
      pageInfo: { hasNextPage: boolean; endCursor: string | null };
    } | null;
  }>({
    query: TenantEntityFacetsQuery,
    variables: { pageId: args.pageId, limit: args.limit },
    pause: !args.pageId,
    requestPolicy: "cache-and-network",
  });
  const [, editFact] = useMutation(EditTenantEntityFactMutation);
  const [, rejectFact] = useMutation(RejectTenantEntityFactMutation);

  return {
    facets: data?.tenantEntityFacets?.edges.map((edge) => edge.node) ?? [],
    pageInfo: data?.tenantEntityFacets?.pageInfo ?? null,
    loading: fetching,
    error,
    refetch: () => refetch({ requestPolicy: "network-only" }),
    editFact: (factId: string, content: string) =>
      editFact({ factId, content }),
    rejectFact: (factId: string, reason?: string) =>
      rejectFact({ factId, reason }),
  };
}
