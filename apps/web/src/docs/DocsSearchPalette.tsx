/**
 * Cmd+K docs search (Eric 2026-08-09, ported from the Brain console's
 * docs palette the same day). The registry already knows every published
 * page and its on-page TOC, so the search index is the registry itself —
 * no content extraction, no server round-trip. Filtering runs over page
 * titles, section labels, blurbs and TOC headings; picking a result
 * navigates to the page (and scrolls to the heading, for TOC hits).
 *
 * With an empty query the list shows only the pages — a browsable map —
 * and typing brings the per-page headings into play, so the empty state
 * never drowns in a hundred heading rows.
 */
import { useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { CornerDownLeft } from "lucide-react";
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from "@thinkwork/ui";
import { DOC_SECTIONS } from "./registry";

export interface DocsSearchHit {
  /** cmdk value — unique per row, and what the filter matches on. */
  value: string;
  slug: string;
  pageTitle: string;
  sectionLabel: string;
  /** Set on TOC rows: the heading id to scroll to after navigating. */
  anchor?: string;
  anchorTitle?: string;
  /** Extra terms the filter should match beyond the visible title. */
  keywords: string[];
}

/** Flatten the registry into searchable rows: one per page, one per TOC entry. */
export function buildDocsSearchIndex(): {
  pages: DocsSearchHit[];
  headings: DocsSearchHit[];
} {
  const pages: DocsSearchHit[] = [];
  const headings: DocsSearchHit[] = [];
  for (const section of DOC_SECTIONS) {
    for (const page of section.pages) {
      pages.push({
        value: `page:${page.slug}`,
        slug: page.slug,
        pageTitle: page.title,
        sectionLabel: section.label,
        keywords: [page.title, section.label, page.blurb],
      });
      for (const entry of page.toc) {
        headings.push({
          value: `toc:${page.slug}#${entry.id}`,
          slug: page.slug,
          pageTitle: page.title,
          sectionLabel: section.label,
          anchor: entry.id,
          anchorTitle: entry.title,
          keywords: [entry.title, page.title],
        });
      }
    }
  }
  return { pages, headings };
}

/**
 * Substring matching, not cmdk's default fuzzy scorer: fuzzy matches
 * "delta" as five scattered letters, so any page with a wordy blurb
 * outranks the heading literally titled "Delta". Every whitespace token
 * must appear somewhere in the row's text; rows whose visible title
 * carries the match rank above rows that only matched a blurb keyword.
 */
export function docsSearchScore(
  search: string,
  title: string,
  keywords: string[],
): number {
  const tokens = search.toLowerCase().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return 1;
  const titleLower = title.toLowerCase();
  const haystack = `${titleLower} ${keywords.join(" ").toLowerCase()}`;
  if (!tokens.every((token) => haystack.includes(token))) return 0;
  if (titleLower.startsWith(tokens[0])) return 3;
  if (tokens.some((token) => titleLower.includes(token))) return 2;
  return 1;
}

export function DocsSearchPalette({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const { pages, headings } = useMemo(buildDocsSearchIndex, []);
  const titleByValue = useMemo(
    () =>
      new Map(
        [...pages, ...headings].map((hit) => [
          hit.value,
          hit.anchorTitle ?? hit.pageTitle,
        ]),
      ),
    [pages, headings],
  );
  const searching = query.trim().length > 0;

  const go = (hit: DocsSearchHit) => {
    onOpenChange(false);
    void navigate({
      to: "/docs/$slug",
      params: { slug: hit.slug },
      ...(hit.anchor ? { hash: hit.anchor } : {}),
    }).then(() => {
      if (!hit.anchor) return;
      // The article container remounts on slug change (keyed by slug), so
      // scroll on the next frame, once the target heading exists.
      requestAnimationFrame(() => {
        document.getElementById(hit.anchor!)?.scrollIntoView();
      });
    });
  };

  return (
    <CommandDialog
      open={open}
      onOpenChange={(next: boolean) => {
        if (next) setQuery("");
        onOpenChange(next);
      }}
      title="Search documentation"
      description="Find a docs page or section"
      // The docs surface is forced dark (see DocsPage); the dialog portals
      // to <body>, outside that subtree, so it re-declares the theme.
      className="dark"
    >
      <Command
        data-testid="docs-search-palette"
        filter={(value, search, keywords) =>
          docsSearchScore(
            search,
            titleByValue.get(value) ?? value,
            keywords ?? [],
          )
        }
      >
        <CommandInput
          autoFocus
          placeholder="Search docs…"
          aria-label="Search docs"
          data-testid="docs-search-input"
          value={query}
          onValueChange={setQuery}
        />
        <CommandList data-testid="docs-search-results">
          <CommandEmpty>No matching docs.</CommandEmpty>
          {pages.map((hit) => (
            <CommandItem
              key={hit.value}
              value={hit.value}
              keywords={hit.keywords}
              onSelect={() => go(hit)}
            >
              <span className="min-w-0 flex-1 truncate">{hit.pageTitle}</span>
              <span className="ml-2 shrink-0 text-xs text-muted-foreground">
                {hit.sectionLabel}
              </span>
            </CommandItem>
          ))}
          {searching
            ? headings.map((hit) => (
                <CommandItem
                  key={hit.value}
                  value={hit.value}
                  keywords={hit.keywords}
                  onSelect={() => go(hit)}
                >
                  <span className="min-w-0 flex-1 truncate">
                    <span className="text-muted-foreground">
                      {hit.pageTitle} ›{" "}
                    </span>
                    {hit.anchorTitle}
                  </span>
                  <CornerDownLeft
                    aria-hidden
                    className="ml-2 size-3 shrink-0 text-muted-foreground/50"
                  />
                </CommandItem>
              ))
            : null}
        </CommandList>
      </Command>
    </CommandDialog>
  );
}
