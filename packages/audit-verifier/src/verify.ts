/**
 * Verifier orchestrator + JSON reporter.
 *
 * `verifyBucket(opts)` is the load-bearing programmatic API. The CLI
 * calls it; a future internal CI gate calls it directly.
 *
 * Per-cadence flow under a SINGLE shared `p-limit(concurrency)` gate:
 *   1. Fetch the anchor body, parse via parseAnchor.
 *   2. Fetch every key in proof_keys[] in parallel under the same gate.
 *   3. For each tenant slice:
 *      a. Recompute leaf = sha256(0x00 || uuid_bytes || hex_bytes); assert
 *         === slice.leaf_hash → leaf_drift.
 *      b. Replay slice.proof_path against slice.leaf_hash; assert
 *         recomputed root === anchor.merkle_root → root_mismatch.
 *      c. Assert slice.global_root === anchor.merkle_root → slice_root_drift.
 *   4. Empty-cadence sentinel check (R1 + ce-doc-review F1): if
 *      proof_keys.length === 0, recompute EMPTY_TREE_ROOT independently
 *      and assert anchor.merkle_root === EMPTY_TREE_ROOT.
 *   5. (--check-retention) Fetch object retention; record ok/expired/missing.
 *   6. (--check-chain) Walk audit_events per tenant; assert prev_hash chain.
 *
 * Errors that mean "data integrity violation" land in the report's
 * mismatches/parse_failures/schema_drift arrays — verification continues
 * across remaining cadences. Errors that mean "infrastructure broken"
 * (S3 access denied, bucket missing) propagate as exceptions; the CLI
 * catches and exits 2.
 */

import pLimit from "p-limit";
import type { S3Client } from "@aws-sdk/client-s3";

import {
	EMPTY_TREE_ROOT,
	computeLeafHash,
	verifyProofPath,
} from "./merkle";
import {
	SchemaVersionUnsupportedError,
	parseAnchor,
	parseSlice,
	type AnchorV1,
	type SliceV1,
} from "./schema";
import {
	enumerateAnchors,
	getJsonBody,
	isUnrecoverableS3Error,
} from "./s3";
import {
	checkRetention,
	type RetentionFailure,
} from "./retention";
import {
	walkTenantChain,
	type ChainFailure,
} from "./chain";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface VerifyOptions {
	bucket: string;
	region: string;
	since?: Date;
	until?: Date;
	tenantId?: string;
	concurrency?: number;
	checkRetention?: boolean;
	checkChain?: boolean;
	dbUrl?: string;
	/** Override S3Client for tests; the CLI constructs a real one. */
	s3Client?: S3Client;
}

export interface MerkleMismatch {
	cadence_id: string | null;
	key: string;
	tenant_id: string | null;
	reason:
		| "leaf_drift"
		| "root_mismatch"
		| "slice_root_drift"
		| "slice_missing"
		| "empty_tree_root_mismatch";
	expected?: string;
	computed?: string;
}

export interface ParseFailure {
	key: string;
	reason: string; // human-readable; zod issues serialized
}

export interface SchemaDrift {
	key: string;
	schema_version: unknown;
}

export interface VerificationReport {
	verified: boolean;
	cadences_checked: number;
	anchors_verified: number;
	merkle_root_mismatches: MerkleMismatch[];
	retention_failures: RetentionFailure[];
	chain_failures: ChainFailure[];
	parse_failures: ParseFailure[];
	schema_drift: SchemaDrift[];
	first_anchor_at: string | null;
	last_anchor_at: string | null;
	elapsed_ms: number;
	flags: {
		check_retention: boolean;
		check_chain: boolean;
		concurrency: number;
		since: string | null;
		until: string | null;
		tenant_id: string | null;
	};
}

// ---------------------------------------------------------------------------
// Orchestrator
// ---------------------------------------------------------------------------

const DEFAULT_CONCURRENCY = 8;

export async function verifyBucket(
	opts: VerifyOptions,
): Promise<VerificationReport> {
	const start = Date.now();
	const concurrency = opts.concurrency ?? DEFAULT_CONCURRENCY;
	const s3 = opts.s3Client ?? (await getDefaultS3Client(opts.region));
	const limit = pLimit(concurrency);

	const merkleMismatches: MerkleMismatch[] = [];
	const retentionFailures: RetentionFailure[] = [];
	const parseFailures: ParseFailure[] = [];
	const schemaDrift: SchemaDrift[] = [];
	let cadencesChecked = 0;
	let anchorsVerified = 0;
	const tenantsSeen = new Set<string>();
	let firstAnchorAt: Date | null = null;
	let lastAnchorAt: Date | null = null;

	// Phase 1: enumerate anchor keys.
	const anchorKeys: { key: string; lastModified: Date }[] = [];
	try {
		for await (const a of enumerateAnchors(s3, {
			bucket: opts.bucket,
			since: opts.since,
			until: opts.until,
		})) {
			anchorKeys.push(a);
			if (!firstAnchorAt || a.lastModified < firstAnchorAt)
				firstAnchorAt = a.lastModified;
			if (!lastAnchorAt || a.lastModified > lastAnchorAt)
				lastAnchorAt = a.lastModified;
		}
	} catch (err) {
		if (isUnrecoverableS3Error(err)) throw err;
		throw err; // pass through; CLI decides exit code
	}

	// Phase 2: verify each cadence under the shared concurrency gate.
	const tasks = anchorKeys.map((anchor) =>
		limit(async () => {
			cadencesChecked += 1;
			let parsedAnchor: AnchorV1;
			try {
				const body = await getJsonBody(s3, opts.bucket, anchor.key);
				parsedAnchor = parseAnchor(body, anchor.key);
			} catch (err) {
				if (err instanceof SchemaVersionUnsupportedError) {
					schemaDrift.push({
						key: anchor.key,
						schema_version: err.version,
					});
					return; // skip this cadence, run continues
				}
				if (isUnrecoverableS3Error(err)) throw err;
				parseFailures.push({
					key: anchor.key,
					reason:
						err instanceof Error ? err.message : String(err),
				});
				return;
			}

			// Empty-cadence sentinel root check (Decision-#5a writer behavior).
			if (parsedAnchor.proof_keys.length === 0) {
				if (parsedAnchor.merkle_root !== EMPTY_TREE_ROOT) {
					merkleMismatches.push({
						cadence_id: parsedAnchor.cadence_id,
						key: anchor.key,
						tenant_id: null,
						reason: "empty_tree_root_mismatch",
						expected: EMPTY_TREE_ROOT,
						computed: parsedAnchor.merkle_root,
					});
				} else {
					anchorsVerified += 1;
				}
				if (opts.checkRetention) {
					await runRetentionCheck(
						s3,
						opts.bucket,
						anchor.key,
						retentionFailures,
					);
				}
				return;
			}

			// Fetch all slices in parallel (under the same shared gate).
			const sliceResults = await Promise.allSettled(
				parsedAnchor.proof_keys.map((sliceKey) =>
					limit(async () => {
						const sliceBody = await getJsonBody(
							s3,
							opts.bucket,
							sliceKey,
						);
						const slice = parseSlice(sliceBody, sliceKey);
						return { sliceKey, slice };
					}),
				),
			);

			let cadenceClean = true;
			for (let i = 0; i < sliceResults.length; i += 1) {
				const r = sliceResults[i];
				const sliceKey = parsedAnchor.proof_keys[i];
				if (r.status === "rejected") {
					if (r.reason instanceof SchemaVersionUnsupportedError) {
						schemaDrift.push({
							key: sliceKey,
							schema_version: r.reason.version,
						});
					} else if (isUnrecoverableS3Error(r.reason)) {
						throw r.reason;
					} else if (
						isS3NotFoundError(r.reason)
					) {
						merkleMismatches.push({
							cadence_id: parsedAnchor.cadence_id,
							key: sliceKey,
							tenant_id: null,
							reason: "slice_missing",
						});
					} else {
						parseFailures.push({
							key: sliceKey,
							reason:
								r.reason instanceof Error
									? r.reason.message
									: String(r.reason),
						});
					}
					cadenceClean = false;
					continue;
				}
				const slice: SliceV1 = r.value.slice;
				tenantsSeen.add(slice.tenant_id);

				// (a) Leaf-drift check.
				const expectedLeaf = computeLeafHash(
					slice.tenant_id,
					slice.latest_event_hash,
				);
				if (expectedLeaf !== slice.leaf_hash) {
					merkleMismatches.push({
						cadence_id: parsedAnchor.cadence_id,
						key: sliceKey,
						tenant_id: slice.tenant_id,
						reason: "leaf_drift",
						expected: expectedLeaf,
						computed: slice.leaf_hash,
					});
					cadenceClean = false;
					continue;
				}

				// (b) Proof-path replay must reconstruct anchor.merkle_root.
				const replayedRoot = verifyProofPath(
					slice.leaf_hash,
					slice.proof_path,
				);
				if (replayedRoot !== parsedAnchor.merkle_root) {
					merkleMismatches.push({
						cadence_id: parsedAnchor.cadence_id,
						key: sliceKey,
						tenant_id: slice.tenant_id,
						reason: "root_mismatch",
						expected: parsedAnchor.merkle_root,
						computed: replayedRoot,
					});
					cadenceClean = false;
					continue;
				}

				// (c) Slice's own claim of global_root must match.
				if (slice.global_root !== parsedAnchor.merkle_root) {
					merkleMismatches.push({
						cadence_id: parsedAnchor.cadence_id,
						key: sliceKey,
						tenant_id: slice.tenant_id,
						reason: "slice_root_drift",
						expected: parsedAnchor.merkle_root,
						computed: slice.global_root,
					});
					cadenceClean = false;
				}
			}

			if (cadenceClean) anchorsVerified += 1;

			if (opts.checkRetention) {
				await runRetentionCheck(
					s3,
					opts.bucket,
					anchor.key,
					retentionFailures,
				);
			}
		}),
	);

	await Promise.all(tasks);

	// Phase 3: optional chain walk. Lazy imports pg only when invoked.
	const chainFailures: ChainFailure[] = [];
	if (opts.checkChain) {
		if (!opts.dbUrl) {
			throw new Error(
				"audit-verifier: --check-chain requires --db-url-env <VAR> or programmatic dbUrl option",
			);
		}
		const targetTenants = opts.tenantId
			? [opts.tenantId]
			: Array.from(tenantsSeen);
		const failures = await walkTenantChain({
			dbUrl: opts.dbUrl,
			tenants: targetTenants,
		});
		chainFailures.push(...failures);
	}

	const verified =
		merkleMismatches.length === 0 &&
		retentionFailures.length === 0 &&
		chainFailures.length === 0 &&
		parseFailures.length === 0 &&
		schemaDrift.length === 0;

	return {
		verified,
		cadences_checked: cadencesChecked,
		anchors_verified: anchorsVerified,
		merkle_root_mismatches: merkleMismatches,
		retention_failures: retentionFailures,
		chain_failures: chainFailures,
		parse_failures: parseFailures,
		schema_drift: schemaDrift,
		first_anchor_at: firstAnchorAt ? firstAnchorAt.toISOString() : null,
		last_anchor_at: lastAnchorAt ? lastAnchorAt.toISOString() : null,
		elapsed_ms: Date.now() - start,
		flags: {
			check_retention: opts.checkRetention === true,
			check_chain: opts.checkChain === true,
			concurrency,
			since: opts.since ? opts.since.toISOString() : null,
			until: opts.until ? opts.until.toISOString() : null,
			tenant_id: opts.tenantId ?? null,
		},
	};
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function runRetentionCheck(
	s3: S3Client,
	bucket: string,
	key: string,
	failures: RetentionFailure[],
): Promise<void> {
	const result = await checkRetention(s3, bucket, key);
	if (!result.ok) {
		failures.push({
			key,
			reason: result.reason,
			mode: result.mode,
			retain_until_date: result.retain_until_date,
		});
	}
}

function isS3NotFoundError(err: unknown): boolean {
	if (typeof err !== "object" || err === null) return false;
	const name = (err as { name?: unknown }).name;
	return name === "NoSuchKey" || name === "NotFound";
}

async function getDefaultS3Client(region: string): Promise<S3Client> {
	const { S3Client: Client } = await import("@aws-sdk/client-s3");
	return new Client({
		region,
		requestHandler: {
			requestTimeout: 30000,
			connectionTimeout: 5000,
		},
	}) as S3Client;
}
