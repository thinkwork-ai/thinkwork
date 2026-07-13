import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let queryResult: {
  data?: unknown;
  fetching?: boolean;
  error?: { message: string };
} = { fetching: true };

vi.mock("urql", () => ({
  useQuery: () => [queryResult, vi.fn()],
}));

vi.mock("@/context/PageHeaderContext", () => ({
  usePageHeaderActions: () => {},
}));

vi.mock("@/components/memory/RelatedMemories", () => ({
  RelatedMemories: () => <div data-testid="related-memories" />,
}));

import { ThemeProvider } from "@thinkwork/ui";
import { WikiPageView } from "./WikiPageView";

function renderView() {
  // ThemeProvider: the plate branch mounts DocumentFrame, which reads the
  // app theme for envelope stamping.
  return render(
    <ThemeProvider>
      <WikiPageView
        tenantId="tenant-1"
        userId="user-1"
        type="ENTITY"
        slug="acme"
      />
    </ThemeProvider>,
  );
}

describe("WikiPageView", () => {
  beforeEach(() => {
    queryResult = { fetching: true };
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

  it("renders the HTML plate through the wiki frame variant when renderHtml is present (R1)", () => {
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

    const frame = screen.getByTestId("document-frame") as HTMLIFrameElement;
    // The wiki variant: relaxed sandbox + base target travel together (KTD3).
    expect(frame.getAttribute("sandbox")).toBe(
      "allow-top-navigation-by-user-activation",
    );
    expect(frame.getAttribute("srcdoc")).toContain('<base target="_top">');
    // Section markup is replaced by the plate, not rendered alongside it.
    expect(screen.queryByText(/SECTION_ONLY/)).toBeNull();
    // Chrome invariance (KTD5): header, summary, aliases, related memories.
    expect(screen.getByText("Acme Corp")).toBeTruthy();
    expect(screen.getByText("A key customer.")).toBeTruthy();
    expect(screen.getByText("Acme")).toBeTruthy();
    expect(screen.getByTestId("related-memories")).toBeTruthy();
  });

  it("renders the plate even when the page has zero sections", () => {
    queryResult = {
      fetching: false,
      data: {
        wikiPage: {
          id: "w1",
          type: "ENTITY",
          slug: "acme",
          title: "Acme Corp",
          renderHtml: RENDER_HTML,
          sections: [],
        },
      },
    };
    renderView();
    expect(screen.getByTestId("document-frame")).toBeTruthy();
  });

  it("keeps the section rendering when renderHtml is null (AE3/R4)", () => {
    queryResult = {
      fetching: false,
      data: {
        wikiPage: {
          id: "w1",
          type: "ENTITY",
          slug: "acme",
          title: "Acme Corp",
          renderHtml: null,
          sections: [
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
    expect(screen.getByText("Overview")).toBeTruthy();
    expect(screen.getByText("Section overview text.")).toBeTruthy();
    expect(screen.queryByTestId("document-frame")).toBeNull();
  });

  it("treats an empty-string renderHtml like null (falsy guard)", () => {
    queryResult = {
      fetching: false,
      data: {
        wikiPage: {
          id: "w1",
          type: "ENTITY",
          slug: "acme",
          title: "Acme Corp",
          renderHtml: "",
          sections: [
            { id: "s1", heading: "Overview", bodyMd: "text", position: 1 },
          ],
        },
      },
    };
    renderView();
    expect(screen.queryByTestId("document-frame")).toBeNull();
    expect(screen.getByText("Overview")).toBeTruthy();
  });
});
