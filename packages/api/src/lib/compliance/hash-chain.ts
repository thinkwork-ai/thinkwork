/**
 * Per-tenant cryptographic hash chain for compliance audit events.
 *
 * Both the U4 drainer Lambda (`packages/lambda/compliance-outbox-drainer.ts`)
 * and the future U9 verifier CLI (`tools/audit-verifier/`) consume these
 * helpers. Pure functions, no Drizzle / no AWS / no Postgres — so the
 * verifier can mirror the chain logic without DB dependencies.
 *
 * Hash chain semantics:
 *   - Each event commits to the previous event's hash via `prev_hash`.
 *   - Genesis event for a tenant has `prev_hash = NULL` (passed to the
 *     hash function as the empty string `""` so the input is well-defined).
 *   - The hash input is the canonical JSON of the FULL envelope plus the
 *     prev_hash — tampering with any envelope field detectable.
 *
 * Canonicalization (sorted-key JSON.stringify):
 *   - Object keys sorted alphabetically at every depth.
 *   - `control_ids` and `payload_redacted_fields` arrays sorted
 *     alphabetically (their semantic order is set-like, not list-like).
 *   - All OTHER arrays preserve insertion order — semantic order matters
 *     for things like `payload.skillIds`.
 *   - `Date` values rendered as ISO 8601 UTC strings with millisecond
 *     precision via `toISOString()`.
 *   - `undefined` becomes `null` so two payloads that differ only on
 *     `undefined` vs missing key produce the same hash.
 *   - No whitespace; output is the most compact valid JSON.
 */

import { createHash } from "node:crypto";

/**
 * Field names whose array contents are sorted alphabetically before
 * canonicalization. These represent set-like data where insertion order
 * is incidental (multiple emit call sites may populate them in
 * different orders for the same logical event).
 */
const SET_LIKE_ARRAY_FIELDS = new Set([
	"control_ids",
	"payload_redacted_fields",
]);

/**
 * The 21 envelope fields that participate in the chain hash, plus
 * prev_hash (which is fed in separately by `computeEventHash`). Ordering
 * here doesn't matter — `canonicalizeEvent` sorts alphabetically.
 *
 * Excluded: `outbox_id` (drainer-internal idempotency key, not part of
 * the durable record), `recorded_at` (set by the audit_events INSERT
 * default, not present at chain compute time), `enqueued_at`/`drained_at`
 * (outbox-only).
 */
export interface HashableEnvelope {
	event_id: string;
	tenant_id: string;
	occurred_at: Date | string;
	actor: string;
	actor_type: string;
	source: string;
	event_type: string;
	resource_type: string | null;
	resource_id: string | null;
	action: string | null;
	outcome: string | null;
	request_id: string | null;
	thread_id: string | null;
	agent_id: string | null;
	payload: Record<string, unknown>;
	payload_schema_version: number;
	control_ids: string[];
	payload_redacted_fields: string[];
	payload_oversize_s3_key: string | null;
}

/**
 * Recursive canonical serialization. Object keys sorted alphabetically;
 * `SET_LIKE_ARRAY_FIELDS` arrays sorted; Date values rendered ISO 8601.
 *
 * The `parentKey` argument lets the recursion identify when an array is
 * a set-like field (which sorts) vs an order-preserving array (which
 * doesn't). Top-level call passes `parentKey = null`.
 */
function canonicalize(value: unknown, parentKey: string | null): string {
	if (value === undefined || value === null) return "null";
	if (value instanceof Date) return JSON.stringify(value.toISOString());
	if (typeof value !== "object") return JSON.stringify(value);

	if (Array.isArray(value)) {
		const items =
			parentKey !== null && SET_LIKE_ARRAY_FIELDS.has(parentKey)
				? [...value]
						.map((v) => (typeof v === "string" ? v : String(v)))
						.sort()
				: value;
		const serialized = items.map((v) => canonicalize(v, null));
		return `[${serialized.join(",")}]`;
	}

	const obj = value as Record<string, unknown>;
	const keys = Object.keys(obj).sort();
	const entries = keys.map(
		(k) => `${JSON.stringify(k)}:${canonicalize(obj[k], k)}`,
	);
	return `{${entries.join(",")}}`;
}

/**
 * Produce the canonical JSON serialization of a hashable envelope.
 * Deterministic: same input → byte-identical output.
 */
export function canonicalizeEvent(envelope: HashableEnvelope): string {
	return canonicalize(envelope, null);
}

/**
 * Compute the SHA-256 hex digest of `prevHash + canonicalEnvelope`.
 *
 * @param canonical Result of `canonicalizeEvent`.
 * @param prevHash Previous event's `event_hash` (64 hex chars), or
 *   `""` for the genesis event of a tenant chain. Pass `""` not `null`
 *   so the hash input is well-defined (a `null` would be coerced to
 *   the string "null" which is not what we want).
 */
export function computeEventHash(
	canonical: string,
	prevHash: string,
): string {
	return createHash("sha256")
		.update(prevHash, "utf-8")
		.update(canonical, "utf-8")
		.digest("hex");
}
