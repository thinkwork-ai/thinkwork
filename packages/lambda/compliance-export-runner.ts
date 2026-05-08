/**
 * Compliance export runner Lambda — INERT STUB (Phase 3 U11.U2).
 *
 * Triggered by SQS messages with body `{jobId: string}` queued by the
 * U11.U1 createComplianceExport mutation. The live runner (U11.U3)
 * will:
 *
 *   1. Update compliance.export_jobs: QUEUED → RUNNING (CAS guard).
 *   2. Open a server-side cursor on compliance.audit_events with the
 *      filter from the row.
 *   3. Stream rows to S3 multipart upload as CSV or NDJSON.
 *   4. Generate a 15-min presigned URL.
 *   5. Update compliance.export_jobs: RUNNING → COMPLETE | FAILED.
 *
 * In U11.U2 (this stub), every invocation throws. This is intentional
 * (per `feedback_ship_inert_pattern`):
 *
 *   - Throwing makes the inert state visible — SQS retries 3x then
 *     routes to the DLQ + the depth alarm fires.
 *   - A no-op stub would silently mark messages as processed and
 *     leave queued jobs as QUEUED forever with no operator signal.
 *
 * Module-load env snapshot mirrors the compliance-anchor pattern (per
 * `feedback_completion_callback_snapshot_pattern`) so the live U11.U3
 * body can adopt this scaffolding without re-reading os.environ.
 */

interface RunnerEnv {
	stage: string;
	bucket: string;
	queueUrl: string;
	databaseUrlSecretArn: string;
}

function getRunnerEnv(): RunnerEnv {
	return {
		stage: process.env.STAGE ?? "",
		bucket: process.env.COMPLIANCE_EXPORTS_BUCKET ?? "",
		queueUrl: process.env.COMPLIANCE_EXPORTS_QUEUE_URL ?? "",
		databaseUrlSecretArn: process.env.DATABASE_URL_SECRET_ARN ?? "",
	};
}

// Module-load snapshot — never re-read inside the handler.
const ENV = getRunnerEnv();

interface SQSRecord {
	messageId: string;
	receiptHandle: string;
	body: string;
}

interface SQSEvent {
	Records: SQSRecord[];
}

interface SQSBatchResponse {
	batchItemFailures: { itemIdentifier: string }[];
}

export async function handler(event: SQSEvent): Promise<SQSBatchResponse> {
	// Log the inert state for operator visibility. The throw on the next
	// line is the actual signal — SQS retries → DLQ → alarm.
	console.error(
		JSON.stringify({
			level: "error",
			component: "compliance-export-runner",
			message:
				"compliance-export-runner is inert (U11.U2 stub). U11.U3 ships the live body. This invocation will throw + retry until DLQ.",
			records: event.Records?.length ?? 0,
			stage: ENV.stage,
			bucket: ENV.bucket,
			queueUrl: ENV.queueUrl,
		}),
	);
	throw new Error(
		"compliance-export-runner: not implemented yet — U11.U3 ships the live body. Queued jobs accumulate in SQS until then.",
	);
}
