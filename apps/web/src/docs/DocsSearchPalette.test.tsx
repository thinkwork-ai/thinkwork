/**
 * Cmd+K docs search: the index IS the registry, so these pin the contract
 * that matters — every published page and every declared TOC heading is
 * reachable through search, pages browse with an empty query while
 * headings appear only once you type, and a pick navigates to the right
 * slug (with the heading's hash for TOC hits).
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { DOC_SECTIONS } from "./registry";
import {
  buildDocsSearchIndex,
  DocsSearchPalette,
  docsSearchScore,
} from "./DocsSearchPalette";

const navigateCalls = vi.hoisted(() => [] as Array<Record<string, unknown>>);

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => (options: Record<string, unknown>) => {
    navigateCalls.push(options);
    return Promise.resolve();
  },
}));

afterEach(() => {
  cleanup();
  navigateCalls.length = 0;
});

// cmdk scrolls the selected item into view; jsdom has no scrollIntoView.
beforeAll(() => {
  Element.prototype.scrollIntoView ??= () => {};
});

describe("buildDocsSearchIndex", () => {
  it("indexes every published page and every declared TOC heading", () => {
    const { pages, headings } = buildDocsSearchIndex();
    const allPages = DOC_SECTIONS.flatMap((s) => s.pages);
    expect(pages.map((p) => p.slug).sort()).toEqual(
      allPages.map((p) => p.slug).sort(),
    );
    expect(headings.length).toBe(
      allPages.reduce((n, p) => n + p.toc.length, 0),
    );
    // Rows are unique — duplicate cmdk values would collapse results.
    const values = [...pages, ...headings].map((h) => h.value);
    expect(new Set(values).size).toBe(values.length);
  });
});

describe("docsSearchScore", () => {
  it("is substring matching, not fuzzy — scattered letters never match", () => {
    // cmdk's default scorer matched "delta" as d·e·l·t·a spread across
    // "Analytics channel"'s blurb, ranking it above the literal heading.
    expect(
      docsSearchScore("delta", "Analytics channel", ["exact totals"]),
    ).toBe(0);
    expect(docsSearchScore("delta", "Delta discipline", [])).toBe(3);
    expect(docsSearchScore("delta", "The delta cursor", [])).toBe(2);
    expect(
      docsSearchScore("delta", "SharePoint knowledge sync", [
        "delta discipline",
      ]),
    ).toBe(1);
  });

  it("requires every token, anywhere across title and keywords", () => {
    expect(
      docsSearchScore("mask fence", "Security model", ["mask", "fence"]),
    ).toBe(1);
    expect(docsSearchScore("mask missing", "Security model", ["mask"])).toBe(0);
    expect(docsSearchScore("", "Anything", [])).toBe(1);
  });
});

describe("DocsSearchPalette", () => {
  it("browses pages with an empty query, no heading rows", () => {
    render(<DocsSearchPalette open onOpenChange={() => {}} />);
    const { pages } = buildDocsSearchIndex();
    const list = screen.getByTestId("docs-search-results");
    expect(list.querySelectorAll("[data-slot=command-item]").length).toBe(
      pages.length,
    );
  });

  it("typing filters and surfaces matching headings", () => {
    render(<DocsSearchPalette open onOpenChange={() => {}} />);
    fireEvent.change(screen.getByTestId("docs-search-input"), {
      target: { value: "skills" },
    });
    // The page row and at least one of its headings both match.
    expect(screen.getByText("Skills")).toBeTruthy();
    const list = screen.getByTestId("docs-search-results");
    const rows = [...list.querySelectorAll("[data-slot=command-item]")];
    expect(
      rows.some((row) =>
        row.getAttribute("data-value")?.startsWith("toc:skills#"),
      ),
    ).toBe(true);
  });

  it("picking a page navigates to its slug and closes", () => {
    const onOpenChange = vi.fn();
    render(<DocsSearchPalette open onOpenChange={onOpenChange} />);
    fireEvent.change(screen.getByTestId("docs-search-input"), {
      target: { value: "slack" },
    });
    const list = screen.getByTestId("docs-search-results");
    const row = list.querySelector('[data-value="page:slack"]');
    expect(row).toBeTruthy();
    fireEvent.click(row!);
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(navigateCalls[0]).toMatchObject({
      to: "/docs/$slug",
      params: { slug: "slack" },
    });
    expect(navigateCalls[0]).not.toHaveProperty("hash");
  });

  it("picking a heading navigates with the anchor as hash", () => {
    render(<DocsSearchPalette open onOpenChange={() => {}} />);
    const { headings } = buildDocsSearchIndex();
    const target = headings[0];
    fireEvent.change(screen.getByTestId("docs-search-input"), {
      target: { value: target.anchorTitle! },
    });
    const list = screen.getByTestId("docs-search-results");
    const row = list.querySelector(
      `[data-value=${JSON.stringify(target.value)}]`,
    );
    expect(row, `no row for ${target.value}`).toBeTruthy();
    fireEvent.click(row!);
    expect(navigateCalls[0]).toMatchObject({
      params: { slug: target.slug },
      hash: target.anchor,
    });
  });
});
