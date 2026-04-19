import { useQuery } from "urql";
import { WikiBacklinksQuery, WikiPageQuery } from "../graphql/queries";
import type { WikiPageType } from "../types";

export interface WikiPageSection {
  id: string;
  sectionSlug: string;
  heading: string;
  bodyMd: string;
  position: number;
  lastSourceAt: string | null;
}

export interface WikiPageDetail {
  id: string;
  type: WikiPageType;
  slug: string;
  title: string;
  summary: string | null;
  bodyMd: string | null;
  status: string;
  lastCompiledAt: string | null;
  updatedAt: string;
  aliases: string[];
  sections: WikiPageSection[];
}

export interface WikiBacklink {
  id: string;
  type: WikiPageType;
  slug: string;
  title: string;
  summary: string | null;
}

interface UseWikiPageArgs {
  tenantId: string | null | undefined;
  ownerId: string | null | undefined;
  type: WikiPageType | null | undefined;
  slug: string | null | undefined;
}

/**
 * Fetches a compiled wiki page by (tenant, owner, type, slug) with all
 * its sections. Paused until all four args are present.
 */
export function useWikiPage({ tenantId, ownerId, type, slug }: UseWikiPageArgs) {
  const [{ data, fetching, error }, refetch] = useQuery<{
    wikiPage: WikiPageDetail | null;
  }>({
    query: WikiPageQuery,
    variables: { tenantId, ownerId, type, slug },
    pause: !tenantId || !ownerId || !type || !slug,
    requestPolicy: "cache-and-network",
  });

  return {
    page: data?.wikiPage ?? null,
    loading: fetching,
    error,
    refetch: () => refetch({ requestPolicy: "network-only" }),
  };
}

/**
 * Lists pages that link TO the given page id. Useful for "referenced
 * by" sections on a detail view.
 */
export function useWikiBacklinks(pageId: string | null | undefined) {
  const [{ data, fetching, error }, refetch] = useQuery<{
    wikiBacklinks: WikiBacklink[] | null;
  }>({
    query: WikiBacklinksQuery,
    variables: { pageId },
    pause: !pageId,
    requestPolicy: "cache-and-network",
  });

  return {
    backlinks: data?.wikiBacklinks ?? [],
    loading: fetching,
    error,
    refetch: () => refetch({ requestPolicy: "network-only" }),
  };
}
