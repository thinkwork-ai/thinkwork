/**
 * Best-effort sanitization of a tenant applet theme CSS string before it is
 * persisted/served. This is **defense-in-depth + legacy-data cleanup**, NOT the
 * sole gate: the authoritative control is the client allowlist parser
 * `parseShadcnThemeCss` (apps/web/src/applets/theme-tokens.ts), which emits
 * only allowlisted `--token: value` pairs (strict name regex + value denylist +
 * length cap) applied via `setProperty` inside a cross-origin sandboxed iframe.
 * The raw CSS string is never injected into a `<style>`/innerHTML sink. Do not
 * drop the client allowlist on the assumption that this server strip is
 * complete — it is intentionally simple and a determined caller can still slip
 * exotic constructs (e.g. CSS unicode escapes) past it, which the client
 * allowlist then rejects.
 *
 * Strips CSS comments first (so they can't split a keyword), then removes
 * `@import` at-rules and any declaration whose value carries a network/behavior
 * vector. Pure + leaf so it is unit-testable without loading the resolver/db
 * graph.
 */
const DANGEROUS_VALUE =
  "url\\s*\\(|image-set\\s*\\(|-webkit-image-set\\s*\\(|element\\s*\\(|cross-fade\\s*\\(|expression\\s*\\(|javascript:";

export function sanitizeAppletThemeCss(css: string): string {
  return css
    .replace(/\/\*[\s\S]*?\*\//g, "") // drop comments so they can't split keywords
    .replace(/@import[^;]*;/gi, "")
    .replace(
      new RegExp(`[^;{}]*:[^;{}]*(?:${DANGEROUS_VALUE})[^;{}]*;?`, "gi"),
      "",
    );
}
