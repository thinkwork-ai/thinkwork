/**
 * Compliance Anchor Watchdog Lambda — LIVE in U8b
 *
 * Phase 3 U8b of the System Workflows revert + Compliance reframe.
 *
 * Runs every 5 minutes via AWS Scheduler. In U8b the body:
 *   1. Lists `anchors/cadence-*.json` in the WORM bucket via `ListObjectsV2`.
 *   2. Picks the newest object (max LastModified) and computes
 *      `oldest_unanchored_age_ms = now - LastModified`.
 *   3. Emits `ComplianceAnchorGap = 1` if the gap exceeds 30 minutes,
 *      else `0`. Suppresses emit when the bucket is empty (greenfield deploy
 *      grace window — Decision #6) so the alarm doesn't fire before any
 *      anchor cadences have run.
 *   4. Continues to emit `ComplianceAnchorWatchdogHeartbeat = 1.0` so the
 *      sibling alarm `compliance-anchor-watchdog-heartbeat-missing` can
 *      distinguish "real anchor gap" from "watchdog metric path broken".
 *
 * The watchdog runs under a sibling IAM role
 * (`thinkwork-${stage}-compliance-anchor-watchdog`) granted:
 *   - `kms:DescribeKey` on the bucket CMK (NOT `kms:Decrypt` — watchdog
 *     never reads object bodies; ListObjectsV2 + LastModified metadata is
 *     all it needs). Decision #5/SEC-U8B-003.
 *   - `s3:ListBucket` with prefix condition `anchors/`.
 *   - `s3:GetObject` on `anchors/*` (reserved for future HeadObject hardening
 *     but not exercised in U8b's ListObjectsV2-only path).
 *
 * Plan: docs/plans/2026-05-07-012-feat-compliance-u8b-anchor-lambda-live-plan.md
 */

import {
	CloudWatchClient,
	PutMetricDataCommand,
	type CloudWatchClientConfig,
} from "@aws-sdk/client-cloudwatch";
import {
	S3Client,
	ListObjectsV2Command,
	type S3ClientConfig,
} from "@aws-sdk/client-s3";

// ---------------------------------------------------------------------------
// Shared types — exported for the U7 smoke gate so runtime assertions get
// compile-time mode validation. Keeps `mode === "live"` typo-safe.
// ---------------------------------------------------------------------------

export type WatchdogMode = "inert" | "live";

export interface WatchdogResult {
	mode: WatchdogMode;
	checked_at: string;
	oldest_unanchored_age_ms: number | null;
	anchor_count: number;
	gap_threshold_ms: number;
	gap_breaching: boolean;
}

export const COMPLIANCE_METRICS_NAMESPACE = "Thinkwork/Compliance";
export const COMPLIANCE_ANCHOR_WATCHDOG_HEARTBEAT_METRIC =
	"ComplianceAnchorWatchdogHeartbeat";
export const COMPLIANCE_ANCHOR_GAP_METRIC = "ComplianceAnchorGap";

// 30 minutes — twice the 15-minute cadence so a single missed cadence does
// not breach. Two consecutive misses (~30+ min) breach.
const GAP_THRESHOLD_MS = 30 * 60 * 1000;

// ---------------------------------------------------------------------------
// Module-load env snapshot per
// `feedback_completion_callback_snapshot_pattern`. Reads once at cold
// start; never re-read inside per-invocation paths.
// ---------------------------------------------------------------------------

interface WatchdogEnv {
	readonly anchorBucketName: string;
	readonly stage: string;
	readonly region: string;
}

function getWatchdogEnv(): WatchdogEnv {
	return Object.freeze({
		anchorBucketName: process.env.COMPLIANCE_ANCHOR_BUCKET_NAME || "",
		stage: process.env.STAGE || "dev",
		region: process.env.AWS_REGION || "us-east-1",
	});
}

const ENV: WatchdogEnv = getWatchdogEnv();

// ---------------------------------------------------------------------------
// Lazy AWS clients — built on first invocation, cached for warm reuse,
// error-invalidated. Mirrors the U4 drainer's `_db` pattern.
// ---------------------------------------------------------------------------

let _cw: CloudWatchClient | undefined;
let _s3: S3Client | undefined;

function getCloudWatchClient(): CloudWatchClient {
	if (_cw) return _cw;
	const config: CloudWatchClientConfig = {
		region: ENV.region,
		requestHandler: { requestTimeout: 5000, connectionTimeout: 3000 },
	};
	_cw = new CloudWatchClient(config);
	return _cw;
}

function getS3Client(): S3Client {
	if (_s3) return _s3;
	const config: S3ClientConfig = {
		region: ENV.region,
		requestHandler: { requestTimeout: 5000, connectionTimeout: 3000 },
	};
	_s3 = new S3Client(config);
	return _s3;
}

// ---------------------------------------------------------------------------
// Metric emit helpers
// ---------------------------------------------------------------------------

async function emitHeartbeat(cw: CloudWatchClient, stage: string): Promise<void> {
	await cw.send(
		new PutMetricDataCommand({
			Namespace: COMPLIANCE_METRICS_NAMESPACE,
			MetricData: [
				{
					MetricName: COMPLIANCE_ANCHOR_WATCHDOG_HEARTBEAT_METRIC,
					Value: 1.0,
					Unit: "Count",
					Timestamp: new Date(),
					Dimensions: [{ Name: "Stage", Value: stage }],
				},
			],
		}),
	);
}

async function emitGapMetric(
	cw: CloudWatchClient,
	stage: string,
	breaching: boolean,
): Promise<void> {
	await cw.send(
		new PutMetricDataCommand({
			Namespace: COMPLIANCE_METRICS_NAMESPACE,
			MetricData: [
				{
					MetricName: COMPLIANCE_ANCHOR_GAP_METRIC,
					Value: breaching ? 1.0 : 0.0,
					Unit: "Count",
					Timestamp: new Date(),
					Dimensions: [{ Name: "Stage", Value: stage }],
				},
			],
		}),
	);
}

// ---------------------------------------------------------------------------
// Newest-anchor lookup via ListObjectsV2.
//
// Decision #20: ListObjectsV2 returns up to 1000 keys per request. With
// rate(15 minutes) cadence and 365-day retention, a single bucket holds
// ~35k anchors at steady state — pagination is necessary in production.
// U8b ships unpaginated for v1 simplicity; on `IsTruncated == true` the
// watchdog logs a warning so an operator can spot the day the threshold
// is crossed. Pagination is a follow-up for U8b+.
// ---------------------------------------------------------------------------

interface NewestAnchor {
	key: string;
	lastModified: Date;
	totalChecked: number;
}

async function findNewestAnchor(
	s3: S3Client,
	bucket: string,
): Promise<NewestAnchor | null> {
	const out = await s3.send(
		new ListObjectsV2Command({
			Bucket: bucket,
			Prefix: "anchors/",
		}),
	);
	const contents = out.Contents ?? [];
	if (contents.length === 0) return null;
	if (out.IsTruncated === true) {
		console.warn({
			level: "warn",
			msg: "compliance-anchor-watchdog: ListObjectsV2 truncated — pagination deferred",
			contents_count: contents.length,
			is_truncated: true,
		});
	}
	let newest = contents[0];
	for (const obj of contents) {
		if (
			obj.LastModified instanceof Date &&
			newest.LastModified instanceof Date &&
			obj.LastModified.getTime() > newest.LastModified.getTime()
		) {
			newest = obj;
		}
	}
	if (!(newest.LastModified instanceof Date) || typeof newest.Key !== "string") {
		return null;
	}
	return {
		key: newest.Key,
		lastModified: newest.LastModified,
		totalChecked: contents.length,
	};
}

// ---------------------------------------------------------------------------
// Handler — exported for tests
// ---------------------------------------------------------------------------

export async function runWatchdog(
	deps: { cw: CloudWatchClient; s3: S3Client; stage: string; bucket: string } = {
		cw: getCloudWatchClient(),
		s3: getS3Client(),
		stage: ENV.stage,
		bucket: ENV.anchorBucketName,
	},
): Promise<WatchdogResult> {
	// Heartbeat first — if PutMetricData is broken (IAM regression, network
	// blip), the handler logs but does not throw. The `dispatched: true` smoke
	// pin still fires from the structured log line below.
	try {
		await emitHeartbeat(deps.cw, deps.stage);
	} catch (err) {
		console.error({
			level: "error",
			msg: "compliance-anchor-watchdog: heartbeat emit failed",
			error: err instanceof Error ? err.message : String(err),
		});
		_cw = undefined;
	}

	let oldestUnanchoredAgeMs: number | null = null;
	let anchorCount = 0;
	let gapBreaching = false;
	let listObjectsFailed = false;

	if (!deps.bucket) {
		console.error({
			level: "error",
			msg: "compliance-anchor-watchdog: COMPLIANCE_ANCHOR_BUCKET_NAME is empty — skipping list",
		});
		listObjectsFailed = true;
	} else {
		try {
			const newest = await findNewestAnchor(deps.s3, deps.bucket);
			if (newest === null) {
				// Greenfield deploy guard — Decision #6. No anchors yet =
				// suppress the gap metric so the alarm does not fire before
				// the anchor Lambda has had its first cadence. Heartbeat alone
				// signals the watchdog is running.
				console.log({
					level: "info",
					msg: "compliance-anchor-watchdog: bucket empty — gap metric suppressed (greenfield)",
					bucket: deps.bucket,
				});
			} else {
				oldestUnanchoredAgeMs =
					Date.now() - newest.lastModified.getTime();
				anchorCount = newest.totalChecked;
				gapBreaching = oldestUnanchoredAgeMs > GAP_THRESHOLD_MS;
				try {
					await emitGapMetric(deps.cw, deps.stage, gapBreaching);
				} catch (err) {
					console.error({
						level: "error",
						msg: "compliance-anchor-watchdog: gap metric emit failed",
						error: err instanceof Error ? err.message : String(err),
					});
					_cw = undefined;
				}
			}
		} catch (err) {
			console.error({
				level: "error",
				msg: "compliance-anchor-watchdog: ListObjectsV2 failed",
				error: err instanceof Error ? err.message : String(err),
				bucket: deps.bucket,
			});
			_s3 = undefined;
			listObjectsFailed = true;
		}
	}

	const result: WatchdogResult = {
		mode: "live",
		checked_at: new Date().toISOString(),
		oldest_unanchored_age_ms: oldestUnanchoredAgeMs,
		anchor_count: anchorCount,
		gap_threshold_ms: GAP_THRESHOLD_MS,
		gap_breaching: gapBreaching,
	};

	console.log({
		level: listObjectsFailed ? "warn" : "info",
		msg: "compliance-anchor-watchdog: tick",
		...result,
		list_objects_failed: listObjectsFailed,
	});

	return result;
}

export async function handler(): Promise<WatchdogResult> {
	return runWatchdog();
}
