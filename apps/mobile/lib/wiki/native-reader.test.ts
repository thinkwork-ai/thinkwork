import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * THINK-270 repair regression: the wiki reader is native-only. Operator
 * verification rejected the compiled-HTML plate reader (WebView) as
 * redundant and less useful than the native sections/relationships
 * presentation, so the screen must render Markdown sections natively and
 * never mount a WebView for wiki pages. The backend keeps generating and
 * serving `WikiPage.renderHtml` for explicit GraphQL consumers — the
 * mobile detail query just must not request it.
 *
 * Mobile vitest runs in a node environment with no component-render
 * harness, so this is a source/query tripwire rather than a mount test:
 * it fails on the plate-reader implementation (WebView import,
 * `renderHtml` usage) and passes on the native reader.
 */

const screenSource = readFileSync(
  join(__dirname, "..", "..", "app", "wiki", "[type]", "[slug].tsx"),
  "utf8",
);

const sdkQuerySource = readFileSync(
  join(
    __dirname,
    "..",
    "..",
    "..",
    "..",
    "packages",
    "react-native-sdk",
    "src",
    "graphql",
    "queries.ts",
  ),
  "utf8",
);

describe("wiki reader stays native (THINK-270 repair)", () => {
  it("mounts no WebView on the wiki screen", () => {
    expect(screenSource).not.toContain("react-native-webview");
    expect(screenSource).not.toMatch(/<WebView/);
  });

  it("ignores renderHtml on the wiki screen", () => {
    expect(screenSource).not.toContain("renderHtml");
  });

  it("keeps native Markdown section rendering", () => {
    expect(screenSource).toContain("react-native-markdown-display");
    expect(screenSource).toMatch(/page\.sections\.map/);
  });

  it("keeps native wiki-link routing on Markdown link taps", () => {
    expect(screenSource).toContain("buildWikiLinkHandler");
    expect(screenSource).toContain("extractWikiPath");
    expect(screenSource).toMatch(/onLinkPress/);
  });

  it("does not request renderHtml in the SDK wiki page detail query", () => {
    const wikiPageQuery = sdkQuerySource.slice(
      sdkQuerySource.indexOf("export const WikiPageQuery"),
      sdkQuerySource.indexOf(
        "export const",
        sdkQuerySource.indexOf("export const WikiPageQuery") + 1,
      ),
    );
    expect(wikiPageQuery).toContain("query WikiPage");
    expect(wikiPageQuery).not.toContain("renderHtml");
  });
});
