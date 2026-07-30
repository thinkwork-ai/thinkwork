import { afterEach, describe, expect, it, vi } from "vitest";
import {
  documentViewerHref,
  isSignedDocLink,
  openKnowledgeDocument,
  opensInDocumentViewer,
} from "./knowledge-doc-viewer";

const DOC_LINK =
  "https://mcp.brain.example/kb/doc?key=evidence%2Facme%2Fhr%2Fdocuments%2FHandbook.docx&exp=1800000000&sig=abc123";

describe("opensInDocumentViewer", () => {
  it("routes Office formats and csv to the viewer", () => {
    for (const key of [
      "hr/Handbook.docx",
      "old.doc",
      "sheet.XLSX",
      "sheet.xls",
      "deck.pptx",
      "deck.ppt",
      "table.csv",
    ]) {
      expect(opensInDocumentViewer(key)).toBe(true);
    }
  });

  it("leaves natively-renderable formats on the raw link", () => {
    for (const key of ["a.pdf", "b.txt", "c.md", "d.html", "e.json", "noext"]) {
      expect(opensInDocumentViewer(key)).toBe(false);
    }
  });
});

describe("isSignedDocLink", () => {
  it("accepts the signed /kb/doc shape", () => {
    expect(isSignedDocLink(DOC_LINK)).toBe(true);
  });

  it("accepts loopback http for local dev servers only", () => {
    expect(
      isSignedDocLink("http://localhost:3000/kb/doc?key=k&exp=1&sig=s"),
    ).toBe(true);
    expect(
      isSignedDocLink("http://mcp.brain.example/kb/doc?key=k&exp=1&sig=s"),
    ).toBe(false);
  });

  it("rejects other paths, missing params, and junk", () => {
    expect(
      isSignedDocLink("https://mcp.brain.example/kb?key=k&exp=1&sig=s"),
    ).toBe(false);
    expect(isSignedDocLink("https://mcp.brain.example/kb/doc?key=k")).toBe(
      false,
    );
    expect(isSignedDocLink("not a url")).toBe(false);
    expect(isSignedDocLink("javascript:alert(1)")).toBe(false);
  });
});

describe("documentViewerHref", () => {
  it("carries src, key, and page as search params", () => {
    const href = documentViewerHref({
      src: DOC_LINK,
      key: "hr/Handbook.docx",
      page: 3,
    });
    expect(href.startsWith("/documents/view?")).toBe(true);
    const params = new URLSearchParams(href.slice(href.indexOf("?") + 1));
    expect(params.get("src")).toBe(DOC_LINK);
    expect(params.get("key")).toBe("hr/Handbook.docx");
    expect(params.get("page")).toBe("3");
  });
});

describe("openKnowledgeDocument", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  function captureOpenedHref(): { href: () => string | undefined } {
    let captured: string | undefined;
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      captured = this.getAttribute("href") ?? undefined;
    });
    return { href: () => captured };
  }

  it("routes an Office document with a signed link to the in-app viewer", () => {
    const opened = captureOpenedHref();
    openKnowledgeDocument({
      key: "hr/Handbook.docx",
      page: 2,
      documentUrl: DOC_LINK,
    });
    expect(opened.href()).toContain("/documents/view?");
    expect(opened.href()).toContain("page=2");
  });

  it("opens native formats via the raw URL with a #page fragment", () => {
    const opened = captureOpenedHref();
    openKnowledgeDocument({
      key: "hr/Policy.pdf",
      page: 4,
      documentUrl: DOC_LINK,
    });
    expect(opened.href()).toBe(`${DOC_LINK}#page=4`);
  });

  it("opens an Office document via the raw URL when the link is not the signed shape", () => {
    const opened = captureOpenedHref();
    openKnowledgeDocument({
      key: "hr/Handbook.docx",
      documentUrl: "https://other.example/files/Handbook.docx",
    });
    expect(opened.href()).toBe("https://other.example/files/Handbook.docx");
  });

  it("throws when the citation carries no URL", () => {
    expect(() => openKnowledgeDocument({ key: "hr/Handbook.docx" })).toThrow(
      /not viewable/,
    );
  });
});
