/**
 * Compliance Anchor Lambda — INERT in U8a
 *
 * Phase 3 U8a of the System Workflows revert + Compliance reframe.
 *
 * Single-writer (reserved-concurrency=1), AWS Scheduler `rate(15 minutes)`
 * scheduled Lambda that:
 *   1. Selects the per-tenant chain head from `compliance.audit_events`
 *      where `recorded_at > tenant_anchor_state.last_anchored_recorded_at`
 *      (using compliance_reader Aurora role).
 *   2. Computes a global Merkle tree across the tenant chain heads, with
 *      RFC 6962-style domain separation: leaf = sha256(0x00 || tenant_id_bytes
 *      || event_hash_bytes); node = sha256(0x01 || left || right). The
 *      domain prefixes prevent second-preimage forgery of the proof path.
 *   3. Calls `_anchor_fn_inert(merkleRoot, tenantSlices)` — in U8a this
 *      returns `{anchored: false, dispatched: true, ...}` without writing
 *      to S3. U8b swaps in `_anchor_fn_live` with real PutObject + Object
 *      Lock retention writes.
 *   4. Updates `compliance.tenant_anchor_state` with the new high-water-mark
 *      per tenant in a single transaction (using compliance_drainer Aurora
 *      role).
 *
 * Two PG connections per invocation (Decision #6):
 *   - compliance_reader for the SELECT on audit_events (preserves
 *     least-privilege on the read path).
 *   - compliance_drainer for the UPDATE on tenant_anchor_state. Reusing
 *     the drainer role for tenant_anchor_state writes avoids a 4th
 *     Aurora role + secret + bootstrap-script extension (Decision #5).
 *
 * Ordering invariant (Decision #6): the reader-side SELECT runs to
 * completion (rows materialized in memory) before the drainer-side
 * BEGIN. Two PG sessions, two transactions; the reader's snapshot is
 * what the Merkle tree was computed against, so the drainer's UPDATE
 * must not start inside the reader's transaction.
 *
 * Plan: docs/plans/2026-05-07-010-feat-compliance-u8a-anchor-lambda-inert-plan.md
 */

import { createHash } from "node:crypto";
import { createDb, type Database } from "@thinkwork/database-pg";
import { tenantAnchorState } from "@thinkwork/database-pg/schema";
import { sql } from "drizzle-orm";
import pLimit from "p-limit";
import {
	S3Client,
	PutObjectCommand,
	type S3ClientConfig,
} from "@aws-sdk/client-s3";
// Note: @aws-sdk/client-cloudwatch is intentionally NOT imported here.
// In U8b the anchor Lambda still emits no metrics directly (only the
// watchdog does, from its own dedicated client). The S3 PutObject IS
// the live signal; metrics are watchdog-side via `ComplianceAnchorGap`.

// ---------------------------------------------------------------------------
// Domain-separation prefix bytes — RFC 6962 §2.1.
//
// Without these, leaf and internal-node hashes are interchangeable.
// An attacker controlling audit-event content could construct a 48-byte
// leaf input whose hash equals an existing internal node hash at a
// different tree height, producing a fraudulent inclusion proof. The
// 0x00 / 0x01 prefix bytes cost one byte per hash call and prevent the
// attack.
// ---------------------------------------------------------------------------

const LEAF_PREFIX = Buffer.from([0x00]);
const NODE_PREFIX = Buffer.from([0x01]);

// ---------------------------------------------------------------------------
// Public types — exported for U6 integration tests, U7 smoke gate, U9
// verifier CLI. Field set is the load-bearing seam contract; U8b adds
// optional `s3_key` / `retain_until_date` but cannot remove or rename
// these.
// ---------------------------------------------------------------------------

export interface TenantSlice {
	tenant_id: string;
	latest_event_hash: string;
	latest_recorded_at: string;
	latest_event_id: string;
	leaf_hash: string;
	proof_path: Array<{ hash: string; position: "left" | "right" }>;
}

export interface AnchorResult {
	dispatched: true;
	anchored: boolean;
	merkle_root: string;
	tenant_count: number;
	anchored_event_count: number;
	cadence_id: string;
	// Optional U8b additions:
	s3_key?: string;
	retain_until_date?: string;
}

export type AnchorFn = (
	merkleRoot: string,
	tenantSlices: TenantSlice[],
	cadenceId: string,
) => Promise<
	Pick<AnchorResult, "anchored"> & Partial<Pick<AnchorResult, "s3_key" | "retain_until_date">>
>;

// ---------------------------------------------------------------------------
// Merkle tree (RFC 6962-style domain separation)
// ---------------------------------------------------------------------------

/** UUID-string → 16-byte network-byte-order Buffer. RFC 4122 form. */
function uuidToBytes(uuidStr: string): Buffer {
	return Buffer.from(uuidStr.replace(/-/g, ""), "hex");
}

/** Hex 64-char SHA-256 digest → 32-byte Buffer. */
function hexToBytes(hex: string): Buffer {
	if (hex.length !== 64) {
		throw new Error(`expected 64-char hex digest, got ${hex.length}`);
	}
	return Buffer.from(hex, "hex");
}

/** leaf = sha256(0x00 || tenant_id_bytes || event_hash_bytes). */
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

/** node = sha256(0x01 || left || right). */
function combineNodes(leftHex: string, rightHex: string): string {
	return createHash("sha256")
		.update(NODE_PREFIX)
		.update(hexToBytes(leftHex))
		.update(hexToBytes(rightHex))
		.digest("hex");
}

/**
 * Build a Merkle tree over the leaves and return the root hex + the
 * full level structure (used to derive per-leaf proof paths).
 *
 * Empty input: returns a sentinel root `sha256(0x00)` so the watchdog
 * can distinguish "anchor ran with zero events" from "anchor never ran".
 *
 * Odd-leaf-out: the unpaired leaf is duplicated (Bitcoin-style) so the
 * tree is always balanced. Verifier must replay the same convention.
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
	while (levels[levels.length - 1].length > 1) {
		const current = levels[levels.length - 1];
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
 * Derive the proof path for the leaf at `leafIndex`. Each step is the
 * sibling hash + which side the sibling sits on (`"left"` or `"right"`).
 * Verifier replays: starting from the leaf hash, hash with each sibling
 * at the named position to recompute the root.
 */
export function deriveProofPath(
	levels: string[][],
	leafIndex: number,
): Array<{ hash: string; position: "left" | "right" }> {
	const path: Array<{ hash: string; position: "left" | "right" }> = [];
	let idx = leafIndex;
	for (let level = 0; level < levels.length - 1; level++) {
		const layer = levels[level];
		const isRightChild = idx % 2 === 1;
		const siblingIdx = isRightChild ? idx - 1 : idx + 1;
		const sibling = siblingIdx < layer.length ? layer[siblingIdx] : layer[idx];
		path.push({
			hash: sibling,
			position: isRightChild ? "left" : "right",
		});
		idx = Math.floor(idx / 2);
	}
	return path;
}

// ---------------------------------------------------------------------------
// Module-load env snapshot per
// `feedback_completion_callback_snapshot_pattern`. Reads once at cold
// start; never re-read inside per-invocation paths. Frozen so accidental
// mutation throws.
// ---------------------------------------------------------------------------

interface AnchorEnv {
	readonly readerSecretArn: string;
	readonly drainerSecretArn: string;
	readonly anchorBucketName: string;
	readonly kmsKeyArn: string;
	readonly mode: "GOVERNANCE" | "COMPLIANCE";
	readonly retentionDays: number;
	readonly stage: string;
	readonly region: string;
}

function getAnchorEnv(): AnchorEnv {
	const rawMode = process.env.COMPLIANCE_ANCHOR_OBJECT_LOCK_MODE || "GOVERNANCE";
	const mode: "GOVERNANCE" | "COMPLIANCE" =
		rawMode === "COMPLIANCE" ? "COMPLIANCE" : "GOVERNANCE";
	return Object.freeze({
		readerSecretArn: process.env.COMPLIANCE_READER_SECRET_ARN || "",
		drainerSecretArn: process.env.COMPLIANCE_DRAINER_SECRET_ARN || "",
		anchorBucketName: process.env.COMPLIANCE_ANCHOR_BUCKET_NAME || "",
		kmsKeyArn: process.env.COMPLIANCE_ANCHOR_KMS_KEY_ARN || "",
		mode,
		retentionDays: parseInt(
			process.env.COMPLIANCE_ANCHOR_RETENTION_DAYS || "365",
			10,
		),
		stage: process.env.STAGE || "dev",
		region: process.env.AWS_REGION || "us-east-1",
	});
}

const ENV: AnchorEnv = getAnchorEnv();

// ---------------------------------------------------------------------------
// Lazy connection cache — built on first invocation, cached for warm
// reuse, error-invalidated. Mirrors the U4 drainer's `_db` pattern.
// ---------------------------------------------------------------------------

let _readerDb: Database | undefined;
let _drainerDb: Database | undefined;
let _s3: S3Client | undefined;

function getS3Client(): S3Client {
	if (_s3) return _s3;
	const config: S3ClientConfig = {
		region: ENV.region,
		// Bound the SDK call so a regional S3 degradation doesn't consume
		// the full Lambda timeout. Mirrors the SecretsManager + CloudWatch
		// timeouts used elsewhere in this file + watchdog.
		requestHandler: { requestTimeout: 5000, connectionTimeout: 3000 },
	};
	_s3 = new S3Client(config);
	return _s3;
}

async function resolveDatabaseUrl(secretArn: string): Promise<string> {
	if (!secretArn) {
		throw new Error("compliance-anchor: secret ARN is empty");
	}

	const { SecretsManagerClient, GetSecretValueCommand } = await import(
		"@aws-sdk/client-secrets-manager"
	);
	const sm = new SecretsManagerClient({
		requestHandler: { requestTimeout: 5000, connectionTimeout: 3000 },
	});
	const result = await sm.send(
		new GetSecretValueCommand({ SecretId: secretArn }),
	);
	const secret = JSON.parse(result.SecretString || "{}") as {
		username: string;
		password: string;
		host: string;
		port: number | string;
		dbname: string;
	};
	const user = encodeURIComponent(secret.username);
	const pass = encodeURIComponent(secret.password);
	return `postgresql://${user}:${pass}@${secret.host}:${secret.port}/${secret.dbname}?sslmode=no-verify`;
}

async function getReaderDb(): Promise<Database> {
	if (_readerDb) return _readerDb;
	if (process.env.NODE_ENV === "test" && process.env.COMPLIANCE_READER_DATABASE_URL) {
		_readerDb = createDb(process.env.COMPLIANCE_READER_DATABASE_URL);
	} else {
		_readerDb = createDb(await resolveDatabaseUrl(ENV.readerSecretArn));
	}
	const dbAny = _readerDb as unknown as {
		$client?: { on?: (event: string, cb: () => void) => void };
	};
	dbAny.$client?.on?.("error", () => {
		_readerDb = undefined;
	});
	return _readerDb;
}

async function getDrainerDb(): Promise<Database> {
	if (_drainerDb) return _drainerDb;
	if (process.env.NODE_ENV === "test" && process.env.COMPLIANCE_DRAINER_DATABASE_URL) {
		_drainerDb = createDb(process.env.COMPLIANCE_DRAINER_DATABASE_URL);
	} else {
		_drainerDb = createDb(await resolveDatabaseUrl(ENV.drainerSecretArn));
	}
	const dbAny = _drainerDb as unknown as {
		$client?: { on?: (event: string, cb: () => void) => void };
	};
	dbAny.$client?.on?.("error", () => {
		_drainerDb = undefined;
	});
	return _drainerDb;
}

// ---------------------------------------------------------------------------
// Cadence ID — DETERMINISTIC fingerprint of chain heads (Decision #5a).
//
// Same chain heads → same cadence_id. This makes retries idempotent:
// when a cadence's S3 writes fail and `tenant_anchor_state` rolls back,
// the next cadence sees the same heads and computes the same cadence_id,
// overwriting the prior partial-state slices in-place. Without
// determinism, UUIDv7-per-cadence-run would orphan partial slices for
// 365 days under WORM lock.
//
// Output is shaped like UUIDv7 (RFC 9562): 32 hex chars from sha256 of
// canonical chain-head JSON, with version (7) and variant (10) nibbles
// patched in. The `cadence_id` field's wire format is unchanged from
// U8a — only the derivation function differs.
// ---------------------------------------------------------------------------

interface ChainHeadFingerprint {
	tenant_id: string;
	event_hash: string;
}

export function deriveCadenceId(
	heads: Array<{ tenant_id: string; event_hash: string }>,
): string {
	const canonical: ChainHeadFingerprint[] = heads
		.map((h) => ({ tenant_id: h.tenant_id, event_hash: h.event_hash }))
		.sort((a, b) => (a.tenant_id < b.tenant_id ? -1 : a.tenant_id > b.tenant_id ? 1 : 0));
	const digest = createHash("sha256")
		.update(JSON.stringify(canonical))
		.digest("hex");
	// Reshape sha256(32-byte hex) → UUIDv7 form (8-4-4-4-12).
	// Patch version nibble (13th hex) to '7' and variant nibble (17th) to 8/9/a/b.
	const a = digest.slice(0, 8);
	const b = digest.slice(8, 12);
	// version = 7
	const c = "7" + digest.slice(13, 16);
	// variant = 0b10xx → first hex of d ∈ {8,9,a,b}. Mask: (digest[16] & 0x3) | 0x8.
	const variantNibble = (parseInt(digest[16], 16) & 0x3) | 0x8;
	const d = variantNibble.toString(16) + digest.slice(17, 20);
	const e = digest.slice(20, 32);
	return `${a}-${b}-${c}-${d}-${e}`;
}

// ---------------------------------------------------------------------------
// Live seam — U8b PutObject's to S3 with Object Lock retention.
// ---------------------------------------------------------------------------

export const _anchor_fn_live: AnchorFn = async (
	merkleRoot,
	tenantSlices,
	cadenceId,
) => {
	if (!ENV.kmsKeyArn) {
		throw new Error(
			"compliance-anchor: COMPLIANCE_ANCHOR_KMS_KEY_ARN is required for SSE-KMS PutObject",
		);
	}
	if (!ENV.anchorBucketName) {
		throw new Error(
			"compliance-anchor: COMPLIANCE_ANCHOR_BUCKET_NAME is required",
		);
	}

	// 1. Merkle self-check (Decision #16) — recompute root from received
	// leaves and assert equality before WORM-locking. Cheap insurance
	// against a runAnchorPass arithmetic bug producing inconsistent
	// (root, leaves) — which would otherwise become 365 days of poisoned
	// audit evidence.
	const expectedRoot = buildMerkleTree(
		tenantSlices.map((s) => s.leaf_hash),
	).root;
	if (expectedRoot !== merkleRoot) {
		throw new Error(
			`compliance-anchor: leaf-set / merkleRoot mismatch — expected ${expectedRoot}, got ${merkleRoot}`,
		);
	}

	const retainUntilDate = new Date(
		Date.now() + ENV.retentionDays * 86400 * 1000,
	);

	// 2. Slice-key construction — single source of truth for both
	// PutObject calls and the anchor's `proof_keys` array (Decision #5,
	// closes referential-integrity gap).
	const sliceKeyFor = (slice: TenantSlice): string =>
		`proofs/tenant-${slice.tenant_id}/cadence-${cadenceId}.json`;
	const proofKeys = tenantSlices.map(sliceKeyFor);

	const s3 = getS3Client();

	// 3. Slices first (Decision #3) — bounded concurrency via p-limit.
	// Any rejection bubbles up to runAnchorPass, which rolls back the
	// drainer transaction; the next cadence (with deterministic cadence_id)
	// retries the same keys.
	const limit = pLimit(8);
	const slicePromises = tenantSlices.map((slice, idx) =>
		limit(async () => {
			const sliceBody = JSON.stringify({
				schema_version: 1,
				tenant_id: slice.tenant_id,
				latest_event_hash: slice.latest_event_hash,
				latest_recorded_at: slice.latest_recorded_at,
				latest_event_id: slice.latest_event_id,
				leaf_hash: slice.leaf_hash,
				proof_path: slice.proof_path,
				global_root: merkleRoot,
				cadence_id: cadenceId,
			});
			await s3.send(
				new PutObjectCommand({
					Bucket: ENV.anchorBucketName,
					Key: proofKeys[idx],
					Body: sliceBody,
					ContentType: "application/json",
					ServerSideEncryption: "aws:kms",
					SSEKMSKeyId: ENV.kmsKeyArn,
					ChecksumAlgorithm: "SHA256",
					// No per-object Object Lock override — bucket-default applies (R2).
				}),
			);
		}),
	);
	await Promise.all(slicePromises);

	// 4. Anchor LAST. The anchor object is the verifier-discoverable
	// commit point; if any slice failed, we never reach this line.
	const anchorKey = `anchors/cadence-${cadenceId}.json`;
	const recordedAtRange = computeRecordedAtRange(tenantSlices);
	const anchorBody = JSON.stringify({
		schema_version: 1,
		cadence_id: cadenceId,
		recorded_at: new Date().toISOString(),
		merkle_root: merkleRoot,
		tenant_count: tenantSlices.length,
		anchored_event_count: tenantSlices.length, // 1 chain-head event per tenant per cadence
		recorded_at_range: recordedAtRange,
		leaf_algorithm: "sha256_rfc6962",
		proof_keys: proofKeys,
	});
	try {
		await s3.send(
			new PutObjectCommand({
				Bucket: ENV.anchorBucketName,
				Key: anchorKey,
				Body: anchorBody,
				ContentType: "application/json",
				ServerSideEncryption: "aws:kms",
				SSEKMSKeyId: ENV.kmsKeyArn,
				ChecksumAlgorithm: "SHA256",
				ObjectLockMode: ENV.mode,
				ObjectLockRetainUntilDate: retainUntilDate,
			}),
		);
	} catch (err) {
		// On S3 failure, invalidate the cached client so the next
		// invocation rebuilds. Mirrors the _readerDb / _drainerDb pattern.
		_s3 = undefined;
		throw err;
	}

	return {
		anchored: true,
		s3_key: anchorKey,
		retain_until_date: retainUntilDate.toISOString(),
	};
};

function computeRecordedAtRange(
	tenantSlices: TenantSlice[],
): { min: string; max: string } | null {
	if (tenantSlices.length === 0) return null;
	let minIso = tenantSlices[0].latest_recorded_at;
	let maxIso = tenantSlices[0].latest_recorded_at;
	for (const slice of tenantSlices) {
		if (slice.latest_recorded_at < minIso) minIso = slice.latest_recorded_at;
		if (slice.latest_recorded_at > maxIso) maxIso = slice.latest_recorded_at;
	}
	return { min: minIso, max: maxIso };
}

/**
 * Returns the production-wired anchor function. U6 integration test
 * asserts this returns `_anchor_fn_live` (Layer 1 forcing function).
 * The substantive body-swap safety (Layer 2) lives in U6's mock-based
 * test that asserts `S3Client.send` is called with `PutObjectCommand`.
 */
export function getWiredAnchorFn(): AnchorFn {
	return _anchor_fn_live;
}

// ---------------------------------------------------------------------------
// Chain-head SELECT — returns one row per tenant: the most-recent
// audit_event with recorded_at > last_anchored_recorded_at (or
// > '-infinity' for never-anchored tenants).
// ---------------------------------------------------------------------------

interface ChainHead {
	tenant_id: string;
	event_id: string;
	event_hash: string;
	recorded_at: Date;
}

function coerceDbTimestamp(value: Date | string): Date {
	if (value instanceof Date) return value;
	const date = new Date(value);
	if (Number.isNaN(date.getTime())) {
		throw new Error(
			`compliance-anchor: invalid recorded_at timestamp: ${String(value)}`,
		);
	}
	return date;
}

export async function readChainHeads(readerDb: Database): Promise<ChainHead[]> {
	// SQL: per tenant, pick the row with maximum (recorded_at, event_id)
	// where recorded_at > tenant_anchor_state.last_anchored_recorded_at.
	// Tie-break on event_id to handle equal-microsecond timestamps.
	//
	// Using DISTINCT ON (PostgreSQL-specific) is the cleanest Drizzle
	// raw-SQL expression here; the column set is small and stable.
	const result = await readerDb.execute<{
		tenant_id: string;
		event_id: string;
		event_hash: string;
		recorded_at: Date | string;
	}>(sql`
		SELECT DISTINCT ON (ae.tenant_id)
			ae.tenant_id::text AS tenant_id,
			ae.event_id::text AS event_id,
			ae.event_hash AS event_hash,
			ae.recorded_at AS recorded_at
		FROM compliance.audit_events ae
		LEFT JOIN compliance.tenant_anchor_state tas
			ON ae.tenant_id = tas.tenant_id
		WHERE ae.recorded_at > COALESCE(tas.last_anchored_recorded_at, '-infinity'::timestamptz)
		ORDER BY ae.tenant_id, ae.recorded_at DESC, ae.event_id DESC
	`);
	// drizzle execute returns { rows: [...] } in node-postgres mode
	const rows =
		(result as unknown as {
			rows?: Array<ChainHead & { recorded_at: Date | string }>;
		}).rows ??
		(result as unknown as Array<ChainHead & { recorded_at: Date | string }>);
	return rows.map((row) => ({
		...row,
		recorded_at: coerceDbTimestamp(row.recorded_at),
	}));
}

/**
 * Count un-anchored events across all tenants — surfaced in the result
 * payload (`anchored_event_count`) so deploy smoke can pin growth across
 * cadences.
 */
export async function countUnanchoredEvents(readerDb: Database): Promise<number> {
	const result = await readerDb.execute<{ cnt: string }>(sql`
		SELECT COUNT(*)::text AS cnt
		FROM compliance.audit_events ae
		LEFT JOIN compliance.tenant_anchor_state tas
			ON ae.tenant_id = tas.tenant_id
		WHERE ae.recorded_at > COALESCE(tas.last_anchored_recorded_at, '-infinity'::timestamptz)
	`);
	const rows =
		(result as unknown as { rows?: Array<{ cnt: string }> }).rows ??
		(result as unknown as Array<{ cnt: string }>);
	return rows.length > 0 ? parseInt(rows[0].cnt, 10) : 0;
}

// ---------------------------------------------------------------------------
// Anchor pass — exported for tests
// ---------------------------------------------------------------------------

export interface AnchorPassDeps {
	readerDb: Database;
	drainerDb: Database;
	anchorFn?: AnchorFn;
	cadenceId?: string;
	// `cw` was dropped in U8a — the inert anchor doesn't emit metrics
	// (only the watchdog does, via its own client). U8b will re-thread a
	// CloudWatchClient if/when the live anchor emits its own metrics; for
	// now the unused parameter was dead code that confused reviewers.
}

export async function runAnchorPass(
	deps: AnchorPassDeps,
): Promise<AnchorResult> {
	const anchorFn = deps.anchorFn ?? getWiredAnchorFn();

	// 1. Reader-side SELECT — runs to completion BEFORE drainer transaction
	// starts. Two PG sessions, two transactions; the snapshot is what the
	// Merkle tree was computed against.
	const heads = await readChainHeads(deps.readerDb);
	const anchoredEventCount = await countUnanchoredEvents(deps.readerDb);

	// Sort tenants deterministically — by tenant_id ascending — so the
	// Merkle tree shape is deterministic given the same input set.
	heads.sort((a, b) => (a.tenant_id < b.tenant_id ? -1 : a.tenant_id > b.tenant_id ? 1 : 0));

	// Derive cadence_id deterministically from chain heads (Decision #5a).
	// Same heads → same cadence_id → retries idempotent on slice keys.
	const cadenceId = deps.cadenceId ?? deriveCadenceId(heads);

	// 2. Compute Merkle leaves + tree.
	const leaves = heads.map((h) => computeLeafHash(h.tenant_id, h.event_hash));
	const { root: merkleRoot, levels } = buildMerkleTree(leaves);

	// 3. Build per-tenant slices with proof paths.
	const tenantSlices: TenantSlice[] = heads.map((h, i) => ({
		tenant_id: h.tenant_id,
		latest_event_hash: h.event_hash,
		latest_recorded_at: h.recorded_at.toISOString(),
		latest_event_id: h.event_id,
		leaf_hash: leaves[i],
		proof_path: deriveProofPath(levels, i),
	}));

	// 4. Call the seam function (now async — `_anchor_fn_live` does S3 PutObject).
	// Throws on Merkle self-check failure or S3 error; the drainer transaction
	// below is rolled back (the tenant_anchor_state UPDATE never starts).
	const seamResult = await anchorFn(merkleRoot, tenantSlices, cadenceId);

	// 5. Drainer-side UPDATE — single transaction over all tenants.
	// Skipped for empty heads (nothing to advance).
	if (heads.length > 0) {
		await deps.drainerDb.transaction(async (tx) => {
			for (const head of heads) {
				await tx
					.insert(tenantAnchorState)
					.values({
						tenant_id: head.tenant_id,
						last_anchored_recorded_at: head.recorded_at,
						last_anchored_event_id: head.event_id,
						last_cadence_id: cadenceId,
					})
					.onConflictDoUpdate({
						target: tenantAnchorState.tenant_id,
						set: {
							last_anchored_recorded_at: head.recorded_at,
							last_anchored_event_id: head.event_id,
							last_cadence_id: cadenceId,
							updated_at: sql`now()`,
						},
					});
			}
		});
	}

	const result: AnchorResult = {
		dispatched: true,
		anchored: seamResult.anchored,
		merkle_root: merkleRoot,
		tenant_count: heads.length,
		anchored_event_count: anchoredEventCount,
		cadence_id: cadenceId,
		...(seamResult.s3_key !== undefined && { s3_key: seamResult.s3_key }),
		...(seamResult.retain_until_date !== undefined && {
			retain_until_date: seamResult.retain_until_date,
		}),
	};

	return result;
}

// ---------------------------------------------------------------------------
// Lambda handler
// ---------------------------------------------------------------------------

export async function handler(): Promise<AnchorResult> {
	const readerDb = await getReaderDb();
	const drainerDb = await getDrainerDb();

	let result: AnchorResult;
	try {
		result = await runAnchorPass({ readerDb, drainerDb });
	} catch (err) {
		// On any error, log structured + rethrow. Scheduler retry-policy=0
		// ensures no replay; the next 15-min cadence picks up the same
		// chain heads (idempotent because tenant_anchor_state didn't
		// advance).
		console.error({
			level: "error",
			msg: "compliance-anchor: cadence failed",
			error: err instanceof Error ? err.message : String(err),
			stack: err instanceof Error ? err.stack : undefined,
		});
		// Invalidate cached PG clients on error — defends against
		// connection-level state corruption.
		_readerDb = undefined;
		_drainerDb = undefined;
		throw err;
	}

	// Smoke-pin surface — `dispatched: true` in the structured log line
	// is what the deploy smoke gate asserts via Lambda invoke response
	// payload.
	console.log({
		level: "info",
		msg: "compliance-anchor: cadence complete",
		...result,
	});

	return result;
}
