import { describe, expect, it } from "vitest";
import {
  CITATION_HREF_PREFIX,
  citationLabel,
  citationsFromHref,
  isSignedDocLink,
  knowledgeCitationsFromInvocations,
  knowledgeDocumentViewUrl,
  knowledgeSourcesFromInvocations,
  linkCitationMarkers,
  splitPageDocumentKey,
} from "./knowledge-citations";

const SIGNED_URL =
  "https://brain.thinkwork.ai/kb/doc?key=contracts%2FCX-0215.pdf&exp=1799999999&sig=abc123";

const structuredInvocation = {
  name: "search_knowledge",
  result: {
    details: {
      hits: [
        {
          citation: 1,
          documentKey: "contracts/CX-0215.pdf#p=4",
          quote: "The term is 36 months.",
          documentUrl: SIGNED_URL,
        },
        { citation: 2, documentKey: "hr/handbook.docx", pageNumber: 12 },
      ],
    },
  },
};

const mcpInvocation = {
  name: "mcp_brain_kb_brain_knowl_a1b2",
  result: {
    details: {
      mcp_tool_name: "brain_knowledge_search",
      raw: {
        structuredContent: {
          results: [
            {
              id: "policies/safety.pdf#p=2",
              title: "Safety Policy",
              text: "Hard hats are required in the yard.",
              documentUrl: SIGNED_URL,
            },
          ],
        },
      },
    },
  },
};

const textInvocation = {
  tool_name: "search_knowledge",
  output_preview:
    "[3] Relevant passage…\n" +
    "Source: manuals/forklift.pdf (page 7)\n" +
    "[4] Another passage…\n" +
    "Source: manuals/forklift.pdf (page 9)\n",
};

describe("splitPageDocumentKey", () => {
  it("splits the #p= page suffix off paginated document ids", () => {
    expect(splitPageDocumentKey("a/b.pdf#p=3")).toEqual({
      key: "a/b.pdf",
      page: 3,
    });
    expect(splitPageDocumentKey("a/b.pdf")).toEqual({ key: "a/b.pdf" });
  });
});

describe("knowledgeCitationsFromInvocations", () => {
  it("reads structured Pi-runner hits with page/quote/url", () => {
    const citations = knowledgeCitationsFromInvocations([structuredInvocation]);
    expect(citations.get(1)).toMatchObject({
      key: "contracts/CX-0215.pdf",
      page: 4,
      quote: "The term is 36 months.",
      documentUrl: SIGNED_URL,
    });
    expect(citations.get(2)).toMatchObject({
      key: "hr/handbook.docx",
      page: 12,
    });
  });

  it("numbers MCP knowledge rows by 1-based index", () => {
    const citations = knowledgeCitationsFromInvocations([mcpInvocation]);
    expect(citations.get(1)).toMatchObject({
      key: "policies/safety.pdf",
      page: 2,
      documentUrl: SIGNED_URL,
    });
    expect(citations.get(1)?.quote).toContain("Hard hats");
  });

  it("falls back to parsing rendered text markers", () => {
    const citations = knowledgeCitationsFromInvocations([textInvocation]);
    expect(citations.get(3)).toMatchObject({
      key: "manuals/forklift.pdf",
      page: 7,
    });
    expect(citations.get(4)).toMatchObject({ page: 9 });
  });

  it("keeps the first occurrence of a marker authoritative", () => {
    const second = {
      name: "search_knowledge",
      result: {
        details: {
          hits: [{ citation: 1, documentKey: "other/late.pdf" }],
        },
      },
    };
    const citations = knowledgeCitationsFromInvocations([
      structuredInvocation,
      second,
    ]);
    expect(citations.get(1)?.key).toBe("contracts/CX-0215.pdf");
  });
});

describe("knowledgeSourcesFromInvocations", () => {
  it("dedupes documents, first citation wins the page", () => {
    const sources = knowledgeSourcesFromInvocations([textInvocation]);
    expect(sources).toEqual([{ key: "manuals/forklift.pdf", page: 7 }]);
  });

  it("prefers structured hits and keeps their documentUrl", () => {
    const sources = knowledgeSourcesFromInvocations([structuredInvocation]);
    expect(sources[0]).toMatchObject({
      key: "contracts/CX-0215.pdf",
      page: 4,
      documentUrl: SIGNED_URL,
    });
    expect(sources).toHaveLength(2);
  });
});

describe("linkCitationMarkers", () => {
  const citations = knowledgeCitationsFromInvocations([structuredInvocation]);

  it("rewrites known markers into fragment links", () => {
    expect(linkCitationMarkers("Term is 36 months [1].", citations)).toBe(
      `Term is 36 months [1](${CITATION_HREF_PREFIX}1).`,
    );
  });

  it("collapses a run of markers into one link", () => {
    expect(linkCitationMarkers("See [1][2].", citations)).toBe(
      `See [1](${CITATION_HREF_PREFIX}1,2).`,
    );
  });

  it("escapes unresolvable markers instead of leaving them bare", () => {
    expect(linkCitationMarkers("Maybe [9].", citations)).toBe("Maybe \\[9\\].");
  });

  it("leaves code spans and existing links untouched", () => {
    const md = "Use `arr[1]` and [1](https://example.com).";
    expect(linkCitationMarkers(md, citations)).toBe(md);
  });
});

describe("citationsFromHref", () => {
  it("resolves the comma-joined numbers back to citations", () => {
    const citations = knowledgeCitationsFromInvocations([structuredInvocation]);
    const resolved = citationsFromHref(
      `${CITATION_HREF_PREFIX}1,2`,
      citations,
    );
    expect(resolved.map((c) => c.n)).toEqual([1, 2]);
    expect(citationsFromHref("https://example.com", citations)).toEqual([]);
  });
});

describe("citationLabel", () => {
  it("names the file without extension, with page", () => {
    expect(
      citationLabel({ n: 1, key: "contracts/CX-0215.pdf", page: 4 }),
    ).toBe("CX-0215 · p.4");
    expect(citationLabel({ n: 2, key: "hr/handbook.docx" })).toBe("handbook");
  });
});

describe("isSignedDocLink (Hermes-safe, no new URL())", () => {
  it("accepts the signed /kb/doc shape", () => {
    expect(isSignedDocLink(SIGNED_URL)).toBe(true);
    expect(
      isSignedDocLink("http://localhost:8080/kb/doc?key=a&exp=1&sig=b"),
    ).toBe(true);
  });

  it("rejects other shapes", () => {
    expect(isSignedDocLink("http://brain.thinkwork.ai/kb/doc?key=a&exp=1&sig=b")).toBe(false);
    expect(isSignedDocLink("https://brain.thinkwork.ai/kb/doc?key=a&exp=1")).toBe(false);
    expect(isSignedDocLink("https://brain.thinkwork.ai/other?key=a&exp=1&sig=b")).toBe(false);
    expect(isSignedDocLink("not a url")).toBe(false);
  });
});

describe("knowledgeDocumentViewUrl", () => {
  it("appends the page fragment and requires a documentUrl", () => {
    expect(
      knowledgeDocumentViewUrl({
        key: "a.pdf",
        page: 4,
        documentUrl: SIGNED_URL,
      }),
    ).toBe(`${SIGNED_URL}#page=4`);
    expect(knowledgeDocumentViewUrl({ key: "a.pdf" })).toBeNull();
  });
});
