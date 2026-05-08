/**
 * Compliance export runner Lambda — LIVE (Phase 3 U11.U3).
 *
 * Triggered by SQS messages with body `{jobId: string}` from the U11.U1
 * `createComplianceExport` mutation. Streams matching audit_events rows
 * to S3 as CSV or NDJSON, generates a 15-minute presigned download URL,
 * and updates the job row to `complete` (or `failed`).
 *
 * Contract:
 *   - SQS event-source mapping is configured with batch_size=1 +
 *     function_response_types=["ReportBatchItemFailures"] (U11.U2).
 *   - Job-row CAS guard: `UPDATE … WHERE status='queued'`. If 0 rows
 *     update, this is a re-delivery (or the job already completed via
 *     a prior successful invocation) — log + skip without throwing.
 *   - On success: mark `complete` with `s3_key` + `presigned_url` +
 *     `presigned_url_expires_at` (now + 15 min) + `completed_at`.
 *   - On failure: mark `failed` with `job_error` + `completed_at`.
 *     Return SQS success — don't throw. The DB row already records the
 *     failure; bouncing to DLQ + alarm fires would be redundant noise.
 *   - Malformed SQS body (no jobId / non-uuid jobId) → throw, lets
 *     the message land in DLQ after maxReceiveCount=3.
 *
 * Deps that aren't in the Lambda runtime SDK (Node 20.x) and require
 * the BUNDLED_AGENTCORE_ESBUILD_FLAGS path in scripts/build-lambdas.sh:
 *   - `@aws-sdk/lib-storage` (multipart Upload helper)
 *   - `@aws-sdk/s3-request-presigner` (presigned URL signing)
 *
 * Module-load env snapshot is mandatory (per
 * `feedback_completion_callback_snapshot_pattern`): every helper
 * receives the snapshotted env explicitly; no helper re-reads
 * `process.env`.
 */

import {
	GetObjectCommand,
	S3Client,
	type S3ClientConfig,
} from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import {
	GetSecretValueCommand,
	SecretsManagerClient,
} from "@aws-sdk/client-secrets-manager";
import type { Client as PgClientType } from "pg";

// ---------------------------------------------------------------------------
// Env snapshot (per feedback_completion_callback_snapshot_pattern)
// ---------------------------------------------------------------------------

interface RunnerEnv {
	stage: string;
	bucket: string;
	queueUrl: string;
	databaseUrlSecretArn: string;
	region: string;
}

function getRunnerEnv(): RunnerEnv {
	return {
		stage: process.env.STAGE ?? "",
		bucket: process.env.COMPLIANCE_EXPORTS_BUCKET ?? "",
		queueUrl: process.env.COMPLIANCE_EXPORTS_QUEUE_URL ?? "",
		databaseUrlSecretArn: process.env.DATABASE_URL_SECRET_ARN ?? "",
		region: process.env.AWS_REGION ?? "us-east-1",
	};
}

// Module-load snapshot — never re-read inside the handler.
const ENV = getRunnerEnv();

// Sentinel mirrors packages/api/src/graphql/resolvers/compliance/exports.ts.
// When tenant_id on the job row matches this UUID, the export is
// operator-driven cross-tenant and the runner reads across all tenants.
const ALL_TENANTS_SENTINEL = "00000000-0000-0000-0000-000000000000";

// pg.Cursor batch size. 1000 is small enough to keep memory bounded
// (each event row averages a few KB; 1000 rows * 4 KB = 4 MB at most
// in memory at any time) and large enough that DB roundtrips don't
// dominate runtime.
const CURSOR_BATCH_SIZE = 1000;

const PRESIGNED_URL_TTL_SECONDS = 15 * 60;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ---------------------------------------------------------------------------
// Lazy clients
// ---------------------------------------------------------------------------

let _s3: S3Client | undefined;
function getS3Client(env: RunnerEnv): S3Client {
	if (!_s3) {
		const cfg: S3ClientConfig = { region: env.region };
		_s3 = new S3Client(cfg);
	}
	return _s3;
}

let _secrets: SecretsManagerClient | undefined;
function getSecretsClient(env: RunnerEnv): SecretsManagerClient {
	if (!_secrets) {
		_secrets = new SecretsManagerClient({
			region: env.region,
			requestHandler: { requestTimeout: 5000, connectionTimeout: 3000 },
		});
	}
	return _secrets;
}

interface SecretShape {
	username: string;
	password: string;
	host: string;
	port: number | string;
	dbname: string;
}

let _databaseUrlPromise: Promise<string> | undefined;
async function getDatabaseUrl(env: RunnerEnv): Promise<string> {
	if (
		process.env.NODE_ENV === "test" &&
		process.env.COMPLIANCE_EXPORT_RUNNER_DATABASE_URL
	) {
		return process.env.COMPLIANCE_EXPORT_RUNNER_DATABASE_URL;
	}
	if (!env.databaseUrlSecretArn) {
		throw new Error(
			"compliance-export-runner: DATABASE_URL_SECRET_ARN is unset. Wire it via Terraform.",
		);
	}
	if (!_databaseUrlPromise) {
		_databaseUrlPromise = (async () => {
			const sm = getSecretsClient(env);
			const result = await sm.send(
				new GetSecretValueCommand({ SecretId: env.databaseUrlSecretArn }),
			);
			const secret = JSON.parse(
				result.SecretString ?? "{}",
			) as SecretShape;
			const user = encodeURIComponent(secret.username);
			const pass = encodeURIComponent(secret.password);
			return `postgresql://${user}:${pass}@${secret.host}:${secret.port}/${secret.dbname}?sslmode=no-verify`;
		})();
	}
	return _databaseUrlPromise;
}

let _pgClient: PgClientType | undefined;
async function getPgClient(env: RunnerEnv): Promise<PgClientType> {
	if (_pgClient) return _pgClient;
	const url = await getDatabaseUrl(env);
	const { Client } = await import("pg");
	const client = new Client({ connectionString: url });
	await client.connect();
	client.on("error", () => {
		_pgClient = undefined;
	});
	_pgClient = client;
	return client;
}

/** Test-only — reset cached clients. */
export async function _resetRunnerClientsForTests(): Promise<void> {
	const existing = _pgClient;
	_pgClient = undefined;
	_secrets = undefined;
	_s3 = undefined;
	_databaseUrlPromise = undefined;
	if (existing) {
		try {
			await existing.end();
		} catch {
			// best-effort close
		}
	}
}

// ---------------------------------------------------------------------------
// CSV writer (RFC 4180-compliant inline implementation)
// ---------------------------------------------------------------------------

const CSV_HEADER = [
	"event_id",
	"tenant_id",
	"occurred_at",
	"recorded_at",
	"actor",
	"actor_type",
	"source",
	"event_type",
	"event_hash",
	"prev_hash",
	"payload_json",
];

function csvEscape(value: unknown): string {
	if (value === null || value === undefined) return "";
	const s = String(value);
	if (s.includes('"') || s.includes(",") || s.includes("\n") || s.includes("\r")) {
		return `"${s.replace(/"/g, '""')}"`;
	}
	return s;
}

function rowToCsv(row: AuditEventRow): string {
	const payloadJson = row.payload === null ? "" : JSON.stringify(row.payload);
	return (
		[
			row.event_id,
			row.tenant_id,
			row.occurred_at,
			row.recorded_at,
			row.actor,
			row.actor_type,
			row.source,
			row.event_type,
			row.event_hash,
			row.prev_hash ?? "",
			payloadJson,
		]
			.map(csvEscape)
			.join(",") + "\n"
	);
}

function rowToNdjson(row: AuditEventRow): string {
	return (
		JSON.stringify({
			event_id: row.event_id,
			tenant_id: row.tenant_id,
			occurred_at: row.occurred_at,
			recorded_at: row.recorded_at,
			actor: row.actor,
			actor_type: row.actor_type,
			source: row.source,
			event_type: row.event_type,
			event_hash: row.event_hash,
			prev_hash: row.prev_hash,
			payload: row.payload,
		}) + "\n"
	);
}

// ---------------------------------------------------------------------------
// Job + event-row shapes
// ---------------------------------------------------------------------------

interface ExportJobRow {
	job_id: string;
	tenant_id: string;
	requested_by_actor_id: string;
	filter: ExportFilter;
	format: "csv" | "json";
	status: string;
}

interface ExportFilter {
	tenantId?: string | null;
	actorType?: string | null;
	eventType?: string | null;
	since?: string | null;
	until?: string | null;
}

interface AuditEventRow {
	event_id: string;
	tenant_id: string;
	occurred_at: string;
	recorded_at: string;
	actor: string;
	actor_type: string;
	source: string;
	event_type: string;
	event_hash: string;
	prev_hash: string | null;
	payload: unknown;
}

// ---------------------------------------------------------------------------
// SQL helpers
// ---------------------------------------------------------------------------

async function loadJobRow(
	client: PgClientType,
	jobId: string,
): Promise<ExportJobRow | null> {
	const res = await client.query(
		`SELECT
			job_id::text AS job_id,
			tenant_id::text AS tenant_id,
			requested_by_actor_id::text AS requested_by_actor_id,
			filter,
			format,
			status
		   FROM compliance.export_jobs
		  WHERE job_id = $1::uuid
		  LIMIT 1`,
		[jobId],
	);
	const rows = res.rows as ExportJobRow[];
	return rows.length > 0 ? rows[0] : null;
}

/**
 * CAS guard: transition queued → running. Returns true when this
 * invocation owns the job; false when a re-delivery raced or the row
 * was already past `queued`.
 */
async function tryClaimJob(
	client: PgClientType,
	jobId: string,
): Promise<boolean> {
	const res = await client.query(
		`UPDATE compliance.export_jobs
		    SET status = 'running',
		        started_at = now()
		  WHERE job_id = $1::uuid
		    AND status = 'queued'`,
		[jobId],
	);
	return (res.rowCount ?? 0) > 0;
}

async function markJobComplete(
	client: PgClientType,
	jobId: string,
	s3Key: string,
	presignedUrl: string,
	expiresAt: string,
): Promise<void> {
	await client.query(
		`UPDATE compliance.export_jobs
		    SET status = 'complete',
		        s3_key = $2,
		        presigned_url = $3,
		        presigned_url_expires_at = $4::timestamptz,
		        completed_at = now()
		  WHERE job_id = $1::uuid
		    AND status = 'running'`,
		[jobId, s3Key, presignedUrl, expiresAt],
	);
}

async function markJobFailed(
	client: PgClientType,
	jobId: string,
	error: string,
): Promise<void> {
	await client.query(
		`UPDATE compliance.export_jobs
		    SET status = 'failed',
		        job_error = $2,
		        completed_at = now()
		  WHERE job_id = $1::uuid
		    AND status IN ('queued', 'running')`,
		[jobId, error.slice(0, 1000)],
	);
}

function buildEventsQuery(
	job: ExportJobRow,
): { sql: string; params: unknown[] } {
	const wheres: string[] = [];
	const params: unknown[] = [];
	let n = 0;
	const next = () => `$${++n}`;

	const filter = job.filter ?? ({} as ExportFilter);
	const isAllTenants = job.tenant_id === ALL_TENANTS_SENTINEL;

	if (!isAllTenants) {
		wheres.push(`tenant_id = ${next()}::uuid`);
		params.push(job.tenant_id);
	} else if (filter.tenantId) {
		// Operator chose ALL_TENANTS but the filter has a specific
		// tenantId — honor the filter (operator UI may set both).
		wheres.push(`tenant_id = ${next()}::uuid`);
		params.push(filter.tenantId);
	}

	if (filter.actorType) {
		wheres.push(`actor_type = ${next()}`);
		params.push(filter.actorType.toLowerCase());
	}
	if (filter.eventType) {
		// The mutation stores the GraphQL enum value (UPPER_UNDERSCORE);
		// the DB has the dotted-lowercase form. Replicate the codec
		// without importing it (keeps the runner decoupled from the api
		// package).
		wheres.push(`event_type = ${next()}`);
		params.push(filter.eventType.toLowerCase().replace(/_/g, "."));
	}
	if (filter.since) {
		wheres.push(`occurred_at >= ${next()}::timestamptz`);
		params.push(filter.since);
	}
	if (filter.until) {
		wheres.push(`occurred_at < ${next()}::timestamptz`);
		params.push(filter.until);
	}

	const whereClause = wheres.length > 0 ? `WHERE ${wheres.join(" AND ")}` : "";

	return {
		sql: `SELECT
			event_id::text AS event_id,
			tenant_id::text AS tenant_id,
			occurred_at::text AS occurred_at,
			recorded_at::text AS recorded_at,
			actor,
			actor_type,
			source,
			event_type,
			event_hash,
			prev_hash,
			payload
		   FROM compliance.audit_events
		   ${whereClause}
		   ORDER BY occurred_at ASC, event_id ASC`,
		params,
	};
}

// ---------------------------------------------------------------------------
// Stream rows → S3 multipart upload
// ---------------------------------------------------------------------------

function objectKeyForJob(job: ExportJobRow): string {
	const ext = job.format === "csv" ? "csv" : "ndjson";
	if (job.tenant_id === ALL_TENANTS_SENTINEL) {
		return `multi-tenant/${job.job_id}.${ext}`;
	}
	return `${job.tenant_id}/${job.job_id}.${ext}`;
}

function contentTypeForJob(job: ExportJobRow): string {
	return job.format === "csv" ? "text/csv" : "application/x-ndjson";
}

interface PgCursorLike {
	read(
		count: number,
		cb: (err: Error | null, rows: AuditEventRow[]) => void,
	): void;
	close(cb?: (err: Error | null) => void): void;
}

interface PgClientWithCursor {
	query: (cursor: unknown) => PgCursorLike;
}

async function streamExportToS3(
	pg: PgClientType,
	s3: S3Client,
	bucket: string,
	job: ExportJobRow,
): Promise<{ s3Key: string }> {
	const { Readable } = await import("node:stream");
	const PgCursorMod = await import("pg-cursor");
	const PgCursor = (PgCursorMod as { default?: unknown }).default ??
		PgCursorMod;

	const { sql, params } = buildEventsQuery(job);
	const cursor = (pg as unknown as PgClientWithCursor).query(
		new (PgCursor as new (sql: string, params: unknown[]) => unknown)(
			sql,
			params,
		),
	);

	const formatRow = job.format === "csv" ? rowToCsv : rowToNdjson;
	const header = job.format === "csv" ? CSV_HEADER.join(",") + "\n" : "";

	const readBatch = (): Promise<AuditEventRow[]> =>
		new Promise((resolve, reject) => {
			cursor.read(CURSOR_BATCH_SIZE, (err, rows) => {
				if (err) reject(err);
				else resolve(rows);
			});
		});
	const closeCursor = (): Promise<void> =>
		new Promise((resolve) => {
			cursor.close(() => resolve());
		});

	let headerEmitted = false;
	const body = new Readable({
		async read() {
			try {
				if (!headerEmitted) {
					headerEmitted = true;
					if (header) this.push(header);
				}
				const rows = await readBatch();
				if (rows.length === 0) {
					await closeCursor();
					this.push(null);
					return;
				}
				let chunk = "";
				for (const row of rows) chunk += formatRow(row);
				this.push(chunk);
			} catch (err) {
				try {
					await closeCursor();
				} catch {
					// best-effort
				}
				this.destroy(err as Error);
			}
		},
	});

	const s3Key = objectKeyForJob(job);
	const upload = new Upload({
		client: s3,
		params: {
			Bucket: bucket,
			Key: s3Key,
			Body: body,
			ContentType: contentTypeForJob(job),
		},
	});

	try {
		await upload.done();
	} catch (err) {
		try {
			await closeCursor();
		} catch {
			// best-effort
		}
		throw err;
	}

	return { s3Key };
}

// ---------------------------------------------------------------------------
// SQS handler
// ---------------------------------------------------------------------------

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

interface MessageBody {
	jobId: string;
}

function parseMessageBody(record: SQSRecord): MessageBody {
	let body: unknown;
	try {
		body = JSON.parse(record.body);
	} catch (err) {
		throw new Error(
			`compliance-export-runner: malformed SQS body — not JSON: ${
				err instanceof Error ? err.message : String(err)
			}`,
		);
	}
	if (
		typeof body !== "object" ||
		body === null ||
		typeof (body as MessageBody).jobId !== "string" ||
		!UUID_RE.test((body as MessageBody).jobId)
	) {
		throw new Error(
			"compliance-export-runner: malformed SQS body — expected {jobId: <uuid>}",
		);
	}
	return body as MessageBody;
}

export async function handler(event: SQSEvent): Promise<SQSBatchResponse> {
	const failures: { itemIdentifier: string }[] = [];

	if (!ENV.bucket) {
		throw new Error(
			"compliance-export-runner: COMPLIANCE_EXPORTS_BUCKET is unset",
		);
	}

	for (const record of event.Records ?? []) {
		try {
			await processRecord(record);
		} catch (err) {
			// Malformed body / handler crash → land in DLQ via the
			// partial-failure protocol. Business failures are recorded
			// in the DB by processRecord and DO NOT throw, so they don't
			// reach this branch.
			console.error(
				JSON.stringify({
					level: "error",
					component: "compliance-export-runner",
					messageId: record.messageId,
					error: err instanceof Error ? err.message : String(err),
				}),
			);
			failures.push({ itemIdentifier: record.messageId });
		}
	}

	return { batchItemFailures: failures };
}

async function processRecord(record: SQSRecord): Promise<void> {
	const { jobId } = parseMessageBody(record);
	const pg = await getPgClient(ENV);

	const claimed = await tryClaimJob(pg, jobId);
	if (!claimed) {
		console.log(
			JSON.stringify({
				level: "info",
				component: "compliance-export-runner",
				messageId: record.messageId,
				jobId,
				event: "skip-not-queued",
				message:
					"job is not in 'queued' state — re-delivery or another invocation completed it",
			}),
		);
		return;
	}

	let job: ExportJobRow | null;
	try {
		job = await loadJobRow(pg, jobId);
	} catch (err) {
		await safelyMarkFailed(pg, jobId, err);
		return;
	}
	if (!job) {
		await safelyMarkFailed(pg, jobId, new Error("job row disappeared"));
		return;
	}

	const s3 = getS3Client(ENV);

	try {
		const { s3Key } = await streamExportToS3(pg, s3, ENV.bucket, job);
		const presignedUrl = await getSignedUrl(
			s3,
			new GetObjectCommand({ Bucket: ENV.bucket, Key: s3Key }),
			{ expiresIn: PRESIGNED_URL_TTL_SECONDS },
		);
		const expiresAt = new Date(
			Date.now() + PRESIGNED_URL_TTL_SECONDS * 1000,
		).toISOString();
		await markJobComplete(pg, jobId, s3Key, presignedUrl, expiresAt);
		console.log(
			JSON.stringify({
				level: "info",
				component: "compliance-export-runner",
				jobId,
				event: "complete",
				s3Key,
				expiresAt,
			}),
		);
	} catch (err) {
		await safelyMarkFailed(pg, jobId, err);
	}
}

async function safelyMarkFailed(
	pg: PgClientType,
	jobId: string,
	err: unknown,
): Promise<void> {
	const message = err instanceof Error ? err.message : String(err);
	console.error(
		JSON.stringify({
			level: "error",
			component: "compliance-export-runner",
			jobId,
			event: "failed",
			error: message,
		}),
	);
	try {
		await markJobFailed(pg, jobId, message);
	} catch (markErr) {
		// If the FAILED-update itself fails, log + return success so the
		// SQS message acks. Throwing would re-deliver, the CAS guard
		// would not match (status='running'), and the job would stay in
		// 'running' forever. The stuck-running pathology is detectable
		// via the listing query.
		console.error(
			JSON.stringify({
				level: "error",
				component: "compliance-export-runner",
				jobId,
				event: "mark-failed-failed",
				error:
					markErr instanceof Error ? markErr.message : String(markErr),
			}),
		);
	}
}

// ---------------------------------------------------------------------------
// Test-only exports
// ---------------------------------------------------------------------------

export const _internals = {
	csvEscape,
	rowToCsv,
	rowToNdjson,
	buildEventsQuery,
	objectKeyForJob,
	parseMessageBody,
	tryClaimJob,
	markJobComplete,
	markJobFailed,
	loadJobRow,
	streamExportToS3,
	processRecord,
	CSV_HEADER,
	ALL_TENANTS_SENTINEL,
};
