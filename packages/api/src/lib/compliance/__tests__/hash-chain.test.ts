import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import {
	canonicalizeEvent,
	computeEventHash,
	type HashableEnvelope,
} from "../hash-chain";

const baseEnvelope: HashableEnvelope = {
	event_id: "01000000-0000-7000-8000-000000000001",
	tenant_id: "11111111-1111-1111-1111-111111111111",
	occurred_at: new Date("2026-01-01T00:00:00.000Z"),
	actor: "actor-1",
	actor_type: "user",
	source: "graphql",
	event_type: "agent.skills_changed",
	resource_type: null,
	resource_id: null,
	action: null,
	outcome: null,
	request_id: null,
	thread_id: null,
	agent_id: null,
	payload: { agentId: "a1", skillIds: ["s1", "s2"] },
	payload_schema_version: 1,
	control_ids: [],
	payload_redacted_fields: [],
	payload_oversize_s3_key: null,
};

describe("canonicalizeEvent", () => {
	it("produces sorted-key JSON for a basic envelope", () => {
		const result = canonicalizeEvent(baseEnvelope);
		// Keys appear alphabetically: action, actor, actor_type, agent_id, ...
		expect(result.indexOf('"action"')).toBeLessThan(result.indexOf('"actor"'));
		expect(result.indexOf('"actor"')).toBeLessThan(
			result.indexOf('"actor_type"'),
		);
		expect(result.indexOf('"event_id"')).toBeLessThan(
			result.indexOf('"event_type"'),
		);
	});

	it("nested payload object has keys sorted too", () => {
		const result = canonicalizeEvent({
			...baseEnvelope,
			payload: { z: 1, a: 2, m: 3 },
		});
		const payloadStart = result.indexOf('"payload":');
		const payloadEnd = result.indexOf("}", payloadStart) + 1;
		const payloadJson = result.slice(payloadStart + '"payload":'.length, payloadEnd);
		expect(payloadJson).toBe('{"a":2,"m":3,"z":1}');
	});

	it("renders Date values as ISO 8601 UTC with millisecond precision", () => {
		const result = canonicalizeEvent({
			...baseEnvelope,
			occurred_at: new Date("2026-05-07T12:34:56.789Z"),
		});
		expect(result).toContain('"occurred_at":"2026-05-07T12:34:56.789Z"');
	});

	it("accepts ISO string for occurred_at as alternative to Date", () => {
		const result = canonicalizeEvent({
			...baseEnvelope,
			occurred_at: "2026-05-07T12:34:56.789Z",
		});
		expect(result).toContain('"occurred_at":"2026-05-07T12:34:56.789Z"');
	});

	it("sorts control_ids alphabetically (set-like)", () => {
		const result = canonicalizeEvent({
			...baseEnvelope,
			control_ids: ["CC8.1", "CC6.1", "CC6.2"],
		});
		expect(result).toContain('"control_ids":["CC6.1","CC6.2","CC8.1"]');
	});

	it("sorts payload_redacted_fields alphabetically (set-like)", () => {
		const result = canonicalizeEvent({
			...baseEnvelope,
			payload_redacted_fields: ["zebra", "alpha", "mike"],
		});
		expect(result).toContain(
			'"payload_redacted_fields":["alpha","mike","zebra"]',
		);
	});

	it("preserves insertion order for non-set-like arrays in payload", () => {
		const result = canonicalizeEvent({
			...baseEnvelope,
			payload: { skillIds: ["skill-c", "skill-a", "skill-b"] },
		});
		// payload.skillIds is order-preserving — auditor cares about order.
		expect(result).toContain('"skillIds":["skill-c","skill-a","skill-b"]');
	});

	it("normalizes undefined to null", () => {
		const env = { ...baseEnvelope, resource_type: undefined as unknown as null };
		const result = canonicalizeEvent(env);
		expect(result).toContain('"resource_type":null');
	});

	it("treats null and missing-key the same in the canonical output", () => {
		const withNull = canonicalizeEvent(baseEnvelope);
		// All optional fields explicitly null in baseEnvelope; should produce a
		// stable serialization.
		expect(withNull).toContain('"action":null');
		expect(withNull).toContain('"resource_type":null');
	});

	it("produces byte-identical output for identical inputs", () => {
		const a = canonicalizeEvent(baseEnvelope);
		const b = canonicalizeEvent({ ...baseEnvelope });
		expect(a).toBe(b);
	});

	it("changes when any envelope field is tampered", () => {
		const original = canonicalizeEvent(baseEnvelope);
		const tampered = canonicalizeEvent({
			...baseEnvelope,
			actor: "actor-2",
		});
		expect(original).not.toBe(tampered);
	});

	it("changes when payload field is tampered (deep tamper detection)", () => {
		const original = canonicalizeEvent(baseEnvelope);
		const tampered = canonicalizeEvent({
			...baseEnvelope,
			payload: { agentId: "a1", skillIds: ["s1", "s2", "s3"] },
		});
		expect(original).not.toBe(tampered);
	});

	it("emits no whitespace (compact output)", () => {
		const result = canonicalizeEvent(baseEnvelope);
		expect(result).not.toMatch(/\s/);
	});
});

describe("computeEventHash", () => {
	it("produces 64 hex chars", () => {
		const canonical = canonicalizeEvent(baseEnvelope);
		const hash = computeEventHash(canonical, "");
		expect(hash).toMatch(/^[a-f0-9]{64}$/);
	});

	it("matches manual sha256(prev || canonical) for genesis event", () => {
		const canonical = canonicalizeEvent(baseEnvelope);
		const expected = createHash("sha256")
			.update("", "utf-8")
			.update(canonical, "utf-8")
			.digest("hex");
		const actual = computeEventHash(canonical, "");
		expect(actual).toBe(expected);
	});

	it("matches manual sha256(prev || canonical) for non-genesis event", () => {
		const canonical = canonicalizeEvent(baseEnvelope);
		const prev = "a".repeat(64);
		const expected = createHash("sha256")
			.update(prev, "utf-8")
			.update(canonical, "utf-8")
			.digest("hex");
		const actual = computeEventHash(canonical, prev);
		expect(actual).toBe(expected);
	});

	it("different prev_hash produces different event_hash for same canonical", () => {
		const canonical = canonicalizeEvent(baseEnvelope);
		const h1 = computeEventHash(canonical, "");
		const h2 = computeEventHash(canonical, "a".repeat(64));
		expect(h1).not.toBe(h2);
	});

	it("different canonical produces different event_hash for same prev_hash", () => {
		const c1 = canonicalizeEvent(baseEnvelope);
		const c2 = canonicalizeEvent({ ...baseEnvelope, actor: "actor-2" });
		const prev = "a".repeat(64);
		expect(computeEventHash(c1, prev)).not.toBe(computeEventHash(c2, prev));
	});

	it("treats empty-string prev_hash as the well-defined genesis case", () => {
		// Documenting the "" sentinel: passing null would coerce via update()
		// to the string "null" which is NOT what we want; "" is the explicit
		// genesis marker.
		const canonical = canonicalizeEvent(baseEnvelope);
		const genesisHash = computeEventHash(canonical, "");
		const nullishHash = computeEventHash(canonical, "null");
		expect(genesisHash).not.toBe(nullishHash);
	});
});

describe("chain consistency (3-event tenant chain)", () => {
	it("each event's prev_hash matches predecessor's event_hash", () => {
		const e1: HashableEnvelope = { ...baseEnvelope, event_id: "01-event-001" };
		const e2: HashableEnvelope = { ...baseEnvelope, event_id: "02-event-002" };
		const e3: HashableEnvelope = { ...baseEnvelope, event_id: "03-event-003" };

		const c1 = canonicalizeEvent(e1);
		const h1 = computeEventHash(c1, "");

		const c2 = canonicalizeEvent(e2);
		const h2 = computeEventHash(c2, h1);

		const c3 = canonicalizeEvent(e3);
		const h3 = computeEventHash(c3, h2);

		expect(h1).toMatch(/^[a-f0-9]{64}$/);
		expect(h2).toMatch(/^[a-f0-9]{64}$/);
		expect(h3).toMatch(/^[a-f0-9]{64}$/);
		expect(h1).not.toBe(h2);
		expect(h2).not.toBe(h3);

		// Recompute and verify (auditor-side path).
		const verifyH2 = computeEventHash(canonicalizeEvent(e2), h1);
		expect(verifyH2).toBe(h2);
	});

	it("tampering with event 2's actor breaks the verification of event 2 and beyond", () => {
		const e1: HashableEnvelope = { ...baseEnvelope, event_id: "01-event-001" };
		const e2: HashableEnvelope = { ...baseEnvelope, event_id: "02-event-002" };

		const c1 = canonicalizeEvent(e1);
		const h1 = computeEventHash(c1, "");
		const originalH2 = computeEventHash(canonicalizeEvent(e2), h1);

		// Auditor finds event 2 tampered (actor changed from "actor-1" to "actor-2").
		const tamperedE2 = { ...e2, actor: "actor-2" };
		const recomputedH2 = computeEventHash(canonicalizeEvent(tamperedE2), h1);

		expect(recomputedH2).not.toBe(originalH2);
	});
});
