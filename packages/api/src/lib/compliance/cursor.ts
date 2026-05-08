/**
 * Cursor encoding for the compliance events list.
 *
 * Format: base64-url of `JSON.stringify({occurredAt, eventId})`.
 * `occurredAt` MUST be the raw Postgres `timestamptz` text value
 * (e.g. `"2026-05-07T14:23:45.123456+00:00"`) — never round-tripped
 * through `new Date(...).toISOString()` (loses microsecond precision
 * → boundary skips/duplicates events at high-throughput tenants).
 *
 * The U2 microsecond-fidelity test seeds two rows differing by exactly
 * 1 microsecond and verifies pagination's second page returns the
 * second row.
 */

export interface ComplianceEventCursor {
	/** Raw Postgres timestamptz text with microsecond precision intact. */
	occurredAt: string;
	/** event_id UUIDv7 string. */
	eventId: string;
}

export function encodeCursor(cursor: ComplianceEventCursor): string {
	const json = JSON.stringify(cursor);
	return Buffer.from(json, "utf-8").toString("base64url");
}

export function decodeCursor(encoded: string): ComplianceEventCursor {
	let json: string;
	try {
		json = Buffer.from(encoded, "base64url").toString("utf-8");
	} catch (err) {
		throw new Error(
			`compliance/cursor: invalid base64url cursor — ${
				err instanceof Error ? err.message : String(err)
			}`,
		);
	}
	let parsed: unknown;
	try {
		parsed = JSON.parse(json);
	} catch {
		throw new Error("compliance/cursor: cursor JSON is malformed");
	}
	if (
		typeof parsed !== "object" ||
		parsed === null ||
		typeof (parsed as { occurredAt?: unknown }).occurredAt !== "string" ||
		typeof (parsed as { eventId?: unknown }).eventId !== "string"
	) {
		throw new Error(
			"compliance/cursor: cursor must contain {occurredAt: string, eventId: string}",
		);
	}
	return parsed as ComplianceEventCursor;
}
