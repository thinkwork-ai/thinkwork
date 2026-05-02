import { useCallback } from "react";
import { useQuery } from "urql";
import {
  WikiBacklinksQuery,
  WikiConnectedPagesQuery,
  WikiPageQuery,
} from "../graphql/queries";
import type { WikiPageType } from "../types";

export interface WikiPageSection {
  id: string;
  sectionSlug: string;
  heading: string;
  bodyMd: string;
  position: number;
  lastSourceAt: string | null;
}

export interface WikiPageRef {
  id: string;
  type: WikiPageType;
  slug: string;
  title: string;
  summary?: string | null;
}

export interface WikiPromotedFromSection {
  parentPage: WikiPageRef;
  sectionSlug: string;
  sectionHeading: string;
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
  // Unit 8 read surfaces — populated on the detail query only.
  sourceMemoryCount?: number;
  parent?: WikiPageRef | null;
  promotedFromSection?: WikiPromotedFromSection | null;
  children?: WikiPageRef[];
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
  userId?: string | null | undefined;
  /** @deprecated Use userId. Kept only for legacy callers during rollout. */
  ownerId?: string | null | undefined;
  type: WikiPageType | null | undefined;
  slug: string | null | undefined;
}

/**
 * Fetches a compiled wiki page by (tenant, user, type, slug) with all
 * its sections. Paused until all four args are present.
 */
export function useWikiPage({ tenantId, userId, ownerId, type, slug }: UseWikiPageArgs) {
  const scopeUserId = userId ?? ownerId;
  const [{ data, fetching, error }, refetch] = useQuery<{
    wikiPage: WikiPageDetail | null;
  }>({
    query: WikiPageQuery,
    variables: { tenantId, userId: scopeUserId, type, slug },
    pause: !tenantId || !scopeUserId || !type || !slug,
    requestPolicy: "cache-and-network",
  });
  const refresh = useCallback(
    () => refetch({ requestPolicy: "network-only" }),
    [refetch],
  );

  return {
    page: data?.wikiPage ?? null,
    loading: fetching,
    error,
    refetch: refresh,
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

/**
 * Lists pages this page links OUT to — the "Connected Pages" surface,
 * complementing useWikiBacklinks. Results are deduplicated on the
 * server so a parent/child with both `reference` and `parent_of`
 * edges shows up once.
 */
export function useWikiConnectedPages(pageId: string | null | undefined) {
  const [{ data, fetching, error }, refetch] = useQuery<{
    wikiConnectedPages: WikiBacklink[] | null;
  }>({
    query: WikiConnectedPagesQuery,
    variables: { pageId },
    pause: !pageId,
    requestPolicy: "cache-and-network",
  });

  return {
    connectedPages: data?.wikiConnectedPages ?? [],
    loading: fetching,
    error,
    refetch: () => refetch({ requestPolicy: "network-only" }),
  };
}
