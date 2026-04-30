import { useQuery } from "urql";
import { TenantEntityPageQuery } from "../graphql/queries";

export interface TenantEntitySection {
  id: string;
  sectionSlug: string;
  heading: string;
  bodyMd: string;
  position: number;
  facetType?: string | null;
  lastSourceAt?: string | null;
}

export interface TenantEntityPage {
  id: string;
  tenantId: string;
  type: string;
  entitySubtype: string;
  slug: string;
  title: string;
  summary?: string | null;
  bodyMd?: string | null;
  status: string;
  updatedAt: string;
  sections: TenantEntitySection[];
}

export function useTenantEntityPage(args: {
  tenantId: string | null | undefined;
  pageId: string | null | undefined;
}) {
  const [{ data, fetching, error }, refetch] = useQuery<{
    tenantEntityPage: TenantEntityPage | null;
  }>({
    query: TenantEntityPageQuery,
    variables: { tenantId: args.tenantId, pageId: args.pageId },
    pause: !args.tenantId || !args.pageId,
    requestPolicy: "cache-and-network",
  });

  return {
    page: data?.tenantEntityPage ?? null,
    facets: data?.tenantEntityPage?.sections ?? [],
    loading: fetching,
    error,
    refetch: () => refetch({ requestPolicy: "network-only" }),
  };
}
