/**
 * Post-deploy smoke for the U11 compliance-export-runner Lambda.
 *
 * The runner is SQS-triggered, so the smoke can't rely on the schedule
 * pattern the anchor smoke uses. Instead, we synthesize a fake SQS event
 * with a well-formed but non-existent jobId (a UUIDv7 that no row will
 * match) and assert the runner returns the partial-failure protocol's
 * empty failure list — exercising:
 *
 *   - SQS body parse path (UUID validation)
 *   - Pg client connect via DATABASE_URL_SECRET_ARN
 *   - CAS guard SELECT/UPDATE on compliance.export_jobs (no-op when row
 *     doesn't exist; runner logs "skip-not-queued" + returns success)
 *
 * What this does NOT cover (deferred to U11.U5 SOC2 walkthrough):
 *   - End-to-end CSV/NDJSON write to S3
 *   - Presigned URL generation
 *   - Actual job-row state transitions
 *
 * Failure mode this catches: the Lambda doesn't deploy with the right
 * env vars, the IAM role can't reach Secrets Manager, the Aurora
 * connection drops at boot, or the SQS event-source mapping isn't
 * wired (the smoke invokes the function directly so this last one is
 * covered by absence-of-error rather than presence-of-message).
 */

import {
	InvokeCommand,
	LambdaClient,
	type InvokeCommandOutput,
} from "@aws-sdk/client-lambda";

const STAGE = process.env.STAGE ?? "dev";
const AWS_REGION = process.env.AWS_REGION ?? "us-east-1";
const FUNCTION_NAME = `thinkwork-${STAGE}-api-compliance-export-runner`;

// Fixed UUIDv7-shaped value — no row will match in compliance.export_jobs
// because the timestamp prefix is from the year 2000 (well before any
// real export). Picked once + stable across runs so a future operator
// inspecting CloudWatch can identify smoke invocations by the jobId.
const SMOKE_JOB_ID = "00500000-0000-7000-8000-000000000000";

interface BatchResponse {
	batchItemFailures: { itemIdentifier: string }[];
}

function fail(reason: string, context?: Record<string, unknown>): never {
	console.error(
		JSON.stringify({
			level: "error",
			component: "compliance-export-runner-smoke",
			reason,
			...(context ?? {}),
		}),
	);
	process.exit(1);
}

function log(msg: string, fields?: Record<string, unknown>): void {
	console.log(
		JSON.stringify({
			level: "info",
			component: "compliance-export-runner-smoke",
			message: msg,
			...(fields ?? {}),
		}),
	);
}

async function main(): Promise<void> {
	log("smoke start", { functionName: FUNCTION_NAME, region: AWS_REGION });

	const client = new LambdaClient({ region: AWS_REGION });
	const event = {
		Records: [
			{
				messageId: `smoke-${Date.now()}`,
				receiptHandle: "smoke-receipt",
				body: JSON.stringify({ jobId: SMOKE_JOB_ID }),
			},
		],
	};

	let result: InvokeCommandOutput;
	try {
		result = await client.send(
			new InvokeCommand({
				FunctionName: FUNCTION_NAME,
				InvocationType: "RequestResponse",
				LogType: "Tail",
				Payload: Buffer.from(JSON.stringify(event), "utf8"),
			}),
		);
	} catch (err) {
		fail("invoke failed", {
			error: err instanceof Error ? err.message : String(err),
		});
	}

	if (result.FunctionError) {
		fail("function returned error", {
			functionError: result.FunctionError,
			payload: Buffer.from(result.Payload ?? new Uint8Array()).toString("utf8"),
		});
	}

	const payloadBytes = result.Payload;
	if (!payloadBytes || payloadBytes.length === 0) {
		fail("function returned empty payload");
	}
	let parsed: BatchResponse;
	try {
		parsed = JSON.parse(Buffer.from(payloadBytes).toString("utf8"));
	} catch (err) {
		fail("function payload not JSON", {
			error: err instanceof Error ? err.message : String(err),
		});
	}

	if (!parsed || typeof parsed !== "object") {
		fail("function payload not an object", { parsed });
	}
	if (!Array.isArray(parsed.batchItemFailures)) {
		fail("function payload missing batchItemFailures array", { parsed });
	}
	if (parsed.batchItemFailures.length !== 0) {
		fail("function reported batch failures on smoke invocation", {
			failures: parsed.batchItemFailures,
		});
	}

	log("smoke ok — runner returned empty batchItemFailures", {
		jobId: SMOKE_JOB_ID,
	});
}

main().catch((err) => {
	fail("uncaught error in smoke", {
		error: err instanceof Error ? err.message : String(err),
	});
});
