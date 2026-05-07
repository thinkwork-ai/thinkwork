/**
 * Redaction-before-write for compliance audit events.
 *
 * Two-layer defense:
 *   1. Per-event-type allow-list (`event-schemas.ts`) — drop any field
 *      not declared on the event type's schema. Deny-by-default.
 *   2. String-field sanitization — for fields that pass the allow-list,
 *      cap length at 4096 bytes, strip control chars (except \n / \t),
 *      replace invalid UTF-8 with the replacement char, and run the
 *      secret-pattern scrub from `sandbox-log-scrubber.ts:39-56` so
 *      tokens that snuck into a permitted field still get redacted.
 *
 * Master plan reference: docs/plans/2026-05-06-011-feat-compliance-
 * audit-event-log-plan.md, Decision #6 (deny-by-default allow-list).
 */

import type { ComplianceEventType } from "@thinkwork/database-pg/schema";
import { EVENT_PAYLOAD_SHAPES } from "./event-schemas";

const MAX_STRING_BYTES = 4096;
const REDACTED_SECRET = "<REDACTED:secret>";

// ---------------------------------------------------------------------------
// Secret-pattern set (extends packages/lambda/sandbox-log-scrubber.ts)
//
// Copied rather than imported because the scrubber is in `packages/lambda`
// and a cross-package dep for these regexes would be brittle. The
// compliance helper is the higher-stakes target (durable audit table vs
// transient CloudWatch logs), so this set is wider:
//   - GitHub (gh[oprsu]_), Slack (xox[abep]-), Google OAuth (ya29.)
//   - Anthropic (sk-ant-*), OpenAI (sk-proj-*)
//   - AWS access keys (AKIA / ASIA)
//   - JWT — anchored to `eyJ` Base64url-encoded JSON header prefix to
//     eliminate false positives on dotted identifiers / prose with 16+
//     char segments
//
// Update both files in lockstep; consider a shared module if patterns
// evolve further.
// ---------------------------------------------------------------------------

const AUTH_BEARER = /Authorization:\s*Bearer\s+([^\s"'<>]+)/gi;
// Anchor JWT to the standard header prefix: every real JWT base64url-
// encodes a header that begins with `{"alg":...}` -> `eyJ...`. This
// eliminates the false positive on three-segment dotted identifiers.
const JWT = /\beyJ[A-Za-z0-9_-]{13,}\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}\b/g;
const PREFIXED_TOKEN =
	/(?:gh[oprsu]_[A-Za-z0-9]{20,}|xox[abep]-[A-Za-z0-9-]{10,}|ya29\.[A-Za-z0-9_-]{20,}|sk-ant-[A-Za-z0-9_-]{40,}|sk-proj-[A-Za-z0-9_-]{40,}|AKIA[A-Z0-9]{16}|ASIA[A-Z0-9]{16})/g;

/**
 * Self-contained secret detection: resets every regex's `lastIndex`
 * before calling `.test()` so callers don't need to coordinate. The
 * `g` flag retains state between calls, which would otherwise produce
 * false negatives across consecutive scrub calls.
 */
function looksLikeSecret(value: string): boolean {
	AUTH_BEARER.lastIndex = 0;
	JWT.lastIndex = 0;
	PREFIXED_TOKEN.lastIndex = 0;
	return (
		AUTH_BEARER.test(value) ||
		JWT.test(value) ||
		PREFIXED_TOKEN.test(value)
	);
}

// ---------------------------------------------------------------------------
// String sanitization
// ---------------------------------------------------------------------------

/**
 * Cap length, strip non-printable control chars (preserving \n and \t),
 * normalize invalid UTF-8 to the replacement char. Returns `{ value,
 * truncated }` so callers can append `:truncated` to redactedFields.
 */
export function sanitizeStringField(raw: string): {
	value: string;
	truncated: boolean;
} {
	// Round-trip through UTF-8 encoder/decoder with `fatal: false` to
	// replace invalid byte sequences with the replacement char.
	const normalized = new TextDecoder("utf-8", { fatal: false }).decode(
		new TextEncoder().encode(raw),
	);

	// Strip ASCII control chars 0x00-0x08, 0x0B, 0x0C, 0x0E-0x1F, 0x7F.
	// Preserve \n (0x0A) and \t (0x09).
	const stripped = normalized.replace(
		// eslint-disable-next-line no-control-regex
		/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g,
		"",
	);

	// Cap at MAX_STRING_BYTES. Use Buffer.byteLength to count bytes not
	// JS string length (which counts UTF-16 code units).
	const byteLen = Buffer.byteLength(stripped, "utf-8");
	if (byteLen <= MAX_STRING_BYTES) {
		return { value: stripped, truncated: false };
	}

	// Truncate to the largest prefix whose UTF-8 byte length fits. Bisect
	// to find the boundary because cutting mid-codepoint produces
	// replacement chars; bisecting on character index is correct.
	let lo = 0;
	let hi = stripped.length;
	while (lo < hi) {
		const mid = (lo + hi + 1) >>> 1;
		const candidate = stripped.slice(0, mid);
		if (Buffer.byteLength(candidate, "utf-8") <= MAX_STRING_BYTES) {
			lo = mid;
		} else {
			hi = mid - 1;
		}
	}
	return { value: stripped.slice(0, lo), truncated: true };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface RedactResult {
	/** Payload after allow-list + sanitization + secret scrub. */
	redacted: Record<string, unknown>;
	/**
	 * Field names that were dropped or modified, with discriminator
	 * suffixes:
	 *   `<field>` — dropped entirely (not in allow-list)
	 *   `<field>:truncated` — string truncated at MAX_STRING_BYTES
	 *   `<field>:scrubbed` — secret pattern matched; value replaced
	 *
	 * Drainer-side or admin-side consumers can render this as a small
	 * provenance trail under each event.
	 */
	redactedFields: string[];
}

/**
 * Redact a raw payload against the per-event-type allow-list and the
 * secret-pattern scrub. Throws when the event type has no registered
 * schema — protects against unknown event types reaching the outbox.
 *
 * Phase 6 reserved event types (R14) have empty allow-lists by design.
 * Calling `redactPayload` with one of these throws so an emitter
 * accidentally shipped before the registry update fails loudly rather
 * than silently writing `{}` payloads with no audit evidence.
 */
export function redactPayload(
	eventType: ComplianceEventType,
	raw: Record<string, unknown>,
): RedactResult {
	const schema = EVENT_PAYLOAD_SHAPES[eventType];
	if (!schema) {
		throw new Error(
			`compliance.redactPayload: no redaction schema for event type "${eventType}". ` +
				`Add an entry to EVENT_PAYLOAD_SHAPES in packages/api/src/lib/compliance/event-schemas.ts.`,
		);
	}
	if (schema.allowedFields.size === 0) {
		throw new Error(
			`compliance.redactPayload: event type "${eventType}" is a Phase 6 reservation ` +
				`with no allowed fields. Define its allow-list in EVENT_PAYLOAD_SHAPES before emitting.`,
		);
	}

	// Phase 1: optional pre-transform (e.g., governance file diff hash + preview).
	const transformed = schema.preTransform ? schema.preTransform(raw) : raw;

	const redacted: Record<string, unknown> = {};
	const redactedFields: string[] = [];

	// Phase 2: allow-list filter.
	for (const [key, value] of Object.entries(transformed)) {
		if (!schema.allowedFields.has(key)) {
			redactedFields.push(key);
			continue;
		}
		redacted[key] = value;
	}

	// Phase 3: per-field sanitization + secret scrub.
	for (const [key, value] of Object.entries(redacted)) {
		if (typeof value !== "string") continue;

		const { value: cleanedValue, truncated } = sanitizeStringField(value);
		redacted[key] = cleanedValue;
		if (truncated) {
			redactedFields.push(`${key}:truncated`);
		}

		if (looksLikeSecret(cleanedValue)) {
			redacted[key] = REDACTED_SECRET;
			redactedFields.push(`${key}:scrubbed`);
		}
	}

	return { redacted, redactedFields };
}
