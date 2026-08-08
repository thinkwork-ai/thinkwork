/**
 * Registry integrity (THINK-694): the docs shell renders nav and mini-TOC
 * from the registry, so a page whose declared TOC drifts from its actual
 * section ids ships broken anchor links with no compile error. Render every
 * published page and check the contract instead.
 */
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DOC_SECTIONS, findDocPage } from "./registry";

// Doc pages use router Links (cross-links, glossary terms); the pages are
// pure content otherwise, so a plain anchor stands in for Link here.
vi.mock("@tanstack/react-router", () => ({
  Link: ({
    children,
    ...rest
  }: {
    children?: React.ReactNode;
    [key: string]: unknown;
  }) => {
    void rest;
    return <a href="#mocked">{children}</a>;
  },
}));

afterEach(cleanup);

const ALL_PAGES = DOC_SECTIONS.flatMap((section) => section.pages);

describe("docs registry", () => {
  it("publishes the seven-section information architecture", () => {
    expect(DOC_SECTIONS.map((section) => section.label)).toEqual([
      "Start here",
      "Agents",
      "Spaces & threads",
      "Memory",
      "Tools & integrations",
      "Automations & quality",
      "Operations",
    ]);
  });

  it("has unique slugs across all sections", () => {
    const slugs = ALL_PAGES.map((page) => page.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it("gives every section at least three pages", () => {
    // A one-page section is just a page; the nav tree earns its chevrons
    // only when a section is worth collapsing.
    for (const section of DOC_SECTIONS) {
      expect(
        section.pages.length,
        `section "${section.label}" is too small`,
      ).toBeGreaterThanOrEqual(3);
    }
  });

  it("opens Start here with getting-started then concepts", () => {
    // Every other page assumes the reader met these two first, and the home
    // page tells them so by name — so the order is a contract, not a taste.
    const startHere = DOC_SECTIONS.find((s) => s.label === "Start here");
    expect(startHere?.pages.slice(0, 2).map((p) => p.slug)).toEqual([
      "getting-started",
      "concepts",
    ]);
  });

  it("resolves known slugs and returns null for unknown ones", () => {
    expect(findDocPage("getting-started")?.slug).toBe("getting-started");
    expect(findDocPage("nope")).toBeNull();
  });

  it.each(ALL_PAGES.map((page) => [page.slug, page] as const))(
    "%s: every declared TOC entry anchors a real element",
    (_slug, page) => {
      const { container } = render(<page.component />);
      expect(page.toc.length).toBeGreaterThan(0);
      for (const entry of page.toc) {
        expect(
          container.querySelector(`#${entry.id}`),
          `toc entry "${entry.id}" has no element with that id`,
        ).not.toBeNull();
      }
    },
  );

  it.each(ALL_PAGES.map((page) => [page.slug, page] as const))(
    "%s: opens with a title and a lead",
    (_slug, page) => {
      const { container } = render(<page.component />);
      expect(
        container.querySelector("h1")?.textContent?.length,
      ).toBeGreaterThan(0);
      expect(page.blurb.length).toBeGreaterThan(0);
    },
  );

  it("declares every rendered Section in its page TOC", () => {
    // The drift guard runs both ways: a section added to a page without a
    // TOC entry is invisible in the rail, which is just as broken as a TOC
    // entry pointing at nothing. Only top-level <Section>s count — nested
    // anchored blocks (GlossaryEntry) are sub-headings, not TOC entries.
    for (const page of ALL_PAGES) {
      const { container } = render(<page.component />);
      const rendered = Array.from(
        container.querySelectorAll("article > section[id]"),
      )
        .map((node) => node.id)
        .filter((id) => id.length > 0);
      const declared = new Set(page.toc.map((entry) => entry.id));
      for (const id of rendered) {
        expect(
          declared.has(id),
          `${page.slug}: <Section id="${id}"> is missing from its TOC`,
        ).toBe(true);
      }
      cleanup();
    }
  });
});
