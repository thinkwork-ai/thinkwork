import { describe, expect, it } from "vitest";
import {
  decidePlateRequest,
  extractWikiPath,
  WIKI_PLATE_BASE_URL,
  WIKI_PLATE_ORIGIN_WHITELIST,
} from "./plate-request-policy";

describe("decidePlateRequest", () => {
  it("allows about:blank (initial load)", () => {
    expect(decidePlateRequest("about:blank")).toEqual({ action: "allow" });
  });

  it("allows the synthetic base document itself", () => {
    expect(decidePlateRequest(WIKI_PLATE_BASE_URL)).toEqual({
      action: "allow",
    });
    expect(decidePlateRequest("https://wiki.thinkwork.internal/")).toEqual({
      action: "allow",
    });
  });

  it("pushes an absolute base-origin wiki URL with uppercase type", () => {
    expect(
      decidePlateRequest(
        "https://wiki.thinkwork.internal/wiki/entity/acme-corp",
      ),
    ).toEqual({ action: "push", route: "/wiki/ENTITY/acme-corp" });
  });

  it("pushes a root-relative wiki path resolved against the base origin", () => {
    expect(decidePlateRequest(`${WIKI_PLATE_BASE_URL}wiki/topic/x`)).toEqual({
      action: "push",
      route: "/wiki/TOPIC/x",
    });
    // A still-relative path (not yet resolved by the WebView) also pushes.
    expect(decidePlateRequest("/wiki/topic/x")).toEqual({
      action: "push",
      route: "/wiki/TOPIC/x",
    });
  });

  it("round-trips encoded slug characters through encodeURIComponent", () => {
    expect(
      decidePlateRequest(
        "https://wiki.thinkwork.internal/wiki/decision/q4%20plan",
      ),
    ).toEqual({ action: "push", route: "/wiki/DECISION/q4%20plan" });
  });

  it("still matches a wiki URL with trailing query or hash", () => {
    expect(
      decidePlateRequest(
        "https://wiki.thinkwork.internal/wiki/entity/acme?ref=1",
      ),
    ).toEqual({ action: "push", route: "/wiki/ENTITY/acme" });
    expect(
      decidePlateRequest(
        "https://wiki.thinkwork.internal/wiki/entity/acme#section",
      ),
    ).toEqual({ action: "push", route: "/wiki/ENTITY/acme" });
  });

  it("blocks external URLs", () => {
    expect(decidePlateRequest("https://external.example/page")).toEqual({
      action: "block",
    });
  });

  it("blocks mailto links", () => {
    expect(decidePlateRequest("mailto:a@b.c")).toEqual({ action: "block" });
  });

  it("blocks unknown wiki types", () => {
    expect(
      decidePlateRequest("https://wiki.thinkwork.internal/wiki/bogus-type/x"),
    ).toEqual({ action: "block" });
  });

  it("blocks wiki paths with a missing slug", () => {
    expect(
      decidePlateRequest("https://wiki.thinkwork.internal/wiki/entity/"),
    ).toEqual({ action: "block" });
  });

  it("blocks non-wiki paths on the base origin", () => {
    expect(decidePlateRequest("https://wiki.thinkwork.internal/admin")).toEqual(
      { action: "block" },
    );
  });
});

describe("extractWikiPath (markdown-handler regression)", () => {
  it("matches absolute URLs on any host", () => {
    expect(
      extractWikiPath("https://anything.example/wiki/entity/acme"),
    ).toEqual({ type: "ENTITY", slug: "acme" });
  });

  it("matches relative paths", () => {
    expect(extractWikiPath("/wiki/decision/use-postgres")).toEqual({
      type: "DECISION",
      slug: "use-postgres",
    });
  });

  it("maps lowercase types to the uppercase router form", () => {
    expect(extractWikiPath("/wiki/topic/memory")).toEqual({
      type: "TOPIC",
      slug: "memory",
    });
  });

  it("returns null for non-wiki links", () => {
    expect(extractWikiPath("https://example.com/docs")).toBeNull();
    expect(extractWikiPath("mailto:a@b.c")).toBeNull();
    expect(extractWikiPath("/wiki/entity/")).toBeNull();
    expect(extractWikiPath("/wiki/unknown/slug")).toBeNull();
  });

  it("decodes percent-encoded segments", () => {
    expect(extractWikiPath("/wiki/entity/acme%20corp")).toEqual({
      type: "ENTITY",
      slug: "acme corp",
    });
  });
});

describe("WIKI_PLATE_ORIGIN_WHITELIST", () => {
  it("admits about:* and the synthetic base origin", () => {
    expect(WIKI_PLATE_ORIGIN_WHITELIST).toContain("about:*");
    const base = new URL(WIKI_PLATE_BASE_URL);
    expect(
      WIKI_PLATE_ORIGIN_WHITELIST.some((p) => p.startsWith(base.origin)),
    ).toBe(true);
  });
});
