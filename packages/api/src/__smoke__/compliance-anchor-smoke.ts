/**
 * Post-deploy smoke for the Compliance Anchor pipeline (Phase 3 U8b).
 *
 * Why this exists: the anchor cadence runs every 15 minutes, the
 * watchdog every 5 minutes. Without an explicit smoke gate, response-
 * shape regressions land silently and only surface when an operator
 * hand-checks CloudWatch. The dispatch-pin pattern
 * (`feedback_smoke_pin_dispatch_status_in_response`) lifts the
 * verification surface from log-grep to JSON-shape assertion.
 *
 * Scope: invokes both Lambdas directly via aws-sdk LambdaClient and
 * asserts the U8b live response shape:
 *   compliance-anchor          → {dispatched: true, anchored: true,
 *                                 merkle_root: <64-hex>, tenant_count: number,
 *                                 anchored_event_count: number,
 *                                 cadence_id: <UUIDv7>,
 *                                 s3_key: anchors/cadence-<id>.json,
 *                                 retain_until_date: <ISO8601>}
 *   compliance-anchor-watchdog → {mode: "live", checked_at: <ISO>,
 *                                 oldest_unanchored_age_ms: null|number,
 *                                 anchor_count: number,
 *                                 gap_threshold_ms: number,
 *                                 gap_breaching: boolean}
 *
 * Plan: docs/plans/2026-05-07-012-feat-compliance-u8b-anchor-lambda-live-plan.md
 */

import {
	LambdaClient,
	InvokeCommand,
	type InvokeCommandOutput,
} from "@aws-sdk/client-lambda";

// Inline the response-shape types — packages/api's tsconfig rootDir is
// scoped to packages/api/src, so importing TS types directly from
// packages/lambda crosses rootDir and fails compile. The
// `@thinkwork/lambda` package only exports ./github-workspace today.
// **Source of truth:**
//   - AnchorResult: packages/lambda/compliance-anchor.ts
//   - WatchdogMode + WatchdogResult: packages/lambda/compliance-anchor-watchdog.ts
// Casing typos still get caught by the literal-type union (`"inert" | "live"`).

type WatchdogMode = "inert" | "live";

interface AnchorResponseShape {
	dispatched?: boolean;
	anchored?: boolean;
	merkle_root?: string;
	tenant_count?: number;
	anchored_event_count?: number;
	cadence_id?: string;
	s3_key?: string;
	retain_until_date?: string;
}

interface WatchdogResponseShape {
	mode?: WatchdogMode;
	checked_at?: string;
	oldest_unanchored_age_ms?: number | null;
	anchor_count?: number;
	gap_threshold_ms?: number;
	gap_breaching?: boolean;
}

const STAGE = process.env.STAGE || "dev";
const REGION = process.env.AWS_REGION || "us-east-1";
const ANCHOR_FN = `thinkwork-${STAGE}-api-compliance-anchor`;
const WATCHDOG_FN = `thinkwork-${STAGE}-api-compliance-anchor-watchdog`;

const UUIDV7_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256_HEX_RE = /^[0-9a-f]{64}$/;
const ISO8601_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,9})?Z$/;
const ANCHOR_KEY_RE = /^anchors\/cadence-[0-9a-f-]+\.json$/i;

function fail(reason: string, context?: Record<string, unknown>): never {
	console.error(
		`compliance-anchor-smoke: FAIL: ${reason}${
			context ? ` ${JSON.stringify(context)}` : ""
		}`,
	);
	process.exit(1);
}

function log(msg: string, fields?: Record<string, unknown>): void {
	console.log(
		`compliance-anchor-smoke: ${msg}${
			fields ? ` ${JSON.stringify(fields)}` : ""
		}`,
	);
}

async function invokeLambda(
	client: LambdaClient,
	functionName: string,
): Promise<unknown> {
	let output: InvokeCommandOutput;
	try {
		output = await client.send(
			new InvokeCommand({
				FunctionName: functionName,
				InvocationType: "RequestResponse",
				Payload: Buffer.from(JSON.stringify({})),
			}),
		);
	} catch (err) {
		fail(`Lambda invoke failed for ${functionName}`, {
			error: err instanceof Error ? err.message : String(err),
		});
	}

	if (output.FunctionError) {
		fail(`Lambda returned FunctionError on ${functionName}`, {
			functionError: output.FunctionError,
			payload: output.Payload
				? new TextDecoder().decode(output.Payload)
				: undefined,
		});
	}

	if (!output.Payload) {
		fail(`Lambda returned empty payload on ${functionName}`);
	}

	const text = new TextDecoder().decode(output.Payload);
	try {
		return JSON.parse(text);
	} catch {
		fail(`Lambda response is not JSON on ${functionName}`, { text });
	}
}

async function smokeAnchor(client: LambdaClient): Promise<void> {
	log(`invoking ${ANCHOR_FN}`);
	const raw = (await invokeLambda(client, ANCHOR_FN)) as Partial<AnchorResponseShape>;

	if (raw.dispatched !== true) {
		fail("anchor: dispatched !== true", { raw });
	}
	if (raw.anchored !== true) {
		fail("anchor: anchored !== true (U8b live — expected real S3 PutObject)", {
			raw,
		});
	}
	if (typeof raw.merkle_root !== "string" || !SHA256_HEX_RE.test(raw.merkle_root)) {
		fail("anchor: merkle_root is not a 64-char hex string", { raw });
	}
	if (typeof raw.tenant_count !== "number" || raw.tenant_count < 0) {
		fail("anchor: tenant_count is not a non-negative number", { raw });
	}
	if (
		typeof raw.anchored_event_count !== "number" ||
		raw.anchored_event_count < 0
	) {
		fail("anchor: anchored_event_count is not a non-negative number", { raw });
	}
	if (typeof raw.cadence_id !== "string" || !UUIDV7_RE.test(raw.cadence_id)) {
		fail("anchor: cadence_id is not a valid UUIDv7", { raw });
	}
	// U8b additions — the s3_key + retain_until_date are the load-bearing
	// signals that the live function ACTUALLY wrote to S3 with Object Lock.
	if (typeof raw.s3_key !== "string" || !ANCHOR_KEY_RE.test(raw.s3_key)) {
		fail("anchor: s3_key does not match anchors/cadence-<id>.json", { raw });
	}
	if (
		typeof raw.retain_until_date !== "string" ||
		!ISO8601_RE.test(raw.retain_until_date)
	) {
		fail("anchor: retain_until_date is not an ISO8601 string", { raw });
	}

	log("anchor OK", {
		merkle_root: raw.merkle_root.slice(0, 8) + "...",
		tenant_count: raw.tenant_count,
		anchored_event_count: raw.anchored_event_count,
		cadence_id: raw.cadence_id,
		s3_key: raw.s3_key,
		retain_until_date: raw.retain_until_date,
	});
}

async function smokeWatchdog(client: LambdaClient): Promise<void> {
	log(`invoking ${WATCHDOG_FN}`);
	const raw = (await invokeLambda(client, WATCHDOG_FN)) as Partial<WatchdogResponseShape>;

	if (raw.mode !== "live") {
		fail(`watchdog: mode !== "live" (U8b expected live)`, { raw });
	}
	if (typeof raw.checked_at !== "string" || !ISO8601_RE.test(raw.checked_at)) {
		fail("watchdog: checked_at is not an ISO8601 string", { raw });
	}
	if (
		raw.oldest_unanchored_age_ms !== null &&
		typeof raw.oldest_unanchored_age_ms !== "number"
	) {
		fail("watchdog: oldest_unanchored_age_ms is not null or number", { raw });
	}
	if (typeof raw.anchor_count !== "number" || raw.anchor_count < 0) {
		fail("watchdog: anchor_count is not a non-negative number", { raw });
	}
	if (typeof raw.gap_threshold_ms !== "number" || raw.gap_threshold_ms <= 0) {
		fail("watchdog: gap_threshold_ms is not a positive number", { raw });
	}
	if (typeof raw.gap_breaching !== "boolean") {
		fail("watchdog: gap_breaching is not a boolean", { raw });
	}

	log("watchdog OK", {
		mode: raw.mode,
		checked_at: raw.checked_at,
		anchor_count: raw.anchor_count,
		gap_breaching: raw.gap_breaching,
		oldest_unanchored_age_ms: raw.oldest_unanchored_age_ms,
	});
}

async function main(): Promise<void> {
	const client = new LambdaClient({ region: REGION });
	await smokeAnchor(client);
	await smokeWatchdog(client);
	log("all smokes passed");
}

main().catch((err) => {
	fail("unhandled error", {
		error: err instanceof Error ? err.message : String(err),
	});
});
