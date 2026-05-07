/**
 * Integration: compliance-anchor end-to-end against dev
 * compliance.audit_events + compliance.tenant_anchor_state.
 *
 * Phase 3 U8a (docs/plans/2026-05-07-010-feat-compliance-u8a-anchor-lambda-inert-plan.md).
 *
 * Tests cover:
 *   - Empty event set → tenant_count: 0, dispatched: true.
 *   - Multi-tenant fixture → stable Merkle root across runs (determinism).
 *   - Single tenant odd-leaf duplication → leaf == root.
 *   - tenant_anchor_state UPDATE in single transaction (rollback on
 *     anchorFn throw).
 *   - Cadence ID is a valid UUIDv7.
 *   - Body-swap forcing function: getWiredAnchorFn() === _anchor_fn_inert
 *     (Decision #17). When U8b lands and replaces the wired fn with
 *     _anchor_fn_live, this assertion FAILS — and U8b's required fix is
 *     to replace it with a real body-swap safety test (asserting
 *     S3Client.send was called with PutObjectCommand), not to delete it.
 *   - Leaf-encoding fixture (Decision #3): hardcoded
 *     (tenant_id, event_hash) → expected_leaf_hex test vector. U9's
 *     verifier CLI imports this same fixture for cross-implementation
 *     byte agreement.
 *
 * Skipped when DATABASE_URL is unset (CI test job has no Aurora creds).
 *
 * Run locally: `pnpm --filter @thinkwork/lambda test:integration -t compliance-anchor`
 */

import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { createHash } from "node:crypto";
import { eq, inArray, and, gt } from "drizzle-orm";
import { createDb, type Database } from "@thinkwork/database-pg";
import {
	auditEvents,
	auditOutbox,
	tenantAnchorState,
} from "@thinkwork/database-pg/schema";
import {
	_anchor_fn_inert,
	buildMerkleTree,
	computeLeafHash,
	deriveProofPath,
	getWiredAnchorFn,
	readChainHeads,
	runAnchorPass,
	type AnchorResult,
	type TenantSlice,
} from "../../compliance-anchor";

function normalizeNodePgDatabaseUrl(
	url: string | undefined,
): string | undefined {
	return url?.replace("sslmode=require", "sslmode=no-verify");
}

const DATABASE_URL = normalizeNodePgDatabaseUrl(process.env.DATABASE_URL);
const skip = !DATABASE_URL;

// Distinct test tenants — kept separate from the drainer integration test's
// TEST_TENANT so chain-state from drainer tests doesn't pollute anchor
// state expectations.
const ANCHOR_TEST_TENANT_A = "88888888-7888-7888-8888-aaaaaaaaaaaa";
const ANCHOR_TEST_TENANT_B = "88888888-7888-7888-8888-bbbbbbbbbbbb";

const UUIDV7_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const SHA256_HEX_RE = /^[0-9a-f]{64}$/;

// Generates UUIDv7-shape strings unique across the test run. Must produce
// distinct values for distinct `seq` inputs to satisfy the audit_events
// PRIMARY KEY constraint when seedAuditEvents inserts multiple rows.
function uuidLikeV7(seq: number): string {
	const ts = Date.now().toString(16).padStart(12, "0");
	const seqHex = seq.toString(16).padStart(8, "0");
	return `${ts.slice(0, 8)}-${ts.slice(8, 12)}-7${seqHex.slice(0, 3)}-8${seqHex.slice(3, 6)}-${seqHex.slice(0, 8)}${"0".repeat(4)}`;
}

function fakeEventHash(seed: string): string {
	return createHash("sha256").update(seed).digest("hex");
}

async function clearTestState(db: Database, tenants: string[]): Promise<void> {
	// Roll back tenant_anchor_state for the test tenants so each test
	// starts fresh. Direct DELETE is fine on test rows in dev.
	await db
		.delete(tenantAnchorState)
		.where(inArray(tenantAnchorState.tenant_id, tenants));
}

async function seedAuditEvents(
	db: Database,
	tenant: string,
	count: number,
	baseSeq: number,
): Promise<{ eventIds: string[]; lastEventHash: string; lastRecordedAt: Date }> {
	const eventIds: string[] = [];
	let prevHash: string | null = null;
	let lastRecordedAt = new Date();
	for (let i = 0; i < count; i++) {
		const outboxId = uuidLikeV7(baseSeq + i);
		const eventId = uuidLikeV7(baseSeq + 1000 + i);
		eventIds.push(eventId);
		const occurred = new Date(Date.now() + i * 1000);
		const eventHash = fakeEventHash(`${tenant}-${eventId}-${i}`);
		// Insert into audit_outbox first to satisfy outbox_id FK semantics
		// in the chain (the audit_events row references the outbox row).
		// Per 0069 schema, audit_events.outbox_id is NOT NULL but has no FK
		// constraint at the DB level (decoupled by design), so a fake
		// outbox_id works for test seeding.
		const recordedAt = new Date();
		await db.insert(auditEvents).values({
			event_id: eventId,
			outbox_id: outboxId,
			tenant_id: tenant,
			occurred_at: occurred,
			recorded_at: recordedAt,
			actor: "test-actor",
			actor_type: "system",
			source: "test",
			event_type: "auth.signin.success",
			event_hash: eventHash,
			prev_hash: prevHash,
		});
		prevHash = eventHash;
		lastRecordedAt = recordedAt;
	}
	return {
		eventIds,
		lastEventHash: prevHash!,
		lastRecordedAt,
	};
}

async function clearTestAuditEvents(
	db: Database,
	tenants: string[],
): Promise<void> {
	// Direct DELETE on audit_events is blocked by trigger
	// `audit_events_block_delete` (RAISE EXCEPTION on DELETE).
	// Skip cleanup — tests use fresh tenant IDs per run via the timestamp
	// in uuidLikeV7, and tenant_anchor_state cleanup ensures the next
	// run picks up the new events as un-anchored.
	void db;
	void tenants;
}

// ===========================================================================
// Pure unit tests — Merkle math, body-swap forcing function, leaf fixture.
// These don't need a DB and run regardless of skipIf.
// ===========================================================================

describe("compliance-anchor: Merkle math (RFC 6962 domain separation)", () => {
	it("leaf hash uses 0x00 prefix + tenant_id_bytes + event_hash_bytes", () => {
		const tenantId = "11111111-1111-7111-8111-111111111111";
		const eventHashHex = "aa".repeat(32);
		// Manually compute expected: sha256(0x00 || tenant_bytes || event_hash_bytes)
		const expected = createHash("sha256")
			.update(Buffer.from([0x00]))
			.update(Buffer.from(tenantId.replace(/-/g, ""), "hex"))
			.update(Buffer.from(eventHashHex, "hex"))
			.digest("hex");
		expect(computeLeafHash(tenantId, eventHashHex)).toBe(expected);
	});

	it("leaf-encoding fixture — locks cross-implementation byte agreement (Decision #3)", () => {
		// This fixture is the authoritative spec for U9's verifier CLI.
		// Any third-party reimplementation (Java auditor tool, Python
		// verifier, etc.) must produce the same expected_leaf_hex when
		// given the same tenant_id and event_hash inputs.
		//
		// inputs:
		//   tenant_id  = "11111111-1111-7111-8111-111111111111"
		//   event_hash = "aa" repeated 32 times (64-char hex)
		// computed:
		//   leaf = sha256(0x00 || 0x11×4 0x71×1 0x81×1 0x11×9 || 0xaa×32)
		const tenantId = "11111111-1111-7111-8111-111111111111";
		const eventHashHex = "aa".repeat(32);
		const leaf = computeLeafHash(tenantId, eventHashHex);
		// 64-char hex digest — exact value must be stable across all
		// future runs and across cross-implementation verifiers.
		expect(leaf).toMatch(SHA256_HEX_RE);
		// Hardcoded canonical leaf hex — the byte-encoding contract for
		// U9's verifier CLI. Any third-party reimplementation (Java
		// auditor tool, Python verifier, etc.) MUST produce this exact
		// value when fed the same tenant_id + event_hash inputs. If this
		// assertion drifts, U9's verifier CLI must be updated in lockstep
		// — the spec is here, not in code generation.
		expect(leaf).toBe(
			"701e2479c1ad3506b53c1355562082b44dd68112b018e73e4c39a869e680bcb3",
		);
	});

	it("empty tree returns sentinel root sha256(0x00)", () => {
		const { root } = buildMerkleTree([]);
		const expected = createHash("sha256")
			.update(Buffer.from([0x00]))
			.digest("hex");
		expect(root).toBe(expected);
	});

	it("single leaf is also the root", () => {
		const leaf = "ab".repeat(32);
		const { root } = buildMerkleTree([leaf]);
		expect(root).toBe(leaf);
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

	it("three leaves: odd-leaf duplicates (Bitcoin-style)", () => {
		const a = "11".repeat(32);
		const b = "22".repeat(32);
		const c = "33".repeat(32);
		// At level 1: hash(0x01 || a || b), hash(0x01 || c || c)
		// At level 2: hash(0x01 || level1[0] || level1[1])
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

	it("proof path verifies against root", () => {
		const a = "11".repeat(32);
		const b = "22".repeat(32);
		const c = "33".repeat(32);
		const d = "44".repeat(32);
		const { root, levels } = buildMerkleTree([a, b, c, d]);
		// Verify leaf b (index 1) by replaying its proof path.
		const path = deriveProofPath(levels, 1);
		let acc = b;
		for (const step of path) {
			const left = step.position === "left" ? step.hash : acc;
			const right = step.position === "right" ? step.hash : acc;
			acc = createHash("sha256")
				.update(Buffer.from([0x01]))
				.update(Buffer.from(left, "hex"))
				.update(Buffer.from(right, "hex"))
				.digest("hex");
		}
		expect(acc).toBe(root);
	});
});

describe("compliance-anchor: body-swap forcing function (Decision #17)", () => {
	it("getWiredAnchorFn() returns _anchor_fn_inert in U8a", () => {
		// **When U8b lands and replaces the wired fn with `_anchor_fn_live`**,
		// this assertion FAILS — and the U8b PR's required fix is to
		// replace it with a real body-swap safety test (asserting
		// S3Client.send was called with PutObjectCommand), NOT to delete it.
		// This is the structural defense against U8b shipping the live
		// function without its safety test.
		expect(getWiredAnchorFn()).toBe(_anchor_fn_inert);
	});

	it("_anchor_fn_inert returns {anchored: false} regardless of inputs", () => {
		const result = _anchor_fn_inert("0".repeat(64), []);
		expect(result.anchored).toBe(false);
	});
});

// ===========================================================================
// DB-backed integration tests — skipped in CI (no DATABASE_URL).
// ===========================================================================

describe.skipIf(skip)(
	"compliance-anchor: integration against dev DB",
	() => {
		const tenants = [ANCHOR_TEST_TENANT_A, ANCHOR_TEST_TENANT_B];

		beforeEach(async () => {
			const db = createDb(DATABASE_URL!);
			await clearTestState(db, tenants);
		});

		afterAll(async () => {
			const db = createDb(DATABASE_URL!);
			await clearTestState(db, tenants);
		});

		it("empty event set returns tenant_count: 0, dispatched: true", async () => {
			const db = createDb(DATABASE_URL!);
			// Seed tenant_anchor_state with a future timestamp so all events
			// are "already anchored" — yields an empty chain-head set.
			const farFuture = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);
			await db
				.insert(tenantAnchorState)
				.values({
					tenant_id: ANCHOR_TEST_TENANT_A,
					last_anchored_recorded_at: farFuture,
				})
				.onConflictDoUpdate({
					target: tenantAnchorState.tenant_id,
					set: { last_anchored_recorded_at: farFuture },
				});

			const result = await runAnchorPass({
				readerDb: db,
				drainerDb: db,
			});

			expect(result.dispatched).toBe(true);
			expect(result.anchored).toBe(false);
			expect(result.tenant_count).toBe(0);
			expect(result.merkle_root).toMatch(SHA256_HEX_RE);
			expect(result.cadence_id).toMatch(UUIDV7_RE);
		});

		it("multi-tenant fixture produces deterministic Merkle root across runs", async () => {
			const db = createDb(DATABASE_URL!);
			const baseSeq = Math.floor(Date.now() / 1000);
			const a = await seedAuditEvents(
				db,
				ANCHOR_TEST_TENANT_A,
				3,
				baseSeq,
			);
			const b = await seedAuditEvents(
				db,
				ANCHOR_TEST_TENANT_B,
				2,
				baseSeq + 100,
			);

			const result = await runAnchorPass({
				readerDb: db,
				drainerDb: db,
			});

			expect(result.dispatched).toBe(true);
			expect(result.anchored).toBe(false);
			expect(result.tenant_count).toBe(2);
			expect(result.merkle_root).toMatch(SHA256_HEX_RE);

			// Re-running on the same chain heads (after rolling back
			// tenant_anchor_state) produces the same root — determinism.
			await clearTestState(db, tenants);
			const result2 = await runAnchorPass({
				readerDb: db,
				drainerDb: db,
			});
			expect(result2.merkle_root).toBe(result.merkle_root);

			// Sanity: chain heads carry the latest event hashes per tenant.
			const heads = await readChainHeads(db);
			const tenantA = heads.find(
				(h) => h.tenant_id === ANCHOR_TEST_TENANT_A,
			);
			const tenantB = heads.find(
				(h) => h.tenant_id === ANCHOR_TEST_TENANT_B,
			);
			// Note: by this point we've cleared and reset twice so the
			// re-run only sees the SAME events. Heads should reflect the
			// max-seq event per tenant.
			expect(tenantA?.event_hash).toBe(a.lastEventHash);
			expect(tenantB?.event_hash).toBe(b.lastEventHash);
		});

		it("cadence ID is a valid UUIDv7", async () => {
			const db = createDb(DATABASE_URL!);
			const result = await runAnchorPass({
				readerDb: db,
				drainerDb: db,
			});
			expect(result.cadence_id).toMatch(UUIDV7_RE);
		});

		it("anchorFn throw rolls back tenant_anchor_state UPDATE (transaction safety)", async () => {
			const db = createDb(DATABASE_URL!);
			const baseSeq = Math.floor(Date.now() / 1000) + 200;
			await seedAuditEvents(db, ANCHOR_TEST_TENANT_A, 2, baseSeq);

			await expect(
				runAnchorPass({
					readerDb: db,
					drainerDb: db,
					anchorFn: () => {
						throw new Error("simulated seam failure");
					},
				}),
			).rejects.toThrow("simulated seam failure");

			// tenant_anchor_state was NOT advanced.
			const rows = await db
				.select()
				.from(tenantAnchorState)
				.where(eq(tenantAnchorState.tenant_id, ANCHOR_TEST_TENANT_A));
			expect(rows.length).toBe(0);
		});
	},
);
