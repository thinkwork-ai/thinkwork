import { useMemo } from "react";
import { useQuery } from "urql";
import { useNavigate } from "@tanstack/react-router";
import { Loader2 } from "lucide-react";
import {
  PAGE_TYPE_BADGE_CLASSES,
  pageTypeLabel,
  type WikiPageType,
} from "@thinkwork/graph";
import { Badge } from "@thinkwork/ui";
import {
  ComputerWikiPageLinksQuery,
  ComputerWikiPageQuery,
} from "@/lib/graphql-queries";
import { usePageHeaderActions } from "@/context/PageHeaderContext";
import {
  NodeBadge,
  RelationshipConnector,
  hashColor,
} from "@/components/memory/relationship-badges";
import { RelatedMemories } from "@/components/memory/RelatedMemories";

interface WikiPageSection {
  id: string;
  sectionSlug?: string | null;
  heading?: string | null;
  bodyMd?: string | null;
  position?: number | null;
}

interface WikiPageDetail {
  id: string;
  type: WikiPageType;
  slug: string;
  title?: string | null;
  summary?: string | null;
  bodyMd?: string | null;
  status?: string | null;
  lastCompiledAt?: string | null;
  updatedAt?: string | null;
  aliases?: string[] | null;
  sections?: WikiPageSection[] | null;
}

interface WikiLinkedPage {
  id: string;
  type: WikiPageType;
  slug: string;
  title?: string | null;
  aliases?: string[] | null;
}

/** `Source — relationship — Target` lines from a compiled Relationships section. */
const RELATIONSHIP_LINE = /^-?\s*(.+?)\s+—\s+(.+?)\s+—\s+(.+)$/;

function parseRelationshipLines(bodyMd: string) {
  return bodyMd
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const match = line.match(RELATIONSHIP_LINE);
      return match
        ? { source: match[1]!, relationship: match[2]!, target: match[3]! }
        : { raw: line };
    });
}

function isRelationshipsSection(section: WikiPageSection): boolean {
  return section.heading?.trim().toLowerCase() === "relationships";
}

/**
 * Full-page wiki reader (THINK-263 U5). A selected search result opens the
 * page here — identity and content immediately visible — following the
 * full-page presentation pattern of the HTML-report reader
 * (`DocumentArtifactContent`) rather than dropping the user on the graph tab.
 * Reachable by any tenant member: `wikiPage` resolves under the tenant-union
 * read scope, so this route is intentionally not operator-gated.
 *
 * Content renders from the structured `sections` (the canonical compiled form,
 * matching `WikiPageDetailSheet`). We deliberately do NOT also render `bodyMd`
 * — it is the same content re-serialized and would duplicate every section —
 * and we avoid the prose/Streamdown renderer here because its default colors
 * are unreadable on the dark reader background.
 */
export function WikiPageView({
  tenantId,
  userId,
  type,
  slug,
  title,
  backHref = "/settings/memory/wiki",
}: {
  tenantId: string | null | undefined;
  userId?: string | null;
  type: WikiPageType;
  slug: string;
  /** Fallback title shown until the page query resolves. */
  title?: string;
  backHref?: string;
}) {
  const [{ data, fetching, error }] = useQuery<{
    wikiPage?: WikiPageDetail | null;
  }>({
    query: ComputerWikiPageQuery,
    variables: { tenantId: tenantId ?? "", userId, type, slug },
    pause: !tenantId || !slug,
  });

  const page = data?.wikiPage ?? null;
  const loading = fetching && !data;
  const headerTitle = page?.title ?? title ?? slug;
  const navigate = useNavigate();

  // Connected + backlink pages resolve relationship-badge labels into real
  // wiki navigation targets (THINK-270 repair) — the graph tab supplies its
  // sheet with edges directly, but the full-page reader must look them up.
  const [{ data: linksData }] = useQuery<{
    wikiConnectedPages?: WikiLinkedPage[] | null;
    wikiBacklinks?: WikiLinkedPage[] | null;
  }>({
    query: ComputerWikiPageLinksQuery,
    variables: { pageId: page?.id ?? "" },
    pause: !page?.id,
  });

  // Normalized title/alias → linked page. The current page stays out of the
  // map so its own badge remains inert, matching WikiPageDetailSheet.
  const linkedPagesByLabel = useMemo(() => {
    const map = new Map<string, WikiLinkedPage>();
    const pages = [
      ...(linksData?.wikiConnectedPages ?? []),
      ...(linksData?.wikiBacklinks ?? []),
    ];
    for (const linked of pages) {
      if (linked.id === page?.id) continue;
      for (const label of [linked.title, ...(linked.aliases ?? [])]) {
        const normalized = label?.trim().toLowerCase();
        if (normalized && !map.has(normalized)) map.set(normalized, linked);
      }
    }
    return map;
  }, [linksData, page?.id]);

  // Clicking a relationship badge SPA-navigates to the matching linked page;
  // the current page and unknown labels are inert.
  const navigateFor = (label: string): (() => void) | undefined => {
    const linked = linkedPagesByLabel.get(label.trim().toLowerCase());
    if (!linked) return undefined;
    return () => {
      void navigate({
        to: "/wiki/$type/$slug",
        params: { type: linked.type.toLowerCase(), slug: linked.slug },
      });
    };
  };

  usePageHeaderActions({
    title: headerTitle,
    breadcrumbs: [
      { label: "Wiki", href: "/settings/memory/wiki" },
      { label: headerTitle },
    ],
    backHref,
    backBehavior: "history",
  });

  const sortedSections = useMemo(
    () =>
      [...(page?.sections ?? [])].sort(
        (a, b) => (a.position ?? 0) - (b.position ?? 0),
      ),
    [page?.sections],
  );

  // Compiled pages populate `sections`; fall back to the raw body only when a
  // page has none, so a page is never blank.
  const showBodyFallback = sortedSections.length === 0 && !!page?.bodyMd;

  return (
    <main className="flex h-full min-h-0 w-full flex-col overflow-y-auto">
      <div className="mx-auto w-full max-w-3xl px-6 py-8">
        {loading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> Loading page…
          </div>
        ) : !page ? (
          <p className="text-sm text-muted-foreground">
            {error?.message ??
              "This page couldn't be loaded. It may have been archived since it was last indexed."}
          </p>
        ) : (
          <article className="space-y-6">
            <header className="space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-2xl font-semibold tracking-tight text-foreground">
                  {page.title ?? slug}
                </h1>
                <Badge
                  className={`text-xs font-normal ${
                    PAGE_TYPE_BADGE_CLASSES[type] ??
                    "bg-muted text-muted-foreground"
                  }`}
                >
                  {pageTypeLabel(type)}
                </Badge>
              </div>
              {page.lastCompiledAt ? (
                <p className="text-xs text-muted-foreground">
                  Compiled{" "}
                  {new Date(page.lastCompiledAt).toLocaleDateString("en-US", {
                    month: "short",
                    day: "numeric",
                    year: "numeric",
                  })}
                </p>
              ) : null}
            </header>

            {page.summary ? (
              <p className="text-base leading-relaxed text-foreground">
                {page.summary}
              </p>
            ) : null}

            {page.aliases && page.aliases.length > 0 ? (
              <div>
                <p className="mb-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  Also known as
                </p>
                <div className="flex flex-wrap gap-1">
                  {page.aliases.map((alias) => (
                    <Badge
                      key={alias}
                      variant="outline"
                      className="text-xs font-normal"
                    >
                      {alias}
                    </Badge>
                  ))}
                </div>
              </div>
            ) : null}

            {sortedSections.length > 0 ? (
              <div className="space-y-6">
                {sortedSections.map((section) => (
                  <section key={section.id} className="space-y-2">
                    {section.heading ? (
                      <h2 className="text-sm font-semibold text-foreground">
                        {section.heading}
                      </h2>
                    ) : null}
                    {isRelationshipsSection(section) ? (
                      <div className="space-y-1.5">
                        {parseRelationshipLines(section.bodyMd ?? "").map(
                          (row, index) =>
                            "raw" in row ? (
                              <p
                                key={index}
                                className="text-sm text-muted-foreground"
                              >
                                {row.raw}
                              </p>
                            ) : (
                              <div
                                key={index}
                                className="flex flex-wrap items-center gap-1.5"
                              >
                                <NodeBadge
                                  label={row.source}
                                  color={hashColor(row.source)}
                                  onClick={navigateFor(row.source)}
                                />
                                <RelationshipConnector
                                  label={row.relationship}
                                />
                                <NodeBadge
                                  label={row.target}
                                  color={hashColor(row.target)}
                                  onClick={navigateFor(row.target)}
                                />
                              </div>
                            ),
                        )}
                      </div>
                    ) : section.bodyMd ? (
                      <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground">
                        {section.bodyMd}
                      </p>
                    ) : null}
                  </section>
                ))}
              </div>
            ) : showBodyFallback ? (
              <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground">
                {page.bodyMd}
              </p>
            ) : null}

            <RelatedMemories
              tenantId={tenantId ?? ""}
              userId={userId}
              query={page.title ?? slug}
            />
          </article>
        )}
      </div>
    </main>
  );
}
