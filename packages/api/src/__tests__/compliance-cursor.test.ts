/**
 * Compliance cursor encoding — microsecond-fidelity round-trip.
 *
 * Postgres `timestamptz` carries microsecond precision (6 digits).
 * JavaScript `Date` truncates to milliseconds (3 digits). The cursor
 * encoder MUST preserve the raw microsecond text — never round-trip
 * through `new Date(...).toISOString()`. Without this fidelity,
 * pagination boundaries can skip or duplicate events emitted within
 * the same millisecond at high-throughput tenants.
 */

import { describe, expect, it } from "vitest";
import {
	decodeCursor,
	encodeCursor,
	type ComplianceEventCursor,
} from "../lib/compliance/cursor.js";

describe("compliance cursor — microsecond fidelity", () => {
	it("preserves microsecond precision in the timestamptz text", () => {
		const cursor: ComplianceEventCursor = {
			occurredAt: "2026-05-07T14:23:45.123456+00:00",
			eventId: "0196b0f2-0800-7000-8000-000000000001",
		};
		const encoded = encodeCursor(cursor);
		const decoded = decodeCursor(encoded);
		expect(decoded.occurredAt).toBe("2026-05-07T14:23:45.123456+00:00");
		expect(decoded.eventId).toBe("0196b0f2-0800-7000-8000-000000000001");
	});

	it("two cursors differing by 1 microsecond decode to distinct values", () => {
		// At high-throughput tenants, two events can land within the same
		// millisecond. The cursor MUST distinguish them at microsecond
		// granularity, otherwise pagination drops or duplicates rows.
		const cursorA: ComplianceEventCursor = {
			occurredAt: "2026-05-07T14:23:45.123456+00:00",
			eventId: "aaaaaaaa-aaaa-7aaa-8aaa-aaaaaaaaaaaa",
		};
		const cursorB: ComplianceEventCursor = {
			occurredAt: "2026-05-07T14:23:45.123457+00:00",
			eventId: "bbbbbbbb-bbbb-7bbb-8bbb-bbbbbbbbbbbb",
		};
		const decodedA = decodeCursor(encodeCursor(cursorA));
		const decodedB = decodeCursor(encodeCursor(cursorB));
		expect(decodedA.occurredAt).not.toBe(decodedB.occurredAt);
		expect(decodedA.occurredAt).toBe("2026-05-07T14:23:45.123456+00:00");
		expect(decodedB.occurredAt).toBe("2026-05-07T14:23:45.123457+00:00");
	});

	it("rejects malformed base64", () => {
		expect(() => decodeCursor("not!valid!base64!")).toThrow();
	});

	it("rejects valid base64 with non-JSON payload", () => {
		const encoded = Buffer.from("not json", "utf-8").toString("base64url");
		expect(() => decodeCursor(encoded)).toThrow(/JSON/);
	});

	it("rejects valid JSON missing required fields", () => {
		const encoded = Buffer.from('{"foo":"bar"}', "utf-8").toString(
			"base64url",
		);
		expect(() => decodeCursor(encoded)).toThrow(
			/occurredAt: string, eventId: string/,
		);
	});
});
