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
// Secret-pattern set (mirror of packages/lambda/sandbox-log-scrubber.ts:43-56)
//
// Copied rather than imported because the scrubber is in `packages/lambda`
// and a cross-package dep for three regexes would be brittle. If the
// scrubber's pattern set evolves, update both places — flagged in
// `docs/solutions/` for future consolidation.
// ---------------------------------------------------------------------------

const AUTH_BEARER = /Authorization:\s*Bearer\s+([^\s"'<>]+)/gi;
const JWT = /\b[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}\b/g;
const PREFIXED_TOKEN =
	/(?:gh[oprsu]_[A-Za-z0-9]{20,}|xox[abep]-[A-Za-z0-9-]{10,}|ya29\.[A-Za-z0-9_-]{20,})/g;

function looksLikeSecret(value: string): boolean {
	return (
		AUTH_BEARER.test(value) ||
		JWT.test(value) ||
		PREFIXED_TOKEN.test(value)
	);
}

// `RegExp.prototype.test` advances `lastIndex` on `g`-flagged regexes;
// reset before each independent call.
function resetRegexes(): void {
	AUTH_BEARER.lastIndex = 0;
	JWT.lastIndex = 0;
	PREFIXED_TOKEN.lastIndex = 0;
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

		resetRegexes();
		if (looksLikeSecret(cleanedValue)) {
			redacted[key] = REDACTED_SECRET;
			redactedFields.push(`${key}:scrubbed`);
		}
	}

	return { redacted, redactedFields };
}
