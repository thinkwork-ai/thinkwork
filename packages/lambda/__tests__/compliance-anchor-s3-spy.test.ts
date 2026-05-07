/**
 * compliance-anchor body-swap safety — Layer 2 (S3-spy mock).
 *
 * Phase 3 U8b. Pairs with the Layer 1 identity assertion in
 * compliance-anchor.integration.test.ts (`getWiredAnchorFn() === _anchor_fn_live`).
 *
 * Layer 1 alone is insufficient: a future PR could rename the symbol or
 * wrap it in a passthrough that skips S3 entirely while still satisfying
 * `===`. This file's `S3Client.send` mock asserts the live function ACTUALLY
 * issues a PutObjectCommand against the anchors/ prefix with Object Lock
 * retention — the structural defense against silent regression of WORM-
 * locked compliance evidence.
 *
 * The mock pattern is `class { send = mockS3Send }`, mirroring
 * routine-task-python.test.ts:39-46. Assertion target is `mockS3Send`
 * directly (NOT S3Client.prototype.send).
 *
 * Module-load env snapshot is set inside vi.hoisted() so it lands BEFORE
 * compliance-anchor.ts's getAnchorEnv() runs at import time.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockS3Send } = vi.hoisted(() => {
	process.env.COMPLIANCE_ANCHOR_BUCKET_NAME = "test-anchor-bucket";
	process.env.COMPLIANCE_ANCHOR_KMS_KEY_ARN =
		"arn:aws:kms:us-east-1:123456789012:key/00000000-0000-0000-0000-000000000000";
	process.env.COMPLIANCE_ANCHOR_RETENTION_DAYS = "365";
	process.env.COMPLIANCE_ANCHOR_OBJECT_LOCK_MODE = "GOVERNANCE";
	process.env.AWS_REGION = "us-east-1";
	process.env.STAGE = "dev";
	return { mockS3Send: vi.fn() };
});

vi.mock("@aws-sdk/client-s3", () => ({
	S3Client: class {
		send = mockS3Send;
	},
	PutObjectCommand: class PutObjectCommand {
		input: unknown;
		constructor(input: unknown) {
			this.input = input;
		}
	},
}));

import { _anchor_fn_live, type TenantSlice } from "../compliance-anchor";
import { computeLeafHash, buildMerkleTree } from "../compliance-anchor";

beforeEach(() => {
	mockS3Send.mockReset();
	mockS3Send.mockResolvedValue({});
});

describe("compliance-anchor: body-swap forcing function — Layer 2 (S3-spy)", () => {
	it("_anchor_fn_live calls S3.send with PutObjectCommand for the anchor key", async () => {
		const tenantA = "11111111-1111-7111-8111-111111111111";
		const tenantB = "22222222-2222-7222-8222-222222222222";
		const eventA = "aa".repeat(32);
		const eventB = "bb".repeat(32);

		const leafA = computeLeafHash(tenantA, eventA);
		const leafB = computeLeafHash(tenantB, eventB);
		const { root } = buildMerkleTree([leafA, leafB]);

		const slices: TenantSlice[] = [
			{
				tenant_id: tenantA,
				latest_event_hash: eventA,
				latest_recorded_at: new Date(0).toISOString(),
				latest_event_id: "aaaaaaaa-aaaa-7aaa-8aaa-aaaaaaaaaaaa",
				leaf_hash: leafA,
				proof_path: [{ hash: leafB, position: "right" }],
			},
			{
				tenant_id: tenantB,
				latest_event_hash: eventB,
				latest_recorded_at: new Date(0).toISOString(),
				latest_event_id: "bbbbbbbb-bbbb-7bbb-8bbb-bbbbbbbbbbbb",
				leaf_hash: leafB,
				proof_path: [{ hash: leafA, position: "left" }],
			},
		];

		const cadenceId = "01234567-89ab-7cde-8f01-23456789abcd";

		const result = await _anchor_fn_live(root, slices, cadenceId);

		// 2 slice writes + 1 anchor write = 3 PutObject calls.
		expect(mockS3Send).toHaveBeenCalledTimes(3);

		// Inspect every call — each must be a PutObjectCommand-like object
		// with the expected bucket + SSE-KMS shape.
		const calls = mockS3Send.mock.calls.map(
			(c: unknown[]) => (c[0] as { input: Record<string, unknown> }).input,
		);
		for (const input of calls) {
			expect(input.Bucket).toBe("test-anchor-bucket");
			expect(input.ServerSideEncryption).toBe("aws:kms");
			expect(input.SSEKMSKeyId).toMatch(/^arn:aws:kms:/);
			expect(input.ChecksumAlgorithm).toBe("SHA256");
		}

		// One of the calls must target the anchors/ prefix with Object Lock.
		const anchorCall = calls.find(
			(c) => typeof c.Key === "string" && (c.Key as string).startsWith("anchors/"),
		);
		expect(anchorCall).toBeDefined();
		expect(anchorCall!.Key).toBe(`anchors/cadence-${cadenceId}.json`);
		expect(anchorCall!.ObjectLockMode).toBe("GOVERNANCE");
		expect(anchorCall!.ObjectLockRetainUntilDate).toBeInstanceOf(Date);

		// Slice calls target proofs/tenant-{id}/cadence-{id}.json and DO NOT
		// carry per-object ObjectLock overrides (bucket-default applies).
		const sliceCalls = calls.filter(
			(c) => typeof c.Key === "string" && (c.Key as string).startsWith("proofs/"),
		);
		expect(sliceCalls).toHaveLength(2);
		for (const sc of sliceCalls) {
			expect(sc.Key).toMatch(
				/^proofs\/tenant-[0-9a-f-]+\/cadence-[0-9a-f-]+\.json$/,
			);
			expect(sc.ObjectLockMode).toBeUndefined();
			expect(sc.ObjectLockRetainUntilDate).toBeUndefined();
		}

		// Return shape — verifier-discoverable commit point.
		expect(result.anchored).toBe(true);
		expect(result.s3_key).toBe(`anchors/cadence-${cadenceId}.json`);
		expect(typeof result.retain_until_date).toBe("string");
	});

	it("_anchor_fn_live rejects when merkleRoot does not match the leaf set (Decision #16)", async () => {
		const tenantA = "11111111-1111-7111-8111-111111111111";
		const slices: TenantSlice[] = [
			{
				tenant_id: tenantA,
				latest_event_hash: "aa".repeat(32),
				latest_recorded_at: new Date(0).toISOString(),
				latest_event_id: "aaaaaaaa-aaaa-7aaa-8aaa-aaaaaaaaaaaa",
				leaf_hash: computeLeafHash(tenantA, "aa".repeat(32)),
				proof_path: [],
			},
		];
		const wrongRoot = "ff".repeat(32);

		await expect(
			_anchor_fn_live(wrongRoot, slices, "01234567-89ab-7cde-8f01-23456789abcd"),
		).rejects.toThrow(/leaf-set \/ merkleRoot mismatch/);

		// No PutObjects fire when the self-check fails.
		expect(mockS3Send).not.toHaveBeenCalled();
	});

	it("_anchor_fn_live writes anchor LAST — slices succeed before anchor PutObject", async () => {
		const tenantA = "11111111-1111-7111-8111-111111111111";
		const leafA = computeLeafHash(tenantA, "aa".repeat(32));
		const { root } = buildMerkleTree([leafA]);
		const slices: TenantSlice[] = [
			{
				tenant_id: tenantA,
				latest_event_hash: "aa".repeat(32),
				latest_recorded_at: new Date(0).toISOString(),
				latest_event_id: "aaaaaaaa-aaaa-7aaa-8aaa-aaaaaaaaaaaa",
				leaf_hash: leafA,
				proof_path: [],
			},
		];

		// Track call order — slice key must appear before anchor key.
		const observedKeys: string[] = [];
		mockS3Send.mockImplementation(
			async (cmd: { input: { Key: string } }) => {
				observedKeys.push(cmd.input.Key);
				return {};
			},
		);

		await _anchor_fn_live(
			root,
			slices,
			"01234567-89ab-7cde-8f01-23456789abcd",
		);

		expect(observedKeys[0]).toMatch(/^proofs\//);
		expect(observedKeys[observedKeys.length - 1]).toMatch(/^anchors\//);
	});
});
