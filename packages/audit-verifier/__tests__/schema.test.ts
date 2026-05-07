import { describe, expect, it } from "vitest";
import { ZodError } from "zod";
import {
	AnchorSchemaV1,
	SchemaVersionUnsupportedError,
	SliceSchemaV1,
	parseAnchor,
	parseSlice,
} from "../src/schema";

const validAnchor = {
	schema_version: 1,
	cadence_id: "0196b0f2-0800-7000-8000-000000000001",
	recorded_at: "2026-05-07T12:00:00.000Z",
	merkle_root: "ab".repeat(32),
	tenant_count: 2,
	anchored_event_count: 2,
	recorded_at_range: {
		min: "2026-05-07T11:45:00.000Z",
		max: "2026-05-07T11:59:30.000Z",
	},
	leaf_algorithm: "sha256_rfc6962",
	proof_keys: [
		"proofs/tenant-11111111-1111-7111-8111-111111111111/cadence-0196b0f2-0800-7000-8000-000000000001.json",
	],
};

const validSlice = {
	schema_version: 1,
	tenant_id: "11111111-1111-7111-8111-111111111111",
	latest_event_hash: "aa".repeat(32),
	latest_recorded_at: "2026-05-07T11:59:30.000Z",
	latest_event_id: "0196b0f2-0800-7000-8000-000000000aaa",
	leaf_hash: "cd".repeat(32),
	proof_path: [
		{ hash: "ef".repeat(32), position: "right" as const },
	],
	global_root: "ab".repeat(32),
	cadence_id: "0196b0f2-0800-7000-8000-000000000001",
};

describe("AnchorSchemaV1 — happy path + forward compat", () => {
	it("parses a valid v1 anchor body", () => {
		const parsed = AnchorSchemaV1.parse(validAnchor);
		expect(parsed.cadence_id).toBe(validAnchor.cadence_id);
		expect(parsed.merkle_root).toBe(validAnchor.merkle_root);
	});

	it("accepts unknown extra fields silently (forward compat per R7)", () => {
		const withExtra = { ...validAnchor, future_field: "ignore me" };
		expect(() => AnchorSchemaV1.parse(withExtra)).not.toThrow();
	});

	it("accepts null recorded_at_range (empty cadence)", () => {
		const empty = { ...validAnchor, recorded_at_range: null, tenant_count: 0, anchored_event_count: 0, proof_keys: [] };
		expect(() => AnchorSchemaV1.parse(empty)).not.toThrow();
	});
});

describe("AnchorSchemaV1 — validation errors on malformed v1", () => {
	it("rejects merkle_root that isn't 64-char hex", () => {
		const bad = { ...validAnchor, merkle_root: "not-hex" };
		expect(() => AnchorSchemaV1.parse(bad)).toThrow(ZodError);
	});

	it("rejects negative tenant_count", () => {
		const bad = { ...validAnchor, tenant_count: -1 };
		expect(() => AnchorSchemaV1.parse(bad)).toThrow(ZodError);
	});

	it("rejects non-UUIDv7-shaped cadence_id", () => {
		const bad = { ...validAnchor, cadence_id: "not-a-uuid" };
		expect(() => AnchorSchemaV1.parse(bad)).toThrow(ZodError);
	});

	it("rejects unrecognized leaf_algorithm", () => {
		const bad = { ...validAnchor, leaf_algorithm: "sha3_256" };
		expect(() => AnchorSchemaV1.parse(bad)).toThrow(ZodError);
	});
});

describe("SliceSchemaV1 — happy path + edge cases", () => {
	it("parses a valid v1 slice body", () => {
		const parsed = SliceSchemaV1.parse(validSlice);
		expect(parsed.tenant_id).toBe(validSlice.tenant_id);
		expect(parsed.proof_path).toHaveLength(1);
	});

	it("accepts empty proof_path (single-tenant cadence)", () => {
		const single = { ...validSlice, proof_path: [] };
		expect(() => SliceSchemaV1.parse(single)).not.toThrow();
	});

	it("accepts unknown extra fields silently (forward compat)", () => {
		const withExtra = { ...validSlice, audit_marker: "rev-2" };
		expect(() => SliceSchemaV1.parse(withExtra)).not.toThrow();
	});

	it("rejects proof_path step with invalid position", () => {
		const bad = {
			...validSlice,
			proof_path: [{ hash: "ab".repeat(32), position: "middle" }],
		};
		expect(() => SliceSchemaV1.parse(bad)).toThrow(ZodError);
	});
});

describe("parseAnchor / parseSlice — schema_version routing", () => {
	it("parseAnchor on v1 returns a typed object", () => {
		const parsed = parseAnchor(validAnchor);
		expect(parsed.cadence_id).toBe(validAnchor.cadence_id);
	});

	it("parseAnchor on schema_version: 999 throws SchemaVersionUnsupportedError (NOT ZodError)", () => {
		const future = { ...validAnchor, schema_version: 999 };
		expect(() => parseAnchor(future, "anchors/cadence-fake.json")).toThrow(
			SchemaVersionUnsupportedError,
		);
		try {
			parseAnchor(future, "anchors/cadence-fake.json");
		} catch (err) {
			expect(err).toBeInstanceOf(SchemaVersionUnsupportedError);
			expect((err as SchemaVersionUnsupportedError).version).toBe(999);
			expect((err as SchemaVersionUnsupportedError).key).toBe(
				"anchors/cadence-fake.json",
			);
		}
	});

	it("parseAnchor on missing schema_version throws SchemaVersionUnsupportedError", () => {
		const bad = { ...validAnchor };
		delete (bad as { schema_version?: unknown }).schema_version;
		expect(() => parseAnchor(bad)).toThrow(SchemaVersionUnsupportedError);
	});

	it("parseAnchor on malformed v1 throws ZodError (distinct from version error)", () => {
		const bad = { ...validAnchor, merkle_root: "not-hex" };
		expect(() => parseAnchor(bad)).toThrow(ZodError);
		expect(() => parseAnchor(bad)).not.toThrow(
			SchemaVersionUnsupportedError,
		);
	});

	it("parseSlice on schema_version: 0 throws SchemaVersionUnsupportedError", () => {
		const bad = { ...validSlice, schema_version: 0 };
		expect(() => parseSlice(bad)).toThrow(SchemaVersionUnsupportedError);
	});

	it("parseSlice on non-object input throws SchemaVersionUnsupportedError", () => {
		expect(() => parseSlice("not an object")).toThrow(
			SchemaVersionUnsupportedError,
		);
		expect(() => parseSlice(null)).toThrow(SchemaVersionUnsupportedError);
	});
});
