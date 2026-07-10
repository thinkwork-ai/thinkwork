/**
 * JSONB-safe text previews (THINK-246 live incident).
 *
 * `text.slice(0, n)` operates on UTF-16 code units and can cut a surrogate
 * pair in half. `JSON.stringify` escapes the resulting lone surrogate as an
 * ASCII `\ud83d`-style sequence — which the Postgres jsonb parser REJECTS
 * with `invalid input syntax for type json`. Observed live on TEI: an
 * automation run finalized its document, then died writing
 * `output_summary.responsePreview` because the 1,000-char slice landed in
 * the middle of an emoji in the model's response.
 *
 * (Plain `text` columns are unaffected: the driver utf8-encodes lone
 * surrogates to U+FFFD on the wire. Only strings destined for json/jsonb
 * values — or any payload that gets JSON.stringify'd and parsed by a strict
 * parser — need this.)
 */
export function jsonSafePreview(text: string, maxLength: number): string {
  let out = text.length > maxLength ? text.slice(0, maxLength) : text;
  // Drop a trailing high surrogate left by the cut, then any remaining
  // unpaired surrogates anywhere in the text (degenerate model output can
  // contain them outright — THINK-244).
  out = out
    .replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/g, "")
    .replace(/(^|[^\uD800-\uDBFF])([\uDC00-\uDFFF])/g, "$1");
  return out;
}
