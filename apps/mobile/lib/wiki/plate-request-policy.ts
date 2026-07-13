/**
 * Navigation policy for the wiki plate WebView (THINK-275, parent KTD7).
 *
 * The compiled plate render is shown in a scriptless WebView with a
 * synthetic `baseUrl` so root-relative hrefs resolve into absolute URLs
 * that fire interceptable load requests (without a baseUrl they resolve
 * against `about:blank` and taps never produce a request at all). The
 * screen's `onShouldStartLoadWithRequest` is a thin adapter over
 * `decidePlateRequest`, which maps every request URL to exactly one of:
 *
 * - `allow` — the initial document load (`about:*` or the synthetic base
 *   document itself); the WebView proceeds.
 * - `push`  — a `/wiki/<type>/<slug>` link; the load is cancelled and the
 *   returned native route is pushed (uppercase type segment, as the
 *   mobile router requires).
 * - `block` — everything else (external URLs, mailto, malformed wiki
 *   paths); the load is cancelled and nothing happens.
 */

/**
 * Synthetic, non-routable origin used as the WebView `baseUrl`. The value
 * itself never resolves anywhere — it only exists so relative hrefs
 * produce absolute URLs we can intercept.
 */
export const WIKI_PLATE_BASE_URL = "https://wiki.thinkwork.internal/";

/**
 * originWhitelist for the plate WebView. The initial document URL *is*
 * the synthetic base once `baseUrl` is set, so the artifacts reader's
 * `about:*`-only whitelist would punt the initial load to the OS browser
 * (parent KTD6). Request-level gating stays in `decidePlateRequest`.
 */
export const WIKI_PLATE_ORIGIN_WHITELIST = [
  "about:*",
  "https://wiki.thinkwork.internal*",
];

/**
 * Extract `{ type, slug }` from a wiki link. Accepts both relative
 * `/wiki/…` paths and absolute URLs pointing at any host; anything not
 * shaped like `/wiki/<type>/<slug>` returns null.
 *
 * The api writes page types in lowercase (`entity`); the mobile router
 * expects uppercase (`ENTITY`). We normalise here so link bodies don't
 * have to track that.
 */
export function extractWikiPath(
  url: string,
): { type: string; slug: string } | null {
  let pathOnly = url;
  try {
    // Absolute URL (has a scheme)
    const parsed = new URL(url);
    pathOnly = parsed.pathname;
  } catch {
    // Not a valid URL — treat as a path.
  }
  const m = pathOnly.match(/^\/wiki\/([^/]+)\/([^/?#]+)/);
  if (!m) return null;
  const typeRaw = decodeURIComponent(m[1] ?? "").toLowerCase();
  const slug = decodeURIComponent(m[2] ?? "");
  const type =
    typeRaw === "entity"
      ? "ENTITY"
      : typeRaw === "topic"
        ? "TOPIC"
        : typeRaw === "decision"
          ? "DECISION"
          : null;
  if (!type || !slug) return null;
  return { type, slug };
}

export type PlateRequestDecision =
  { action: "allow" } | { action: "push"; route: string } | { action: "block" };

/**
 * Decide what the plate WebView should do with a load request. Pure —
 * performs no navigation; the screen adapts `push` into `router.push`
 * with the current userId param.
 */
export function decidePlateRequest(url: string): PlateRequestDecision {
  // Initial/internal loads of the source document itself.
  if (url.startsWith("about:")) return { action: "allow" };

  const wikiPath = extractWikiPath(url);
  if (wikiPath) {
    return {
      action: "push",
      route: `/wiki/${encodeURIComponent(wikiPath.type)}/${encodeURIComponent(wikiPath.slug)}`,
    };
  }

  // The synthetic base document itself (what WKWebView reports as the
  // request URL for the initial `source={{ html, baseUrl }}` load).
  try {
    const parsed = new URL(url);
    const base = new URL(WIKI_PLATE_BASE_URL);
    if (parsed.origin === base.origin && parsed.pathname === "/") {
      return { action: "allow" };
    }
  } catch {
    // Unparseable → block below.
  }

  return { action: "block" };
}
