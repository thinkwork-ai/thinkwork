/**
 * Agent Documentation (THINK-693) — the docs surface itself.
 *
 * Lives under `_authed` but NOT under `_authed/_shell`: docs open in their
 * own tab from the account menu, and reading material doesn't want the app
 * chrome. The shell here is docs-specific — a left tree of published pages,
 * the article, and an on-page TOC rail on wide screens.
 *
 * Content ships inside the web bundle — TSX pages registered in
 * src/docs/registry.ts — so the docs deploy with the build they document.
 *
 * Forced dark (see the `dark` class on the root): the app has three themes
 * (light / dark / dark-blue, class-based on <html>), and this surface is
 * designed for the dark palette — hue-on-dark diagram tiles, dot-grid
 * canvases, white-alpha node gradients. `packages/ui/theme.css` defines
 * every token under a bare `.dark {}` selector, so re-declaring the class
 * on this subtree re-resolves the tokens locally and wins over whatever
 * <html> carries, in all three themes. The explicit `bg-background
 * text-foreground` then paints the surface rather than inheriting the
 * (possibly light) page background.
 */
import { useEffect, useState, type ReactNode } from "react";
import { Link, useParams } from "@tanstack/react-router";
import { BookOpen, ChevronRight, Hammer } from "lucide-react";
import { cn } from "@thinkwork/ui";
import {
  DOC_SECTIONS,
  PLANNED_PAGES,
  findDocPage,
  type DocPageDef,
  type DocSectionDef,
} from "@/docs/registry";

export function DocsPage() {
  const params = useParams({ strict: false }) as { slug?: string };
  const page = params.slug ? findDocPage(params.slug) : null;

  useEffect(() => {
    document.title = page
      ? `${page.title} · Agent Documentation`
      : "Agent Documentation";
  }, [page]);

  return (
    <div className="dark flex h-svh min-h-0 bg-background text-foreground">
      <DocsNav activeSlug={page?.slug} />

      {/* key resets scroll when the article changes — one shared container,
          no scroll restoration surprises. */}
      <div
        key={page?.slug ?? "home"}
        className="min-w-0 flex-1 overflow-y-auto"
      >
        {page ? <page.component /> : <DocsHome missedSlug={params.slug} />}
      </div>

      {page && page.toc.length > 0 ? <DocsToc page={page} /> : null}
    </div>
  );
}

function DocsNav({ activeSlug }: { activeSlug?: string }) {
  return (
    <aside className="hidden w-64 shrink-0 flex-col border-r border-border/60 bg-muted/10 md:flex">
      {/* Brand row mirrors the app sidebar (h-7 logo, text-base semibold
          tracking-tight) so "Agent Documentation" reads as the same wordmark
          as "ThinkWork Agent" one tab over. */}
      <div className="flex items-center gap-2 px-3 pt-2 pb-3">
        <Link
          to="/docs"
          className="flex min-w-0 items-center gap-2 rounded-md px-1 py-1 outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <img
            src="/logo.png"
            alt=""
            aria-hidden="true"
            className="h-7 w-7 shrink-0 object-contain"
          />
          <span className="truncate text-base leading-none font-semibold tracking-tight">
            Agent Documentation
          </span>
        </Link>
      </div>
      <nav
        className="min-h-0 flex-1 overflow-y-auto px-2 pb-4"
        aria-label="Documentation"
      >
        {DOC_SECTIONS.map((section) => (
          <NavSection
            key={section.label}
            section={section}
            activeSlug={activeSlug}
          />
        ))}
      </nav>
    </aside>
  );
}

/**
 * One collapsible section of the docs tree. Sections are collapsed by
 * default and the toggle is purely manual — navigating never expands or
 * collapses anything (decision: Eric 2026-08-08). The one exception is
 * first render: the section holding the deep-linked page starts open so
 * the current page is never hidden.
 */
function NavSection({
  section,
  activeSlug,
}: {
  section: DocSectionDef;
  activeSlug?: string;
}) {
  const containsActive = section.pages.some((p) => p.slug === activeSlug);
  const [open, setOpen] = useState(containsActive);
  return (
    <div className="pt-1.5">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className={cn(
          "flex w-full items-center gap-1.5 rounded-md px-1.5 py-1.5 text-[11px] font-medium tracking-widest uppercase outline-none hover:bg-muted/40 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring",
          containsActive ? "text-foreground/90" : "text-muted-foreground",
        )}
      >
        <ChevronRight
          aria-hidden="true"
          className={cn(
            "size-3 shrink-0 text-muted-foreground/70 transition-transform",
            open && "rotate-90",
          )}
        />
        <span className="truncate">{section.label}</span>
      </button>
      {open ? (
        <div className="mt-0.5 mb-1 ml-[13px] border-l border-border/60 pl-1.5">
          {section.pages.map((entry) => {
            const active = entry.slug === activeSlug;
            return (
              <Link
                key={entry.slug}
                to="/docs/$slug"
                params={{ slug: entry.slug }}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex h-8 items-center rounded-md px-2 text-sm text-foreground/75 outline-none hover:bg-muted/60 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring",
                  active && "bg-muted/60 font-medium text-foreground",
                )}
              >
                <span className="truncate">{entry.title}</span>
              </Link>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

function DocsToc({ page }: { page: DocPageDef }) {
  return (
    <aside className="hidden w-56 shrink-0 pt-12 pr-6 xl:block">
      <p className="pb-2 text-[11px] font-medium tracking-widest text-muted-foreground uppercase">
        On this page
      </p>
      <ul className="space-y-1 border-l border-border/60">
        {page.toc.map((entry) => (
          <li key={entry.id}>
            <a
              href={`#${entry.id}`}
              className="block -translate-x-px border-l border-transparent py-0.5 pl-3 text-[13px] leading-5 text-muted-foreground hover:border-foreground/40 hover:text-foreground"
            >
              {entry.title}
            </a>
          </li>
        ))}
      </ul>
    </aside>
  );
}

function DocsHome({ missedSlug }: { missedSlug?: string }) {
  return (
    <div className="mx-auto w-full max-w-6xl px-8 pt-14 pb-24">
      {missedSlug ? (
        <p className="mb-6 rounded-md border border-amber-400/25 bg-amber-400/5 px-3 py-2 text-xs text-amber-200/90">
          No doc named <code className="font-mono">{missedSlug}</code> — it may
          not be published yet. Here&apos;s everything that is.
        </p>
      ) : null}

      <div className="flex items-center gap-2 text-muted-foreground">
        <BookOpen className="size-4" aria-hidden="true" />
        <span className="text-xs font-medium tracking-widest uppercase">
          Documentation
        </span>
      </div>
      <h1 className="mt-3 text-3xl font-semibold tracking-tight text-balance">
        Learn how ThinkWork Agent works — and how to run it
      </h1>
      <p className="mt-3 max-w-2xl text-base leading-7 text-muted-foreground">
        Diagram-first guides to agents and their workspaces, the spaces and
        threads work happens in, and the tools, memory and automations behind
        them. New here? Start with Getting started, then Core concepts —
        everything else builds on those two.
      </p>

      {DOC_SECTIONS.map((section) => (
        <HomeSection key={section.label} label={section.label}>
          {section.pages.map((page) => (
            <Link
              key={page.slug}
              to="/docs/$slug"
              params={{ slug: page.slug }}
              className="group rounded-xl border border-border bg-card p-4 outline-none hover:border-foreground/25 focus-visible:ring-2 focus-visible:ring-ring"
            >
              <p className="text-sm font-medium group-hover:text-foreground">
                {page.title}
              </p>
              <p className="mt-1 text-[13px] leading-5 text-muted-foreground">
                {page.blurb}
              </p>
            </Link>
          ))}
        </HomeSection>
      ))}

      {PLANNED_PAGES.length > 0 ? (
        <HomeSection label="In progress">
          {PLANNED_PAGES.map((planned) => (
            <div
              key={planned.title}
              className="rounded-xl border border-dashed border-border/60 p-4"
            >
              <p className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground">
                <Hammer className="size-3.5" aria-hidden="true" />
                {planned.title}
              </p>
              <p className="mt-1 text-[13px] leading-5 text-muted-foreground/70">
                {planned.blurb}
              </p>
            </div>
          ))}
        </HomeSection>
      ) : null}
    </div>
  );
}

function HomeSection({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <section className="pt-10">
      <p className="pb-3 text-xs font-medium tracking-widest text-muted-foreground uppercase">
        {label}
      </p>
      {/* Three per row, so a section reads as clean rows rather than a
          row-and-an-orphan. */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{children}</div>
    </section>
  );
}
