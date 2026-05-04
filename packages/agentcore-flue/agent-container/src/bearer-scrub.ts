/**
 * Plan §005 U16 — bearer-shape scrubbing primitives.
 *
 * Egress-side defense for FR-3a / FR-4a: response bodies returned from
 * MCP servers (and any other text bound for logs / SessionStore) must
 * not carry user-bearer strings. Two redaction layers:
 *
 *   1. Regex scrub for the standard `Bearer <token>` header form
 *      (matches the OAuth 2.0 RFC 6750 wire format the SDK transport
 *      emits and that any well-formed MCP server would echo back).
 *   2. Literal-string scrub for the active session's bearer when
 *      supplied — catches reflected-bearer attacks that omit the
 *      `Bearer ` prefix or use a non-standard scheme.
 *
 * The primitive deliberately stays pure (no I/O, no side effects) so
 * `scrubbing-fetch.ts` and the structured logger can both call it. Per-
 * call cost is two `String.prototype.replace` passes; the regex compiles
 * once.
 */

/** OAuth 2.0 / RFC 6750 Bearer header shape. Matches `Bearer ` + 20+ chars
 *  drawn from the RFC 6750 `token68` grammar (`A-Z` / `a-z` / `0-9` /
 *  `-` / `.` / `_` / `~` / `+` / `/` plus optional `=` padding). Common
 *  bearer formats covered: standard JWTs (`A-Za-z0-9._-`), base64-padded
 *  JWTs (adds `=`), and Okta / Cognito opaque tokens (uses `+` and `/`).
 *  20 chars is the conservative floor used by major IdPs (Auth0, Okta,
 *  Google) — long enough to avoid matching legitimate prose like
 *  `Bearer with me a moment`. */
const BEARER_HEADER_PATTERN = /Bearer [A-Za-z0-9._~+/=-]{20,}/g;
const REDACTED = "Bearer [REDACTED]";

/**
 * Replaces every `Bearer <token>` occurrence with `Bearer [REDACTED]`,
 * and (when `activeBearer` is provided) every literal occurrence of
 * the bearer value with `[REDACTED]`.
 *
 * `activeBearer` should be the raw token value the trusted handler
 * resolved from a HandleStore for this request; supplying it catches
 * reflected-bearer cases where the upstream server echoed the token
 * back with no `Bearer ` prefix or under a custom scheme.
 *
 * Both layers run unconditionally — running the literal scrub when the
 * Bearer-prefix scrub already redacted the same span is idempotent
 * (the prefix scrub already removed the run; the literal scrub finds
 * nothing). The reverse order would also be safe.
 */
export function scrubBearerStrings(
	text: string,
	activeBearer?: string,
): string {
	if (typeof text !== "string" || text.length === 0) return text;

	let scrubbed = text.replace(BEARER_HEADER_PATTERN, REDACTED);

	if (activeBearer && activeBearer.length >= 8) {
		// Bearer-shape regex above wins for prefixed cases; the literal
		// pass catches the bare-token reflection. We require >= 8 chars
		// on the literal so a short test-fixture or a truncated value
		// can't accidentally redact common substrings.
		const escaped = escapeRegex(activeBearer);
		scrubbed = scrubbed.replace(new RegExp(escaped, "g"), "[REDACTED]");
	}

	return scrubbed;
}

/**
 * Regex-escape user-supplied input so it can be embedded in a
 * `RegExp(...)` literal-match. Covers the standard meta-character set;
 * bearer tokens in practice are URL-safe (alphanumerics + `-`, `_`, `.`)
 * but `escapeRegex` is conservative for the rare token formats that
 * carry `+` or `/`.
 */
function escapeRegex(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
