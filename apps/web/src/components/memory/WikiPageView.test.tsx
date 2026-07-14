import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let queryResult: {
  data?: unknown;
  fetching?: boolean;
  error?: { message: string };
} = { fetching: true };

// Result of the page-links query (connected pages + backlinks) — keyed off
// its `pageId` variable in the urql mock below.
let linksResult: {
  data?: unknown;
  fetching?: boolean;
} = { fetching: false, data: { wikiConnectedPages: [], wikiBacklinks: [] } };

vi.mock("urql", () => ({
  useQuery: (args: { variables?: Record<string, unknown> }) => [
    args.variables && "pageId" in args.variables ? linksResult : queryResult,
    vi.fn(),
  ],
}));

const navigateMock = vi.hoisted(() => vi.fn());

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => navigateMock,
}));

vi.mock("@/context/PageHeaderContext", () => ({
  usePageHeaderActions: () => {},
}));

vi.mock("@/components/memory/RelatedMemories", () => ({
  RelatedMemories: () => <div data-testid="related-memories" />,
}));

import { WikiPageView } from "./WikiPageView";

function renderView() {
  return render(
    <WikiPageView
      tenantId="tenant-1"
      userId="user-1"
      type="ENTITY"
      slug="acme"
    />,
  );
}

describe("WikiPageView", () => {
  beforeEach(() => {
    queryResult = { fetching: true };
    linksResult = {
      fetching: false,
      data: { wikiConnectedPages: [], wikiBacklinks: [] },
    };
    navigateMock.mockClear();
  });
  afterEach(cleanup);

  it("shows a loading state until the page resolves", () => {
    queryResult = { fetching: true };
    renderView();
    expect(screen.getByText("Loading page…")).toBeTruthy();
  });

  it("renders identity, summary, aliases, and section content once", () => {
    queryResult = {
      fetching: false,
      data: {
        wikiPage: {
          id: "w1",
          type: "ENTITY",
          slug: "acme",
          title: "Acme Corp",
          summary: "A key customer.",
          // bodyMd repeats the section content — it must NOT be rendered when
          // sections are present (the duplication bug this guards against).
          bodyMd: "## Overview\nBODYMD_ONLY overview text.",
          lastCompiledAt: "2026-07-12T00:00:00.000Z",
          aliases: ["Acme", "ACME Inc"],
          sections: [
            {
              id: "s2",
              heading: "History",
              bodyMd: "Founded 2010.",
              position: 2,
            },
            {
              id: "s1",
              heading: "Overview",
              bodyMd: "Section overview text.",
              position: 1,
            },
          ],
        },
      },
    };
    renderView();

    expect(screen.getByText("Acme Corp")).toBeTruthy();
    expect(screen.getByText("A key customer.")).toBeTruthy();
    expect(screen.getByText("Acme")).toBeTruthy();
    expect(screen.getByText("ACME Inc")).toBeTruthy();
    // Section headings + bodies render as readable text.
    expect(screen.getByText("Overview")).toBeTruthy();
    expect(screen.getByText("Section overview text.")).toBeTruthy();
    expect(screen.getByText("Founded 2010.")).toBeTruthy();
    // bodyMd is NOT rendered when sections exist (no duplication).
    expect(screen.queryByText(/BODYMD_ONLY/)).toBeNull();
    expect(screen.getByTestId("related-memories")).toBeTruthy();
  });

  it("renders sections in ascending position order", () => {
    queryResult = {
      fetching: false,
      data: {
        wikiPage: {
          id: "w1",
          type: "ENTITY",
          slug: "acme",
          title: "Acme Corp",
          sections: [
            { id: "s2", heading: "Second", bodyMd: "b", position: 2 },
            { id: "s1", heading: "First", bodyMd: "a", position: 1 },
          ],
        },
      },
    };
    renderView();
    const headings = screen.getAllByRole("heading", { level: 2 });
    expect(headings.map((h) => h.textContent)).toEqual(["First", "Second"]);
  });

  it("renders a Relationships section as source/target badges", () => {
    queryResult = {
      fetching: false,
      data: {
        wikiPage: {
          id: "w1",
          type: "ENTITY",
          slug: "acme",
          title: "Acme Corp",
          sections: [
            {
              id: "s1",
              heading: "Relationships",
              bodyMd: "- McPherson Oil — has opportunity — Discovery Deal",
              position: 1,
            },
          ],
        },
      },
    };
    renderView();
    // Both endpoints render as node badges (relationship parse + badge path).
    expect(screen.getByText("McPherson Oil")).toBeTruthy();
    expect(screen.getByText("Discovery Deal")).toBeTruthy();
  });

  it("falls back to the raw body only when there are no sections", () => {
    queryResult = {
      fetching: false,
      data: {
        wikiPage: {
          id: "w1",
          type: "ENTITY",
          slug: "acme",
          title: "Acme Corp",
          bodyMd: "Only a raw body here.",
          sections: [],
        },
      },
    };
    renderView();
    expect(screen.getByText("Only a raw body here.")).toBeTruthy();
  });

  it("shows an archived/unavailable message when the page is missing", () => {
    queryResult = { fetching: false, data: { wikiPage: null } };
    renderView();
    expect(screen.getByText(/couldn't be loaded/)).toBeTruthy();
  });

  const RENDER_HTML =
    "<!DOCTYPE html><html><head><title>Acme</title></head><body><h1>Acme plate</h1></body></html>";

  it("keeps native section controls when renderHtml is present", () => {
    queryResult = {
      fetching: false,
      data: {
        wikiPage: {
          id: "w1",
          type: "ENTITY",
          slug: "acme",
          title: "Acme Corp",
          summary: "A key customer.",
          renderHtml: RENDER_HTML,
          aliases: ["Acme"],
          sections: [
            {
              id: "s1",
              heading: "Overview",
              bodyMd: "SECTION_ONLY overview text.",
              position: 1,
            },
          ],
        },
      },
    };
    renderView();

    expect(screen.queryByTestId("document-frame")).toBeNull();
    expect(screen.getByText("Overview")).toBeTruthy();
    expect(screen.getByText("SECTION_ONLY overview text.")).toBeTruthy();
    expect(screen.getByText("Acme Corp")).toBeTruthy();
    expect(screen.getByText("A key customer.")).toBeTruthy();
    expect(screen.getByText("Acme")).toBeTruthy();
    expect(screen.getByTestId("related-memories")).toBeTruthy();
  });

  // THINK-270 repair regression: a relationship badge whose label matches a
  // known connected/backlink page must SPA-navigate to that page. On the
  // pre-repair reader every badge was a disabled dead end.
  describe("relationship navigation", () => {
    const pageWithRelationship = (relationshipLine: string) => ({
      fetching: false,
      data: {
        wikiPage: {
          id: "w1",
          type: "ENTITY",
          slug: "restaurant-les-pecheurs",
          title: "Restaurant Les Pêcheurs",
          sections: [
            {
              id: "s1",
              heading: "Relationships",
              bodyMd: relationshipLine,
              position: 1,
            },
          ],
        },
      },
    });

    it("navigates to a known connected-page target on click", () => {
      queryResult = pageWithRelationship(
        "- Restaurant Les Pêcheurs — head chef — Chef Nicolas Rondelli",
      );
      linksResult = {
        fetching: false,
        data: {
          wikiConnectedPages: [
            {
              id: "w2",
              type: "ENTITY",
              slug: "chef-nicolas-rondelli",
              title: "Chef Nicolas Rondelli",
              aliases: [],
            },
          ],
          wikiBacklinks: [],
        },
      };
      renderView();

      const badge = screen
        .getByText("Chef Nicolas Rondelli")
        .closest("button")!;
      expect(badge.disabled).toBe(false);
      fireEvent.click(badge);
      expect(navigateMock).toHaveBeenCalledWith({
        to: "/wiki/$type/$slug",
        params: { type: "entity", slug: "chef-nicolas-rondelli" },
      });
    });

    it("matches backlink pages by alias", () => {
      queryResult = pageWithRelationship(
        "- Restaurant Les Pêcheurs — reviewed by — The Michelin Guide",
      );
      linksResult = {
        fetching: false,
        data: {
          wikiConnectedPages: [],
          wikiBacklinks: [
            {
              id: "w3",
              type: "TOPIC",
              slug: "michelin-guide",
              title: "Michelin Guide",
              aliases: ["The Michelin Guide"],
            },
          ],
        },
      };
      renderView();

      const badge = screen.getByText("The Michelin Guide").closest("button")!;
      expect(badge.disabled).toBe(false);
      fireEvent.click(badge);
      expect(navigateMock).toHaveBeenCalledWith({
        to: "/wiki/$type/$slug",
        params: { type: "topic", slug: "michelin-guide" },
      });
    });

    it("keeps the current page and unknown labels inert", () => {
      queryResult = pageWithRelationship(
        "- Restaurant Les Pêcheurs — head chef — Somebody Unknown",
      );
      linksResult = {
        fetching: false,
        data: {
          wikiConnectedPages: [
            // The current page itself must stay inert even though it appears
            // in the link results.
            {
              id: "w1",
              type: "ENTITY",
              slug: "restaurant-les-pecheurs",
              title: "Restaurant Les Pêcheurs",
              aliases: [],
            },
          ],
          wikiBacklinks: [],
        },
      };
      renderView();

      // The page title renders in both the <h1> and the source badge; pick
      // the badge (the only match inside a button).
      const source = screen
        .getAllByText("Restaurant Les Pêcheurs")
        .map((el) => el.closest("button"))
        .find(Boolean)!;
      const target = screen.getByText("Somebody Unknown").closest("button")!;
      expect(source.disabled).toBe(true);
      expect(target.disabled).toBe(true);
      fireEvent.click(source);
      fireEvent.click(target);
      expect(navigateMock).not.toHaveBeenCalled();
    });
  });
});
