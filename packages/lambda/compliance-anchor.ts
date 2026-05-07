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
import { uuidv7 } from "uuidv7";
import { createDb, type Database } from "@thinkwork/database-pg";
import {
	auditEvents,
	tenantAnchorState,
} from "@thinkwork/database-pg/schema";
import { and, eq, gt, sql } from "drizzle-orm";
// Note: @aws-sdk/client-cloudwatch is intentionally NOT imported here.
// In U8a the anchor Lambda emits no metrics (only the watchdog does,
// from its own dedicated client). U8b will re-import if/when the live
// anchor emits its own metrics around the S3 PutObject path.

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
) => Pick<AnchorResult, "anchored"> & Partial<Pick<AnchorResult, "s3_key" | "retain_until_date">>;

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
	readonly retentionDays: number;
	readonly stage: string;
	readonly region: string;
}

function getAnchorEnv(): AnchorEnv {
	return Object.freeze({
		readerSecretArn: process.env.COMPLIANCE_READER_SECRET_ARN || "",
		drainerSecretArn: process.env.COMPLIANCE_DRAINER_SECRET_ARN || "",
		anchorBucketName: process.env.COMPLIANCE_ANCHOR_BUCKET_NAME || "",
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
// Inert seam — U8a returns {anchored: false}; U8b will export
// `_anchor_fn_live` that PutObject's to S3 with Object Lock retention.
// ---------------------------------------------------------------------------

export const _anchor_fn_inert: AnchorFn = (_merkleRoot, _tenantSlices) => {
	return { anchored: false };
};

/**
 * Returns the production-wired anchor function. U6 test scenarios
 * assert this returns `_anchor_fn_inert` in U8a; when U8b lands and
 * replaces the wired fn with `_anchor_fn_live`, that test must be
 * replaced with a real body-swap safety test (asserting S3Client.send
 * was called with PutObjectCommand). Decision #17 — structural forcing
 * function for the U8b body-swap protection.
 */
export function getWiredAnchorFn(): AnchorFn {
	return _anchor_fn_inert;
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
		recorded_at: Date;
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
		(result as unknown as { rows?: ChainHead[] }).rows ??
		(result as unknown as ChainHead[]);
	return rows;
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
	const cadenceId = deps.cadenceId ?? uuidv7();
	const anchorFn = deps.anchorFn ?? getWiredAnchorFn();

	// 1. Reader-side SELECT — runs to completion BEFORE drainer transaction
	// starts. Two PG sessions, two transactions; the snapshot is what the
	// Merkle tree was computed against.
	const heads = await readChainHeads(deps.readerDb);
	const anchoredEventCount = await countUnanchoredEvents(deps.readerDb);

	// Sort tenants deterministically — by tenant_id ascending — so the
	// Merkle tree shape is deterministic given the same input set.
	heads.sort((a, b) => (a.tenant_id < b.tenant_id ? -1 : a.tenant_id > b.tenant_id ? 1 : 0));

	// 2. Compute Merkle leaves + tree.
	const leaves = heads.map((h) => computeLeafHash(h.tenant_id, h.event_hash));
	const { root: merkleRoot, levels } = buildMerkleTree(leaves);

	// 3. Build per-tenant slices with proof paths.
	const tenantSlices: TenantSlice[] = heads.map((h, i) => ({
		tenant_id: h.tenant_id,
		latest_event_hash: h.event_hash,
		latest_recorded_at:
			h.recorded_at instanceof Date
				? h.recorded_at.toISOString()
				: new Date(h.recorded_at).toISOString(),
		latest_event_id: h.event_id,
		leaf_hash: leaves[i],
		proof_path: deriveProofPath(levels, i),
	}));

	// 4. Call the seam function. In U8a returns {anchored: false}. U8b
	// returns {anchored: true, s3_key, retain_until_date}.
	const seamResult = anchorFn(merkleRoot, tenantSlices);

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
