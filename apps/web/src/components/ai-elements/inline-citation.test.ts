import { describe, expect, it } from "vitest";
import { linkCitationMarkers } from "./inline-citation";
import {
  knowledgeCitationsFromInvocations,
  knowledgeSourcesFromInvocations,
} from "./sources";
import type { KnowledgeCitation } from "./sources";

const citations = (...ns: number[]) =>
  new Map<number, KnowledgeCitation>(
    ns.map((n) => [n, { n, key: `doc-${n}.pdf`, page: n }]),
  );

describe("linkCitationMarkers", () => {
  it("rewrites a marker the turn actually returned", () => {
    expect(linkCitationMarkers("Add it at the bottom [3].", citations(3))).toBe(
      "Add it at the bottom [3](#thinkwork-cite-3).",
    );
  });

  it("collapses a run of adjacent markers into one pill", () => {
    // Three pills jammed together mid-sentence is unreadable; the trigger
    // shows the first source and a +N count instead.
    expect(linkCitationMarkers("Per the SOPs [1][2][3].", citations(1, 2, 3))).toBe(
      "Per the SOPs [1](#thinkwork-cite-1,2,3).",
    );
  });

  it("collapses a space-separated run too", () => {
    expect(linkCitationMarkers("See [1] [2].", citations(1, 2))).toBe(
      "See [1](#thinkwork-cite-1,2).",
    );
  });

  it("drops unknown markers from a run but keeps the known ones", () => {
    expect(linkCitationMarkers("See [1][9].", citations(1))).toBe(
      "See [1](#thinkwork-cite-1).",
    );
  });

  it("escapes markers the turn never returned so they render as literal text", () => {
    // The model can invent a marker. Left bare, the markdown renderer treats
    // `[9]` as an unfinished link and leaks a visible
    // `](streamdown:incomplete-link)` placeholder into the answer.
    expect(linkCitationMarkers("See [9].", citations(1, 2))).toBe(
      "See \\[9\\].",
    );
  });

  it("leaves an existing markdown link alone", () => {
    const input = "See [3](https://example.com/doc.pdf).";
    expect(linkCitationMarkers(input, citations(3))).toBe(input);
  });

  it("leaves an image alone", () => {
    const input = "![3](https://example.com/a.png)";
    expect(linkCitationMarkers(input, citations(3))).toBe(input);
  });

  it("does not touch markers inside inline code", () => {
    const input = "Use `arr[3]` for the index [3].";
    expect(linkCitationMarkers(input, citations(3))).toBe(
      "Use `arr[3]` for the index [3](#thinkwork-cite-3).",
    );
  });

  it("does not touch markers inside a fenced block", () => {
    const input = "```js\nconst x = arr[2];\n```\n\nSee [2].";
    expect(linkCitationMarkers(input, citations(2))).toBe(
      "```js\nconst x = arr[2];\n```\n\nSee [2](#thinkwork-cite-2).",
    );
  });

  it("rewrites every occurrence of a reused marker", () => {
    expect(linkCitationMarkers("First [1]. Again [1].", citations(1))).toBe(
      "First [1](#thinkwork-cite-1). Again [1](#thinkwork-cite-1).",
    );
  });

  it("is a no-op when the turn cited nothing", () => {
    const input = "Plain answer with [1] in it.";
    expect(linkCitationMarkers(input, new Map())).toBe(input);
  });
});

describe("knowledgeCitationsFromInvocations", () => {
  const invocation = (hits: unknown[]) => ({
    name: "search_knowledge",
    result: { details: { hits } },
  });

  it("reads numbered citations from the structured hits", () => {
    const map = knowledgeCitationsFromInvocations([
      invocation([
        {
          citation: 1,
          documentKey: "cx/files/CX-0215.pdf",
          pageNumber: 1,
          quote: "Always add new code at bottom",
        },
      ]),
    ]);
    expect(map.get(1)).toEqual({
      n: 1,
      key: "cx/files/CX-0215.pdf",
      page: 1,
      quote: "Always add new code at bottom",
    });
  });

  it("keeps numbering across two searches in one turn", () => {
    const map = knowledgeCitationsFromInvocations([
      invocation([{ citation: 1, documentKey: "a.pdf" }]),
      invocation([{ citation: 2, documentKey: "b.pdf" }]),
    ]);
    expect(map.get(1)?.key).toBe("a.pdf");
    expect(map.get(2)?.key).toBe("b.pdf");
  });

  it("keeps the first binding when a marker repeats", () => {
    // The first occurrence is what the model was looking at when it wrote
    // the marker into its answer.
    const map = knowledgeCitationsFromInvocations([
      invocation([{ citation: 1, documentKey: "first.pdf" }]),
      invocation([{ citation: 1, documentKey: "second.pdf" }]),
    ]);
    expect(map.get(1)?.key).toBe("first.pdf");
  });

  it("reads the Pi runner shape: result.content[].text", () => {
    // What production actually emits. The runtime does NOT return
    // `details.hits` — it returns one rendered text block holding every hit,
    // each as a `[n] …` passage followed by an indented `Source:` line. A
    // reader that only understood `details.hits` produced an empty map, and
    // the answer's markers rendered as literal "[1]".
    const map = knowledgeCitationsFromInvocations([
      {
        name: "search_knowledge",
        result: {
          content: [
            {
              text:
                '[1] [CX SOPs] # CX-0215 Setting Up New Reason Code.pdf  _Page 1 of 1_  ' +
                '5. Always add new code at bottom\n' +
                '   Source: cx/files/CX-0215 Setting Up New Reason Code.pdf (page 1)\n\n' +
                '[2] [CX SOPs] Row data (partially visible)\n' +
                '   Source: cx/files/CX-0038A Credit - No Inventory Impact.pdf (page 6)\n',
            },
          ],
        },
      },
    ]);
    expect(map.size).toBe(2);
    expect(map.get(1)).toMatchObject({
      key: "cx/files/CX-0215 Setting Up New Reason Code.pdf",
      page: 1,
    });
    expect(map.get(2)).toMatchObject({
      key: "cx/files/CX-0038A Credit - No Inventory Impact.pdf",
      page: 6,
    });
  });

  it("falls back to the rendered text for ledger-shaped records", () => {
    const map = knowledgeCitationsFromInvocations([
      {
        tool_name: "search_knowledge",
        output_preview:
          "[4] [CX SOPs] Some passage\n   Source: cx/files/CX-0072.pdf (page 7)",
      },
    ]);
    expect(map.get(4)).toMatchObject({ key: "cx/files/CX-0072.pdf", page: 7 });
  });

  it("ignores tools other than search_knowledge", () => {
    expect(
      knowledgeCitationsFromInvocations([
        {
          name: "web_search",
          result: { details: { hits: [{ citation: 1 }] } },
        },
      ]).size,
    ).toBe(0);
  });
});

describe("page-suffix tolerance (older runtimes)", () => {
  it("strips '#p=n' the runtime left on the key and recovers the page", () => {
    // A runtime that predates id-stripping emits the raw page-document id.
    // Left intact it would 404 every presigned lookup.
    const map = knowledgeCitationsFromInvocations([
      {
        name: "search_knowledge",
        result: {
          details: {
            hits: [{ citation: 1, documentKey: "cx/files/CX-0215.pdf#p=1" }],
          },
        },
      },
    ]);
    expect(map.get(1)).toMatchObject({ key: "cx/files/CX-0215.pdf", page: 1 });
  });

  it("strips the suffix in the Sources list too", () => {
    expect(
      knowledgeSourcesFromInvocations([
        {
          tool_name: "search_knowledge",
          output_preview: "[1] passage\n   Source: cx/files/CX-0024.pdf#p=12",
        },
      ]),
    ).toEqual([{ key: "cx/files/CX-0024.pdf", page: 12 }]);
  });
});
