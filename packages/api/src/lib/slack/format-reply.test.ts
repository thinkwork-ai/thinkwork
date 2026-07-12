import { describe, expect, it } from "vitest";
import { toSlackMrkdwn } from "./format-reply.js";

describe("toSlackMrkdwn", () => {
  it("converts **bold** and __bold__ to *bold*", () => {
    expect(toSlackMrkdwn("a **bold** b")).toBe("a *bold* b");
    expect(toSlackMrkdwn("a __bold__ b")).toBe("a *bold* b");
    expect(toSlackMrkdwn("**bold**")).not.toContain("**");
  });

  it("converts *italic* to _italic_ without mangling bold", () => {
    expect(toSlackMrkdwn("an *italic* word")).toBe("an _italic_ word");
    // Bold must survive the italic pass intact.
    expect(toSlackMrkdwn("**bold** and *italic*")).toBe("*bold* and _italic_");
    // Existing _italic_ stays valid Slack italic.
    expect(toSlackMrkdwn("an _italic_ word")).toBe("an _italic_ word");
  });

  it("converts headings to bold lines", () => {
    expect(toSlackMrkdwn("# Title")).toBe("*Title*");
    expect(toSlackMrkdwn("### Deep heading")).toBe("*Deep heading*");
    expect(toSlackMrkdwn("## Mixed **bold** heading")).toBe(
      "*Mixed *bold* heading*",
    );
    expect(toSlackMrkdwn("### x")).not.toContain("###");
  });

  it("converts unordered bullets to • preserving indentation", () => {
    expect(toSlackMrkdwn("- one")).toBe("• one");
    expect(toSlackMrkdwn("* two")).toBe("• two");
    expect(toSlackMrkdwn("+ three")).toBe("• three");
    expect(toSlackMrkdwn("  - nested")).toBe("  • nested");
  });

  it("keeps ordered lists as 1. lines", () => {
    expect(toSlackMrkdwn("1. first\n2. second")).toBe("1. first\n2. second");
  });

  it("converts markdown links to <url|label>", () => {
    expect(toSlackMrkdwn("see [the report](https://x.test/r)")).toBe(
      "see <https://x.test/r|the report>",
    );
  });

  it("leaves bare URLs untouched", () => {
    expect(toSlackMrkdwn("visit https://x.test/page now")).toBe(
      "visit https://x.test/page now",
    );
  });

  it("keeps inline and fenced code verbatim", () => {
    expect(toSlackMrkdwn("run `npm test` now")).toBe("run `npm test` now");
    const fenced = "```\n**not bold** here\n- not a bullet\n```";
    expect(toSlackMrkdwn(fenced)).toBe(fenced);
  });

  it("keeps blockquotes", () => {
    expect(toSlackMrkdwn("> quoted")).toBe("> quoted");
  });

  it("converts strikethrough ~~x~~ to ~x~", () => {
    expect(toSlackMrkdwn("this ~~gone~~ now")).toBe("this ~gone~ now");
  });

  it("escapes raw &, <, > in text but not in generated links", () => {
    expect(toSlackMrkdwn("a & b < c > d")).toBe("a &amp; b &lt; c &gt; d");
    // The link syntax we emit is not escaped.
    expect(toSlackMrkdwn("[a & b](https://x.test)")).toBe(
      "<https://x.test|a &amp; b>",
    );
  });

  it("does not corrupt plain text containing spaced digits", () => {
    // Regression: the internal stash sentinel must not collide with content
    // like " 3 ".
    expect(toSlackMrkdwn("I have 3 apples and 2 pears")).toBe(
      "I have 3 apples and 2 pears",
    );
  });

  it("converts a GFM table to readable bullet lines", () => {
    const table = [
      "| Name | Stage |",
      "|------|-------|",
      "| Acme | Won |",
      "| Globex | Lost |",
    ].join("\n");
    const result = toSlackMrkdwn(table);
    expect(result).toBe(
      "*Name*  —  *Stage*\n• Acme  —  Won\n• Globex  —  Lost",
    );
    expect(result).not.toContain("|");
    expect(result).not.toContain("---");
  });

  it("converts a realistic CRM report without leaking markdown control chars", () => {
    const input = [
      "# Weekly CRM Report",
      "",
      "## Highlights",
      "- Closed **Acme** deal",
      "- Pipeline grew by *12%*",
      "",
      "### Deals",
      "| Account | Owner | Status |",
      "|---------|-------|--------|",
      "| Acme | Sam | Won |",
      "| Globex | Lee | Open |",
      "",
      "See the [full dashboard](https://crm.test/dash) for details.",
    ].join("\n");

    const result = toSlackMrkdwn(input);

    expect(result).not.toContain("**");
    expect(result).not.toContain("###");
    expect(result).not.toContain("|---");
    expect(result).not.toContain("| Account |");
    expect(result).toContain("*Weekly CRM Report*");
    expect(result).toContain("*Highlights*");
    expect(result).toContain("• Closed *Acme* deal");
    expect(result).toContain("• Pipeline grew by _12%_");
    expect(result).toContain("*Account*  —  *Owner*  —  *Status*");
    expect(result).toContain("• Acme  —  Sam  —  Won");
    expect(result).toContain("<https://crm.test/dash|full dashboard>");
  });
});
