import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import {
	EMPTY_TREE_ROOT,
	buildMerkleTree,
	computeLeafHash,
	verifyProofPath,
	type ProofStep,
} from "../src/merkle";

/**
 * RFC 6962 byte-agreement tests.
 *
 * The locked U8a fixture below is the cross-implementation contract.
 * Source of truth: packages/lambda/__tests__/integration/compliance-anchor.integration.test.ts:165-191.
 *
 * If the assertion fails, every cadence ever written is unverifiable —
 * the verifier and writer disagree on the leaf algorithm.
 */

describe("computeLeafHash — locked U8a fixture (cross-implementation byte agreement)", () => {
	it("produces the locked hex literal for the canonical fixture", () => {
		const tenantId = "11111111-1111-7111-8111-111111111111";
		const eventHashHex = "aa".repeat(32);
		expect(computeLeafHash(tenantId, eventHashHex)).toBe(
			"701e2479c1ad3506b53c1355562082b44dd68112b018e73e4c39a869e680bcb3",
		);
	});

	it("derives the locked value from the documented byte composition", () => {
		// Belt-and-suspenders: rederive the same value from first
		// principles so a future reviewer can audit the prefix + uuid
		// byte order + event-hash byte order without trusting our impl.
		const tenantId = "11111111-1111-7111-8111-111111111111";
		const eventHashHex = "aa".repeat(32);
		const expected = createHash("sha256")
			.update(Buffer.from([0x00]))
			.update(Buffer.from(tenantId.replace(/-/g, ""), "hex"))
			.update(Buffer.from(eventHashHex, "hex"))
			.digest("hex");
		expect(computeLeafHash(tenantId, eventHashHex)).toBe(expected);
	});
});

describe("computeLeafHash — input validation", () => {
	it("rejects non-UUID-shaped tenant_id", () => {
		expect(() => computeLeafHash("not-a-uuid", "aa".repeat(32))).toThrow(
			/expected 32 hex chars/,
		);
	});

	it("rejects non-hex event_hash", () => {
		expect(() =>
			computeLeafHash(
				"11111111-1111-7111-8111-111111111111",
				"not-64-chars-of-hex",
			),
		).toThrow(/expected 64-char hex digest/);
	});

	it("rejects truncated event_hash (63 hex chars)", () => {
		expect(() =>
			computeLeafHash(
				"11111111-1111-7111-8111-111111111111",
				"a".repeat(63),
			),
		).toThrow(/expected 64-char hex digest/);
	});
});

describe("buildMerkleTree — RFC 6962 odd-duplication + domain separation", () => {
	it("empty tree returns sentinel root sha256(0x00)", () => {
		const expected = createHash("sha256")
			.update(Buffer.from([0x00]))
			.digest("hex");
		const { root, levels } = buildMerkleTree([]);
		expect(root).toBe(expected);
		expect(root).toBe(EMPTY_TREE_ROOT);
		expect(levels).toEqual([[]]);
	});

	it("single leaf is its own root", () => {
		const leaf = "ab".repeat(32);
		const { root, levels } = buildMerkleTree([leaf]);
		expect(root).toBe(leaf);
		expect(levels).toEqual([[leaf]]);
	});

	it("two leaves: root = sha256(0x01 || left || right)", () => {
		const left = "ab".repeat(32);
		const right = "cd".repeat(32);
		const expected = createHash("sha256")
			.update(Buffer.from([0x01]))
			.update(Buffer.from(left, "hex"))
			.update(Buffer.from(right, "hex"))
			.digest("hex");
		const { root } = buildMerkleTree([left, right]);
		expect(root).toBe(expected);
	});

	it("three leaves: odd leaf is duplicated (Bitcoin-style)", () => {
		const a = "11".repeat(32);
		const b = "22".repeat(32);
		const c = "33".repeat(32);
		const lvl1a = createHash("sha256")
			.update(Buffer.from([0x01]))
			.update(Buffer.from(a, "hex"))
			.update(Buffer.from(b, "hex"))
			.digest("hex");
		const lvl1b = createHash("sha256")
			.update(Buffer.from([0x01]))
			.update(Buffer.from(c, "hex"))
			.update(Buffer.from(c, "hex"))
			.digest("hex");
		const expected = createHash("sha256")
			.update(Buffer.from([0x01]))
			.update(Buffer.from(lvl1a, "hex"))
			.update(Buffer.from(lvl1b, "hex"))
			.digest("hex");
		const { root } = buildMerkleTree([a, b, c]);
		expect(root).toBe(expected);
	});
});

describe("verifyProofPath — sibling-side semantic + single-leaf identity", () => {
	it("empty proof path returns the leaf hash unchanged (single-tenant cadence)", () => {
		// Single-tenant cadences are the dominant production case in early
		// months. Without this invariant, every single-tenant anchor would
		// fail verification.
		const leaf = "ab".repeat(32);
		expect(verifyProofPath(leaf, [])).toBe(leaf);
	});

	it("4-leaf tree: leaf at index 1 reconstructs the root via its proof path", () => {
		// Build a 4-leaf tree, manually derive the proof path for leaf b
		// (index 1), and assert verifyProofPath rebuilds the root. This
		// locks the sibling-side semantic: position names the SIBLING's
		// side at each level, not the leaf's.
		const a = "11".repeat(32);
		const b = "22".repeat(32);
		const c = "33".repeat(32);
		const d = "44".repeat(32);
		const { root, levels } = buildMerkleTree([a, b, c, d]);

		// Mirror the writer's deriveProofPath logic:
		// At level 0 leaf b is at index 1, so its sibling is a (index 0,
		// to the LEFT). At level 1 leaf b's parent is at index 0 (b's
		// new index after pairing), so its sibling is at index 1
		// (parent of c+d), to the RIGHT.
		const proofPath: ProofStep[] = [
			{ hash: levels[0][0], position: "left" },
			{ hash: levels[1][1], position: "right" },
		];

		expect(verifyProofPath(b, proofPath)).toBe(root);
	});

	it("4-leaf tree: leaf at index 2 reconstructs the root (right-then-left sibling pattern)", () => {
		const a = "11".repeat(32);
		const b = "22".repeat(32);
		const c = "33".repeat(32);
		const d = "44".repeat(32);
		const { root, levels } = buildMerkleTree([a, b, c, d]);

		// Leaf c is at index 2 (even, right child = false → sibling on
		// the RIGHT) at level 0. At level 1, c's parent is at index 1
		// (right child = true → sibling on the LEFT).
		const proofPath: ProofStep[] = [
			{ hash: levels[0][3], position: "right" },
			{ hash: levels[1][0], position: "left" },
		];

		expect(verifyProofPath(c, proofPath)).toBe(root);
	});

	it("flipping a single proof-path bit produces a wrong root", () => {
		// Adversarial: a tampered slice with an off-by-one position
		// MUST produce a different root.
		const a = "11".repeat(32);
		const b = "22".repeat(32);
		const c = "33".repeat(32);
		const d = "44".repeat(32);
		const { root, levels } = buildMerkleTree([a, b, c, d]);

		const wrongProofPath: ProofStep[] = [
			{ hash: levels[0][0], position: "right" }, // flipped from "left"
			{ hash: levels[1][1], position: "right" },
		];

		expect(verifyProofPath(b, wrongProofPath)).not.toBe(root);
	});
});

describe("computeLeafHash — additional cross-implementation fixtures (defense against narrow byte vectors)", () => {
	// The U8a single fixture covers all-1s tenant + all-aa hash. These
	// additional fixtures exercise edge byte patterns so a parallel
	// verifier in another language can't accidentally pass U8a but fail
	// on production data.
	it("all-zero tenant_id + all-zero event_hash", () => {
		const tenantId = "00000000-0000-0000-0000-000000000000";
		const eventHashHex = "00".repeat(32);
		const expected = createHash("sha256")
			.update(Buffer.from([0x00]))
			.update(Buffer.from(tenantId.replace(/-/g, ""), "hex"))
			.update(Buffer.from(eventHashHex, "hex"))
			.digest("hex");
		expect(computeLeafHash(tenantId, eventHashHex)).toBe(expected);
	});

	it("all-F tenant_id (lowercase) + all-F event_hash", () => {
		const tenantId = "ffffffff-ffff-ffff-ffff-ffffffffffff";
		const eventHashHex = "ff".repeat(32);
		const expected = createHash("sha256")
			.update(Buffer.from([0x00]))
			.update(Buffer.from(tenantId.replace(/-/g, ""), "hex"))
			.update(Buffer.from(eventHashHex, "hex"))
			.digest("hex");
		expect(computeLeafHash(tenantId, eventHashHex)).toBe(expected);
	});

	it("uppercase hex input produces same digest as lowercase (case-insensitive parsing)", () => {
		const tenantIdLower = "11111111-1111-7111-8111-111111111111";
		const tenantIdUpper = "11111111-1111-7111-8111-111111111111".toUpperCase();
		const eventHashLower = "aa".repeat(32);
		const eventHashUpper = "AA".repeat(32);
		expect(computeLeafHash(tenantIdLower, eventHashLower)).toBe(
			computeLeafHash(tenantIdUpper, eventHashUpper),
		);
	});

	it("UUIDv4-shape tenant_id (variant nibble in unusual position)", () => {
		// Variant nibble = 8 instead of 7 (UUIDv4 vs UUIDv7); confirms the
		// algorithm treats tenant_id as opaque 16-byte input, not as a
		// version-encoded structure.
		const tenantId = "550e8400-e29b-41d4-a716-446655440000";
		const eventHashHex = "ab".repeat(32);
		const expected = createHash("sha256")
			.update(Buffer.from([0x00]))
			.update(Buffer.from(tenantId.replace(/-/g, ""), "hex"))
			.update(Buffer.from(eventHashHex, "hex"))
			.digest("hex");
		expect(computeLeafHash(tenantId, eventHashHex)).toBe(expected);
	});
});
