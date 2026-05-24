import { describe, expect, it } from "vitest";
import { renderForEmail } from "./email-renderer.js";

describe("renderForEmail — happy paths", () => {
  it("renders a paragraph with bold inline", () => {
    const { html, text } = renderForEmail("Hello **world**.");
    expect(html).toContain("<p");
    expect(html).toContain("<strong>world</strong>");
    expect(text).toBe("Hello **world**.");
  });

  it("renders a GFM pipe table with header + body rows", () => {
    const md = [
      "| A | B | C |",
      "|---|---|---|",
      "| 1 | 2 | 3 |",
      "| 4 | 5 | 6 |",
    ].join("\n");
    const { html } = renderForEmail(md);
    expect(html).toContain("<table");
    expect(html).toContain("border-collapse:collapse");
    expect(html).toContain("<thead>");
    expect(html).toContain("<tbody>");
    expect((html.match(/<th[\s>]/g) ?? []).length).toBe(3);
    expect((html.match(/<td[\s>]/g) ?? []).length).toBe(6);
    expect(html).not.toContain("|");
  });

  it("renders a fenced code block without showing the language hint or backticks", () => {
    const md = "```ts\nconst x = 1;\n```";
    const { html } = renderForEmail(md);
    expect(html).toContain("<pre");
    expect(html).toContain("<code>");
    expect(html).toContain("const x = 1;");
    expect(html).not.toContain("```");
  });

  it("renders 2-level nested lists structurally", () => {
    const md = ["- outer", "  1. inner one", "  2. inner two"].join("\n");
    const { html } = renderForEmail(md);
    // Outer ul contains an inner ol
    expect(html).toMatch(/<ul[\s\S]*?<ol[\s\S]*?<\/ol>[\s\S]*?<\/ul>/);
    expect(html).toContain("inner one");
    expect(html).toContain("inner two");
  });

  it("renders 4-level nested lists structurally (guards renderer hardcoding)", () => {
    const md = [
      "- level 1",
      "    - level 2",
      "        - level 3",
      "            - level 4",
    ].join("\n");
    const { html } = renderForEmail(md);
    // Four <ul> opens — nested all the way down
    expect((html.match(/<ul/g) ?? []).length).toBeGreaterThanOrEqual(4);
    expect(html).toContain("level 4");
  });

  it("renders a blockquote", () => {
    const { html } = renderForEmail("> quoted line");
    expect(html).toContain("<blockquote");
    expect(html).toContain("border-left:3px solid");
    expect(html).toContain("quoted line");
  });

  it("renders the full heading hierarchy", () => {
    const md = [
      "# h1",
      "## h2",
      "### h3",
      "#### h4",
      "##### h5",
      "###### h6",
    ].join("\n\n");
    const { html } = renderForEmail(md);
    for (const level of [1, 2, 3, 4, 5, 6]) {
      expect(html).toContain(`<h${level}`);
      expect(html).toContain(`</h${level}>`);
    }
  });

  it("renders mixed inline formatting in a single paragraph", () => {
    const { html } = renderForEmail(
      "This is **bold** and *italic* with `code` and a [link](https://example.com).",
    );
    expect(html).toContain("<strong>bold</strong>");
    expect(html).toContain("<em>italic</em>");
    expect(html).toContain("<code");
    expect(html).toContain("code</code>");
    expect(html).toContain('href="https://example.com"');
  });

  it("renders an image with allowed https src", () => {
    const { html } = renderForEmail(
      "![alt text](https://cdn.example.com/pic.png)",
    );
    expect(html).toContain('<img src="https://cdn.example.com/pic.png"');
    expect(html).toContain('alt="alt text"');
    expect(html).toContain("max-width:600px");
  });
});

describe("renderForEmail — edges", () => {
  it("returns benign result on empty input", () => {
    const result = renderForEmail("");
    expect(result.html).toBe("");
    expect(result.text).toBe("");
  });

  it("escapes literal < and > in agent markdown", () => {
    const md = "use the `<picture>` tag or a literal > arrow";
    const { html, text } = renderForEmail(md);
    // Literal < should not appear unescaped in non-tag context (after sanitize)
    expect(html).toContain("&gt;"); // the bare > becomes &gt;
    expect(text).toBe(md);
  });
});

describe("renderForEmail — text fallback parity (R5)", () => {
  it("text field equals input verbatim across corpus", () => {
    const corpus = [
      "plain paragraph",
      "# heading",
      "| a | b |\n|---|---|\n| 1 | 2 |",
      "```\ncode\n```",
      "- list\n- items",
      "> quote",
      "![img](https://example.com/x.png)",
      "",
    ];
    for (const md of corpus) {
      expect(renderForEmail(md).text).toBe(md);
    }
  });
});

describe("renderForEmail — XSS sanitization (R12)", () => {
  it("strips javascript: href but keeps link text", () => {
    const { html } = renderForEmail("[click here](javascript:alert(1))");
    expect(html).not.toContain("javascript:");
    expect(html).not.toMatch(/href="javascript/i);
    expect(html).toContain("click here");
  });

  it("strips data: image src (data:text/html attack)", () => {
    const { html } = renderForEmail(
      "![pixel](data:text/html,<script>alert(1)</script>)",
    );
    expect(html).not.toContain("data:");
    expect(html).not.toContain("<script");
    // Renderer falls back to alt as plain text
    expect(html).toContain("pixel");
  });

  it("strips raw <script> blocks emitted by the agent", () => {
    const { html } = renderForEmail("hi\n\n<script>alert(1)</script>\n\nbye");
    expect(html).not.toContain("<script");
    expect(html).not.toContain("alert(1)");
    expect(html).toContain("hi");
    expect(html).toContain("bye");
  });

  it("strips on* event handlers from raw HTML", () => {
    const { html } = renderForEmail(
      '<a href="https://x.com" onclick="alert(1)">x</a>',
    );
    expect(html).not.toMatch(/onclick/i);
  });

  it("strips entire <svg> namespace block", () => {
    const { html } = renderForEmail(
      'before\n\n<svg><use href="javascript:alert(1)" /></svg>\n\nafter',
    );
    expect(html).not.toContain("<svg");
    expect(html).not.toContain("<use");
    expect(html).not.toContain("javascript:");
    expect(html).toContain("before");
    expect(html).toContain("after");
  });

  it("strips <math> MathML namespace block", () => {
    const { html } = renderForEmail(
      "before\n\n<math><mtext><script>alert(1)</script></mtext></math>\n\nafter",
    );
    expect(html).not.toContain("<math");
    expect(html).not.toContain("<mtext");
    expect(html).not.toContain("<script");
    expect(html).toContain("before");
    expect(html).toContain("after");
  });

  it("strips <iframe>", () => {
    const { html } = renderForEmail(
      'safe text\n\n<iframe src="https://attacker.example"></iframe>',
    );
    expect(html).not.toContain("<iframe");
  });

  it("strips <style> blocks (CSS injection vector)", () => {
    const { html } = renderForEmail(
      "safe\n\n<style>body{background:url(javascript:alert(1))}</style>",
    );
    expect(html).not.toContain("<style");
  });
});
