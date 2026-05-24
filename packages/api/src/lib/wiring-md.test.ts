import { describe, expect, it } from "vitest";
import {
  parseWiringMd,
  renderWiringMd,
  slugifyWiringTitle,
} from "./wiring-md.js";

describe("parseWiringMd", () => {
  it("parses a minimal valid WIRING.md suggestion", () => {
    const result = parseWiringMd(`# Wiring suggestions

## Stage 3 Gate
Run this at the stage-three checkpoint.

\`\`\`context-md
| Stage 3 gate | . | skills/finance/SKILL.md |
\`\`\`
`);

    expect(result.warnings).toEqual([]);
    expect(result.suggestions).toEqual([
      {
        id: "stage-3-gate",
        title: "Stage 3 Gate",
        description: "Run this at the stage-three checkpoint.",
        snippet: "| Stage 3 gate | . | skills/finance/SKILL.md |\n",
      },
    ]);
  });

  it("returns multiple suggestions in document order", () => {
    const result = parseWiringMd(`# Wiring suggestions

## First
One.

\`\`\`context-md
first
\`\`\`

## Second
Two.

\`\`\`context-md
second
\`\`\`
`);

    expect(result.suggestions.map((suggestion) => suggestion.id)).toEqual([
      "first",
      "second",
    ]);
    expect(result.suggestions.map((suggestion) => suggestion.snippet)).toEqual([
      "first\n",
      "second\n",
    ]);
  });

  it("round-trips canonical render output byte-identically", () => {
    const canonical = `# Wiring suggestions

## Always-on
Install this skill everywhere.

\`\`\`context-md
| Always-on | . | skills/audit/SKILL.md |
\`\`\`
`;

    expect(renderWiringMd(parseWiringMd(canonical).suggestions)).toBe(
      canonical,
    );
  });

  it("omits H2 sections without context-md fences and reports a warning", () => {
    const result = parseWiringMd(`# Wiring suggestions

## No Fence
Just prose.
`);

    expect(result.suggestions).toEqual([]);
    expect(result.warnings).toEqual([
      expect.objectContaining({
        code: "missing_context_md",
        title: "No Fence",
      }),
    ]);
  });

  it("uses the first context-md fence when a section has multiple", () => {
    const result = parseWiringMd(`# Wiring suggestions

## Choice
Pick one.

\`\`\`context-md
first
\`\`\`

\`\`\`context-md
second
\`\`\`
`);

    expect(result.suggestions[0]?.snippet).toBe("first\n");
    expect(result.warnings).toEqual([
      expect.objectContaining({
        code: "multiple_context_md",
        title: "Choice",
      }),
    ]);
  });

  it("ignores fenced blocks that are not context-md", () => {
    const result = parseWiringMd(`# Wiring suggestions

## Wrong Fence

\`\`\`
plain markdown
\`\`\`
`);

    expect(result.suggestions).toEqual([]);
    expect(result.warnings[0]).toEqual(
      expect.objectContaining({
        code: "missing_context_md",
        title: "Wrong Fence",
      }),
    );
  });

  it("normalizes unicode titles into deterministic kebab ids", () => {
    const result = parseWiringMd(`# Wiring suggestions

## Café Noël

\`\`\`context-md
snippet
\`\`\`
`);

    expect(result.suggestions[0]?.id).toBe("cafe-noel");
    expect(slugifyWiringTitle("支付 流程")).toBe("suggestion");
  });

  it("suffixes duplicate ids in heading order", () => {
    const result = parseWiringMd(`# Wiring suggestions

## Stage Gate
\`\`\`context-md
one
\`\`\`

## Stage Gate!
\`\`\`context-md
two
\`\`\`
`);

    expect(result.suggestions.map((suggestion) => suggestion.id)).toEqual([
      "stage-gate",
      "stage-gate-2",
    ]);
    expect(result.warnings).toEqual([
      expect.objectContaining({
        code: "duplicate_id",
        title: "Stage Gate!",
      }),
    ]);
  });

  it("returns no suggestions for empty input", () => {
    expect(parseWiringMd("")).toEqual({ suggestions: [], warnings: [] });
  });
});

describe("renderWiringMd", () => {
  it("renders multiple suggestions in canonical WIRING.md format", () => {
    expect(
      renderWiringMd(
        [
          {
            id: "alpha",
            title: "Alpha",
            description: "First suggestion.",
            snippet: "alpha row\n",
          },
          {
            id: "beta",
            title: "Beta",
            description: "",
            snippet: "beta row",
          },
        ],
        { heading: "Wiring suggestions for demo" },
      ),
    ).toBe(`# Wiring suggestions for demo

## Alpha
First suggestion.

\`\`\`context-md
alpha row
\`\`\`

## Beta
\`\`\`context-md
beta row
\`\`\`
`);
  });
});
