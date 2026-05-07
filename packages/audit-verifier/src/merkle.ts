/**
 * RFC 6962 (Certificate Transparency §2.1) Merkle tree primitives.
 *
 * Re-implementation of the writer's algorithm from scratch — DOES NOT
 * import the writer. The whole point of this package is independence:
 * a third party hands their auditor a build of this and verifies our
 * audit evidence without trusting our monorepo. If the writer's leaf
 * math drifts from what RFC 6962 specifies, the locked test vector
 * (see __tests__/merkle.test.ts) catches it.
 *
 * Domain-separation prefix bytes — RFC 6962 §2.1:
 *   leaf = sha256(0x00 || tenant_id_bytes || event_hash_bytes)
 *   node = sha256(0x01 || left_hash_bytes || right_hash_bytes)
 *
 * Without the prefixes, leaf and internal-node hashes are
 * interchangeable; an attacker controlling event content could craft
 * a leaf input whose hash equals an existing internal-node hash at a
 * different tree height, producing a fraudulent inclusion proof.
 *
 * Odd-leaf-out: the unpaired leaf is duplicated (Bitcoin-style) so the
 * tree is always balanced. Verifier and writer must agree on this.
 *
 * Empty tree: returns sentinel root sha256(0x00) so a "no events this
 * cadence" anchor is still cryptographically distinguishable from a
 * "writer never ran" gap.
 */

import { createHash } from "node:crypto";

const LEAF_PREFIX = Buffer.from([0x00]);
const NODE_PREFIX = Buffer.from([0x01]);

/** Convert a UUID string to its 16-byte network-byte-order Buffer. RFC 4122 form. */
function uuidToBytes(uuidStr: string): Buffer {
	const hex = uuidStr.replace(/-/g, "");
	if (hex.length !== 32 || !/^[0-9a-f]+$/i.test(hex)) {
		throw new Error(
			`audit-verifier/merkle: expected 32 hex chars (UUID), got ${hex.length} for input "${uuidStr}"`,
		);
	}
	return Buffer.from(hex, "hex");
}

/** Convert a 64-char hex SHA-256 digest to its 32-byte Buffer. */
function hexToBytes(hex: string): Buffer {
	if (hex.length !== 64 || !/^[0-9a-f]+$/i.test(hex)) {
		throw new Error(
			`audit-verifier/merkle: expected 64-char hex digest, got ${hex.length} for input "${hex}"`,
		);
	}
	return Buffer.from(hex, "hex");
}

/**
 * leaf = sha256(0x00 || tenant_id_bytes || event_hash_bytes)
 *
 * Locked test vector (see __tests__/merkle.test.ts):
 *   tenant_id  = "11111111-1111-7111-8111-111111111111"
 *   event_hash = "aa".repeat(32)
 *   → leaf_hex = "701e2479c1ad3506b53c1355562082b44dd68112b018e73e4c39a869e680bcb3"
 *
 * If this byte agreement ever drifts between writer and verifier, every
 * cadence ever written becomes unverifiable. The test asserts the exact
 * value above.
 */
export function computeLeafHash(
	tenantId: string,
	eventHashHex: string,
): string {
	return createHash("sha256")
		.update(LEAF_PREFIX)
		.update(uuidToBytes(tenantId))
		.update(hexToBytes(eventHashHex))
		.digest("hex");
}

/** node = sha256(0x01 || left || right) */
function combineNodes(leftHex: string, rightHex: string): string {
	return createHash("sha256")
		.update(NODE_PREFIX)
		.update(hexToBytes(leftHex))
		.update(hexToBytes(rightHex))
		.digest("hex");
}

/**
 * Build a Merkle tree over the leaves and return the root + level
 * structure. The level structure is what `deriveProofPath` walks; it
 * is also useful for diagnostic dumps.
 *
 * The empty-tree sentinel is sha256(0x00) — a deliberately "valid" but
 * recognizable value the verifier checks for when the writer emits an
 * empty-cadence anchor (zero new chain heads in the 15-min window).
 */
export function buildMerkleTree(leaves: string[]): {
	root: string;
	levels: string[][];
} {
	if (leaves.length === 0) {
		const empty = createHash("sha256").update(LEAF_PREFIX).digest("hex");
		return { root: empty, levels: [[]] };
	}
	const levels: string[][] = [leaves.slice()];
	while (true) {
		const current = levels[levels.length - 1];
		if (current.length <= 1) break;
		const next: string[] = [];
		for (let i = 0; i < current.length; i += 2) {
			const left = current[i];
			const right = i + 1 < current.length ? current[i + 1] : current[i];
			next.push(combineNodes(left, right));
		}
		levels.push(next);
	}
	return { root: levels[levels.length - 1][0], levels };
}

/**
 * The shape the writer emits on each tenant slice. `position` names the
 * SIBLING's side at each tree level, NOT the leaf's side.
 *
 * Verification semantics (mirrors the writer's exact replay snippet):
 *
 *     let acc = leafHash;
 *     for (const step of proofPath) {
 *       const left  = step.position === "left"  ? step.hash : acc;
 *       const right = step.position === "right" ? step.hash : acc;
 *       acc = sha256(0x01 || left || right);
 *     }
 *     // acc === expected root
 */
export interface ProofStep {
	hash: string;
	position: "left" | "right";
}

/**
 * Replay a proof path against a leaf hash and return the recomputed
 * root. Empty `proofPath` (single-tenant cadence: leaf == root) returns
 * `leafHash` unchanged — DO NOT remove this case; single-tenant cadences
 * are the dominant production case in early months.
 */
export function verifyProofPath(
	leafHash: string,
	proofPath: ProofStep[],
): string {
	let acc = leafHash;
	for (const step of proofPath) {
		const left = step.position === "left" ? step.hash : acc;
		const right = step.position === "right" ? step.hash : acc;
		acc = combineNodes(left, right);
	}
	return acc;
}

/**
 * The empty-tree sentinel root: sha256(0x00).
 *
 * Exported so the verifier orchestrator can independently recompute it
 * and assert anchor.merkle_root === EMPTY_TREE_ROOT for cadences with
 * proof_keys: []. Without this check, a tampered empty anchor (anyone
 * with bucket-write access could swap arbitrary hex into merkle_root
 * before retention locks) is undetected.
 */
export const EMPTY_TREE_ROOT = createHash("sha256")
	.update(LEAF_PREFIX)
	.digest("hex");
