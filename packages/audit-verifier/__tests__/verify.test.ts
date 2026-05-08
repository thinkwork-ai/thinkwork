import { describe, expect, it, vi } from "vitest";
import {
	EMPTY_TREE_ROOT,
	buildMerkleTree,
	computeLeafHash,
	verifyBucket,
} from "../src/index";

/**
 * verifyBucket() integration tests against a mocked S3Client.
 *
 * Each test stitches together:
 *   - a synthetic anchor body (writer-shape JSON)
 *   - per-tenant slice bodies (writer-shape JSON)
 *   - a mock S3Client that hands them out by Key
 * Then runs the orchestrator and asserts the report shape.
 *
 * Adversarial fixtures (tampered anchor / slice) live alongside the
 * happy path so the byte-agreement chain catches every recorded
 * mismatch reason: leaf_drift, root_mismatch, slice_root_drift,
 * slice_missing, empty_tree_root_mismatch.
 */

interface SliceBody {
	schema_version: 1;
	tenant_id: string;
	latest_event_hash: string;
	latest_recorded_at: string;
	latest_event_id: string;
	leaf_hash: string;
	proof_path: { hash: string; position: "left" | "right" }[];
	global_root: string;
	cadence_id: string;
}

interface AnchorBody {
	schema_version: 1;
	cadence_id: string;
	recorded_at: string;
	merkle_root: string;
	tenant_count: number;
	anchored_event_count: number;
	recorded_at_range: { min: string; max: string } | null;
	leaf_algorithm: "sha256_rfc6962";
	proof_keys: string[];
}

const TENANT_A = "11111111-1111-7111-8111-111111111111";
const TENANT_B = "22222222-2222-7222-8222-222222222222";
const CADENCE_ID = "0196b0f2-0800-7000-8000-000000000001";

function buildSyntheticCadence(opts?: { tenants?: number }): {
	anchor: AnchorBody;
	slices: SliceBody[];
	anchorKey: string;
	sliceKeys: string[];
} {
	const tenants = opts?.tenants ?? 2;
	const tenantIds = [TENANT_A, TENANT_B].slice(0, tenants);
	const eventHashes = ["aa".repeat(32), "bb".repeat(32)].slice(0, tenants);

	// Compute leaves the same way the writer does.
	const leaves = tenantIds.map((tid, i) => computeLeafHash(tid, eventHashes[i]));
	const { root, levels } = buildMerkleTree(leaves);

	const sliceKeys = tenantIds.map(
		(tid) => `proofs/tenant-${tid}/cadence-${CADENCE_ID}.json`,
	);
	const anchorKey = `anchors/cadence-${CADENCE_ID}.json`;

	const slices: SliceBody[] = tenantIds.map((tid, i) => {
		// For 2-leaf tree, leaf at index i has sibling at 1-i.
		const proofPath: { hash: string; position: "left" | "right" }[] =
			tenants === 1
				? []
				: [
						{
							hash: leaves[1 - i],
							position: i === 0 ? "right" : "left",
						},
					];
		return {
			schema_version: 1,
			tenant_id: tid,
			latest_event_hash: eventHashes[i],
			latest_recorded_at: "2026-05-07T11:59:00.000Z",
			latest_event_id: `0196b0f2-0800-7000-8000-00000000000${i}`,
			leaf_hash: leaves[i],
			proof_path: proofPath,
			global_root: root,
			cadence_id: CADENCE_ID,
		};
	});
	// `levels` is computed by buildMerkleTree but the synthetic-cadence
	// fixture only needs the root. Keep the destructuring for clarity at
	// call sites that might want to inspect intermediate levels later.
	void levels;

	const anchor: AnchorBody = {
		schema_version: 1,
		cadence_id: CADENCE_ID,
		recorded_at: "2026-05-07T12:00:00.000Z",
		merkle_root: root,
		tenant_count: tenants,
		anchored_event_count: tenants,
		recorded_at_range: {
			min: "2026-05-07T11:45:00.000Z",
			max: "2026-05-07T11:59:30.000Z",
		},
		leaf_algorithm: "sha256_rfc6962",
		proof_keys: sliceKeys,
	};

	return { anchor, slices, anchorKey, sliceKeys };
}

function bodyStream(payload: unknown) {
	return {
		transformToString: async (_enc: string) => JSON.stringify(payload),
	};
}

function makeS3Mock(state: {
	listResponses: { Contents: { Key: string; LastModified: Date }[]; IsTruncated: boolean }[];
	bodies: Record<string, unknown>;
	missingKeys?: Set<string>;
}) {
	const listQueue = [...state.listResponses];
	return {
		send: vi.fn(async (cmd: { input: { Key?: string }; constructor: { name: string } }) => {
			const cmdName = cmd.constructor.name;
			if (cmdName === "ListObjectsV2Command") {
				if (listQueue.length === 0) {
					return { Contents: [], IsTruncated: false };
				}
				return listQueue.shift();
			}
			if (cmdName === "GetObjectCommand") {
				const key = cmd.input.Key ?? "";
				if (state.missingKeys?.has(key)) {
					const err = Object.assign(new Error("not found"), {
						name: "NoSuchKey",
					});
					throw err;
				}
				const body = state.bodies[key];
				if (!body) {
					const err = Object.assign(new Error("missing in fixture"), {
						name: "NoSuchKey",
					});
					throw err;
				}
				return { Body: bodyStream(body) };
			}
			throw new Error(`mockS3: unexpected command ${cmdName}`);
		}),
	} as unknown as Parameters<typeof verifyBucket>[0]["s3Client"];
}

describe("verifyBucket — happy path", () => {
	it("verifies a synthetic 1-cadence 2-tenant bucket cleanly", async () => {
		const { anchor, slices, anchorKey, sliceKeys } = buildSyntheticCadence();
		const s3 = makeS3Mock({
			listResponses: [
				{
					Contents: [
						{
							Key: anchorKey,
							LastModified: new Date("2026-05-07T12:00:00.000Z"),
						},
					],
					IsTruncated: false,
				},
			],
			bodies: {
				[anchorKey]: anchor,
				[sliceKeys[0]]: slices[0],
				[sliceKeys[1]]: slices[1],
			},
		});

		const report = await verifyBucket({
			bucket: "test",
			region: "us-east-1",
			s3Client: s3,
		});

		expect(report.verified).toBe(true);
		expect(report.cadences_checked).toBe(1);
		expect(report.anchors_verified).toBe(1);
		expect(report.merkle_root_mismatches).toEqual([]);
		expect(report.parse_failures).toEqual([]);
		expect(report.schema_drift).toEqual([]);
		expect(report.first_anchor_at).toBe("2026-05-07T12:00:00.000Z");
		expect(report.last_anchor_at).toBe("2026-05-07T12:00:00.000Z");
	});

	it("verifies an empty bucket as vacuously verified", async () => {
		const s3 = makeS3Mock({
			listResponses: [{ Contents: [], IsTruncated: false }],
			bodies: {},
		});
		const report = await verifyBucket({
			bucket: "test",
			region: "us-east-1",
			s3Client: s3,
		});
		expect(report.verified).toBe(true);
		expect(report.cadences_checked).toBe(0);
		expect(report.anchors_verified).toBe(0);
	});
});

describe("verifyBucket — mismatch reasons", () => {
	it("flags merkle_root mutation as 'root_mismatch'", async () => {
		const { anchor, slices, anchorKey, sliceKeys } = buildSyntheticCadence();
		// Mutate the anchor's claimed root (writer-bug or tamper simulation).
		const wrongRoot = "ff".repeat(32);
		anchor.merkle_root = wrongRoot;
		// Slice global_root still says the OLD root → also flags slice_root_drift.
		const s3 = makeS3Mock({
			listResponses: [
				{
					Contents: [
						{
							Key: anchorKey,
							LastModified: new Date("2026-05-07T12:00:00.000Z"),
						},
					],
					IsTruncated: false,
				},
			],
			bodies: {
				[anchorKey]: anchor,
				[sliceKeys[0]]: slices[0],
				[sliceKeys[1]]: slices[1],
			},
		});
		const report = await verifyBucket({
			bucket: "test",
			region: "us-east-1",
			s3Client: s3,
		});
		expect(report.verified).toBe(false);
		// Both slices replay to the OLD root, which differs from the
		// (mutated) anchor root → root_mismatch on both.
		// Their global_root field still says the OLD root, which now
		// differs from the (mutated) anchor root → slice_root_drift.
		// First match is captured per slice (root_mismatch fires first).
		expect(
			report.merkle_root_mismatches.some(
				(m) => m.reason === "root_mismatch",
			),
		).toBe(true);
		expect(report.anchors_verified).toBe(0);
	});

	it("flags slice leaf_hash mutation as 'leaf_drift'", async () => {
		const { anchor, slices, anchorKey, sliceKeys } = buildSyntheticCadence();
		// Mutate slice 0's leaf_hash so recompute disagrees.
		slices[0].leaf_hash = "00".repeat(32);
		const s3 = makeS3Mock({
			listResponses: [
				{
					Contents: [
						{
							Key: anchorKey,
							LastModified: new Date("2026-05-07T12:00:00.000Z"),
						},
					],
					IsTruncated: false,
				},
			],
			bodies: {
				[anchorKey]: anchor,
				[sliceKeys[0]]: slices[0],
				[sliceKeys[1]]: slices[1],
			},
		});
		const report = await verifyBucket({
			bucket: "test",
			region: "us-east-1",
			s3Client: s3,
		});
		expect(report.verified).toBe(false);
		expect(
			report.merkle_root_mismatches.find((m) => m.reason === "leaf_drift"),
		).toBeDefined();
	});

	it("flags slice global_root drift independently from anchor mutation", async () => {
		const { anchor, slices, anchorKey, sliceKeys } = buildSyntheticCadence();
		slices[0].global_root = "ee".repeat(32); // disagrees with anchor.merkle_root
		const s3 = makeS3Mock({
			listResponses: [
				{
					Contents: [
						{
							Key: anchorKey,
							LastModified: new Date("2026-05-07T12:00:00.000Z"),
						},
					],
					IsTruncated: false,
				},
			],
			bodies: {
				[anchorKey]: anchor,
				[sliceKeys[0]]: slices[0],
				[sliceKeys[1]]: slices[1],
			},
		});
		const report = await verifyBucket({
			bucket: "test",
			region: "us-east-1",
			s3Client: s3,
		});
		expect(report.verified).toBe(false);
		expect(
			report.merkle_root_mismatches.find(
				(m) => m.reason === "slice_root_drift",
			),
		).toBeDefined();
	});

	it("flags missing slice key as 'slice_missing'", async () => {
		const { anchor, slices, anchorKey, sliceKeys } = buildSyntheticCadence();
		const s3 = makeS3Mock({
			listResponses: [
				{
					Contents: [
						{
							Key: anchorKey,
							LastModified: new Date("2026-05-07T12:00:00.000Z"),
						},
					],
					IsTruncated: false,
				},
			],
			bodies: {
				[anchorKey]: anchor,
				[sliceKeys[1]]: slices[1],
			},
			missingKeys: new Set([sliceKeys[0]]),
		});
		const report = await verifyBucket({
			bucket: "test",
			region: "us-east-1",
			s3Client: s3,
		});
		expect(report.verified).toBe(false);
		expect(
			report.merkle_root_mismatches.find(
				(m) => m.reason === "slice_missing",
			),
		).toBeDefined();
	});
});

describe("verifyBucket — empty-cadence sentinel root (Decision-#5a writer behavior)", () => {
	it("verifies an empty cadence whose anchor merkle_root === EMPTY_TREE_ROOT", async () => {
		const anchor: AnchorBody = {
			schema_version: 1,
			cadence_id: CADENCE_ID,
			recorded_at: "2026-05-07T12:00:00.000Z",
			merkle_root: EMPTY_TREE_ROOT,
			tenant_count: 0,
			anchored_event_count: 0,
			recorded_at_range: null,
			leaf_algorithm: "sha256_rfc6962",
			proof_keys: [],
		};
		const anchorKey = `anchors/cadence-${CADENCE_ID}.json`;
		const s3 = makeS3Mock({
			listResponses: [
				{
					Contents: [
						{
							Key: anchorKey,
							LastModified: new Date("2026-05-07T12:00:00.000Z"),
						},
					],
					IsTruncated: false,
				},
			],
			bodies: { [anchorKey]: anchor },
		});
		const report = await verifyBucket({
			bucket: "test",
			region: "us-east-1",
			s3Client: s3,
		});
		expect(report.verified).toBe(true);
		expect(report.anchors_verified).toBe(1);
	});

	it("flags a tampered empty cadence (proof_keys=[] but merkle_root != sha256(0x00))", async () => {
		// Adversarial: tampered anchor swaps in arbitrary hex when
		// proof_keys is empty. Without the sentinel check this would be
		// silently "verified". Plan §U5 + ce-doc-review F1.
		const anchor: AnchorBody = {
			schema_version: 1,
			cadence_id: CADENCE_ID,
			recorded_at: "2026-05-07T12:00:00.000Z",
			merkle_root: "ff".repeat(32), // NOT EMPTY_TREE_ROOT
			tenant_count: 0,
			anchored_event_count: 0,
			recorded_at_range: null,
			leaf_algorithm: "sha256_rfc6962",
			proof_keys: [],
		};
		const anchorKey = `anchors/cadence-${CADENCE_ID}.json`;
		const s3 = makeS3Mock({
			listResponses: [
				{
					Contents: [
						{
							Key: anchorKey,
							LastModified: new Date("2026-05-07T12:00:00.000Z"),
						},
					],
					IsTruncated: false,
				},
			],
			bodies: { [anchorKey]: anchor },
		});
		const report = await verifyBucket({
			bucket: "test",
			region: "us-east-1",
			s3Client: s3,
		});
		expect(report.verified).toBe(false);
		const mismatch = report.merkle_root_mismatches.find(
			(m) => m.reason === "empty_tree_root_mismatch",
		);
		expect(mismatch).toBeDefined();
		expect(mismatch?.expected).toBe(EMPTY_TREE_ROOT);
	});
});

describe("verifyBucket — schema_drift vs parse_failures", () => {
	it("routes schema_version mismatch to schema_drift[] and CONTINUES", async () => {
		const tamperedAnchor = {
			schema_version: 999,
			cadence_id: "0196b0f2-0800-7000-8000-000000000001",
			anything_else: true,
		};
		const anchorKey = `anchors/cadence-future.json`;
		const s3 = makeS3Mock({
			listResponses: [
				{
					Contents: [
						{
							Key: anchorKey,
							LastModified: new Date("2026-05-07T12:00:00.000Z"),
						},
					],
					IsTruncated: false,
				},
			],
			bodies: { [anchorKey]: tamperedAnchor },
		});
		const report = await verifyBucket({
			bucket: "test",
			region: "us-east-1",
			s3Client: s3,
		});
		expect(report.verified).toBe(false);
		expect(report.schema_drift).toHaveLength(1);
		expect(report.schema_drift[0].schema_version).toBe(999);
		expect(report.parse_failures).toHaveLength(0);
		expect(report.cadences_checked).toBe(1);
	});

	it("routes malformed v1 to parse_failures[] (NOT schema_drift)", async () => {
		const malformed = {
			schema_version: 1,
			merkle_root: "not-a-valid-hex",
		};
		const anchorKey = `anchors/cadence-malformed.json`;
		const s3 = makeS3Mock({
			listResponses: [
				{
					Contents: [
						{
							Key: anchorKey,
							LastModified: new Date("2026-05-07T12:00:00.000Z"),
						},
					],
					IsTruncated: false,
				},
			],
			bodies: { [anchorKey]: malformed },
		});
		const report = await verifyBucket({
			bucket: "test",
			region: "us-east-1",
			s3Client: s3,
		});
		expect(report.verified).toBe(false);
		expect(report.parse_failures).toHaveLength(1);
		expect(report.parse_failures[0].key).toBe(anchorKey);
		expect(report.schema_drift).toHaveLength(0);
	});
});

describe("verifyBucket — flags echo + report shape", () => {
	it("echoes invocation flags into the report", async () => {
		const s3 = makeS3Mock({
			listResponses: [{ Contents: [], IsTruncated: false }],
			bodies: {},
		});
		const since = new Date("2026-04-01T00:00:00.000Z");
		const until = new Date("2026-05-01T00:00:00.000Z");
		const report = await verifyBucket({
			bucket: "test",
			region: "us-east-1",
			since,
			until,
			tenantId: TENANT_A,
			concurrency: 4,
			checkRetention: false,
			checkChain: false,
			s3Client: s3,
		});
		expect(report.flags.since).toBe("2026-04-01T00:00:00.000Z");
		expect(report.flags.until).toBe("2026-05-01T00:00:00.000Z");
		expect(report.flags.tenant_id).toBe(TENANT_A);
		expect(report.flags.concurrency).toBe(4);
		expect(report.flags.check_retention).toBe(false);
		expect(report.flags.check_chain).toBe(false);
	});

	it("--check-chain without --db-url throws (orchestrator → exit 2)", async () => {
		const s3 = makeS3Mock({
			listResponses: [{ Contents: [], IsTruncated: false }],
			bodies: {},
		});
		await expect(
			verifyBucket({
				bucket: "test",
				region: "us-east-1",
				checkChain: true,
				s3Client: s3,
			}),
		).rejects.toThrow(/db-url/);
	});
});
