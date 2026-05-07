/**
 * Compliance Anchor Watchdog Lambda — INERT in U8a
 *
 * Phase 3 U8a of the System Workflows revert + Compliance reframe.
 *
 * Runs every 5 minutes via AWS Scheduler. In U8a the body short-circuits
 * (no S3 HeadObject, no `ComplianceAnchorGap` metric emit) but DOES emit
 * a `ComplianceAnchorWatchdogHeartbeat = 1.0` metric per invocation.
 *
 * Why the heartbeat in inert phase:
 *   1. Exercises the IAM PutMetricData path during the U8a soak window
 *      so an IAM regression gets caught BEFORE U8b ships its live
 *      logic.
 *   2. Gives U8b a denominator-stable signal for distinguishing "real
 *      anchor gap" (ComplianceAnchorGap >= 1) from "watchdog metric path
 *      broken" (ComplianceAnchorWatchdogHeartbeat IS MISSING).
 *
 * U8b will:
 *   - Replace `mode: "inert"` with `mode: "live"`.
 *   - Add S3 HeadObject on the newest `anchors/cadence-*.json` object.
 *   - Emit `ComplianceAnchorGap = (now - LastModified) > threshold ? 1 : 0`.
 *   - Flip the CloudWatch alarm's `treat_missing_data` from `notBreaching`
 *     to `breaching` and add the heartbeat composite to the alarm formula.
 *
 * Plan: docs/plans/2026-05-07-010-feat-compliance-u8a-anchor-lambda-inert-plan.md
 */

import {
	CloudWatchClient,
	PutMetricDataCommand,
	type CloudWatchClientConfig,
} from "@aws-sdk/client-cloudwatch";

// ---------------------------------------------------------------------------
// Shared types — exported for the U7 smoke gate so runtime assertions get
// compile-time mode validation. Keeps `mode === "inert"` typo-safe across
// U8a → U8b cutover.
// ---------------------------------------------------------------------------

export type WatchdogMode = "inert" | "live";

export interface WatchdogResult {
	mode: WatchdogMode;
	checked_at: string;
	oldest_unanchored_age_ms: number | null;
}

export const COMPLIANCE_METRICS_NAMESPACE = "Thinkwork/Compliance";
export const COMPLIANCE_ANCHOR_WATCHDOG_HEARTBEAT_METRIC =
	"ComplianceAnchorWatchdogHeartbeat";

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
// Lazy CloudWatch client — built on first invocation, cached for warm
// reuse, error-invalidated. Mirrors the U4 drainer's `_db` pattern.
// ---------------------------------------------------------------------------

let _cw: CloudWatchClient | undefined;

function getCloudWatchClient(): CloudWatchClient {
	if (_cw) return _cw;
	const config: CloudWatchClientConfig = {
		region: ENV.region,
		// Bound the SDK call so a regional CloudWatch degradation doesn't
		// consume the full Lambda timeout. 3s connection / 5s request is
		// the same shape the drainer uses for Secrets Manager.
		requestHandler: { requestTimeout: 5000, connectionTimeout: 3000 },
	};
	_cw = new CloudWatchClient(config);
	return _cw;
}

// ---------------------------------------------------------------------------
// Heartbeat metric emit
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

// ---------------------------------------------------------------------------
// Handler — exported for tests
// ---------------------------------------------------------------------------

export async function runWatchdog(
	deps: { cw: CloudWatchClient; stage: string } = {
		cw: getCloudWatchClient(),
		stage: ENV.stage,
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
		// Invalidate the cached client on any error — next invocation
		// rebuilds. Defends against transient SDK-internal pool corruption.
		_cw = undefined;
	}

	const result: WatchdogResult = {
		mode: "inert",
		checked_at: new Date().toISOString(),
		oldest_unanchored_age_ms: null,
	};

	console.log({
		level: "info",
		msg: "compliance-anchor-watchdog: tick",
		...result,
	});

	return result;
}

export async function handler(): Promise<WatchdogResult> {
	return runWatchdog();
}
