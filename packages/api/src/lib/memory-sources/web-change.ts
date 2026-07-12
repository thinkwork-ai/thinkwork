/**
 * Web-page change classification (THINK-193 U5).
 *
 * Scraped pages churn cosmetically — "last updated" stamps, view counters,
 * copyright years, nav/footer boilerplate — without the substance changing.
 * `normalizeWebMarkdownForComparison` reduces markdown to its change-stable
 * core; the firecrawl adapter hashes THAT text, so a cosmetic re-scrape
 * produces the same content hash and dedupes at the evidence layer as a
 * visible 'seen' no-op, while the S3 snapshot keeps the full (sanitized)
 * markdown. `classifyWebChange` names the relationship between two raw
 * editions: unchanged | cosmetic | material — only material changes carry
 * new claims.
 */

export type WebChangeKind = "unchanged" | "cosmetic" | "material";

/** Lines that are pure churn: timestamps, counters, legal boilerplate. */
const BOILERPLATE_LINE_RES: readonly RegExp[] = [
  // "Last updated March 3, 2026", "Updated on 2026-03-01", "Generated at …"
  /^(last\s+updated|updated\s+(on|at)|last\s+modified|generated\s+(on|at)|page\s+generated)\b.*$/i,
  // "© 2026 Acme Inc." / "Copyright 2026"
  /^(©|\(c\))\s?.*$/i,
  /^copyright\b.*$/i,
  // "1,234 views", "56 comments", "12 likes"
  /^[\d,.]+\s+(views?|visitors?|comments?|likes?|shares?)$/i,
  // Pure dates/times: "2026-03-01", "March 3, 2026", "03/01/2026 10:00"
  /^\d{4}-\d{2}-\d{2}([ T]\d{2}:\d{2}(:\d{2})?(\.\d+)?(Z|[+-]\d{2}:?\d{2})?)?$/,
  /^\d{1,2}\/\d{1,2}\/\d{2,4}(\s+\d{1,2}:\d{2}(:\d{2})?(\s*[AP]M)?)?$/i,
  /^(january|february|march|april|may|june|july|august|september|october|november|december)\s+\d{1,2},?\s+\d{4}$/i,
  // Bare counters / page numbers.
  /^[\d,.]+$/,
];

function isBoilerplateLine(line: string): boolean {
  return BOILERPLATE_LINE_RES.some((re) => re.test(line));
}

/**
 * PURE: change-normalized comparison text for a markdown page body.
 * Trims and whitespace-collapses every line, drops empty lines, and drops
 * pure date/counter/legal boilerplate lines. Deterministic: the firecrawl
 * evidence content hash is computed over this text, making cosmetic churn
 * an evidence-level dedupe no-op.
 */
export function normalizeWebMarkdownForComparison(markdown: string): string {
  return markdown
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter((line) => line.length > 0 && !isBoilerplateLine(line))
    .join("\n");
}

/**
 * PURE: classify the relationship between two raw markdown editions of the
 * same page. `prev === null` (first sight) is material by definition.
 */
export function classifyWebChange(
  prev: string | null,
  next: string,
): WebChangeKind {
  if (prev === null) return "material";
  if (prev === next) return "unchanged";
  return normalizeWebMarkdownForComparison(prev) ===
    normalizeWebMarkdownForComparison(next)
    ? "cosmetic"
    : "material";
}
