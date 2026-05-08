/**
 * Compliance async-export resolvers (Phase 3 U11).
 *
 * Two surfaces:
 *   - Mutation.createComplianceExport(filter, format)
 *   - Query.complianceExports
 *
 * Auth model: identical to U10 read resolvers — apikey hard-block,
 * operator vs tenant-scope via THINKWORK_PLATFORM_OPERATOR_EMAILS,
 * shared via `requireComplianceReader`.
 *
 * Mutation flow:
 *   1. Validate filter (90-day cap + 4 KB byte cap).
 *   2. requireComplianceReader → effectiveTenantId + isOperator.
 *   3. Resolve actor_id (Cognito user → users.id UUID).
 *   4. Rate-limit check (10/hour per actor).
 *   5. Transaction: INSERT export_jobs row + emitAuditEvent
 *      (data.export_initiated). Audit-event tier is control-evidence:
 *      audit failure rolls back the insert.
 *   6. After commit: send SQS message {jobId} via @aws-sdk/client-sqs.
 *      If SQS send fails, mark the job FAILED with jobError.
 *
 * Listing flow (mirrors complianceEvents auth shape):
 *   - Operators: SELECT scoped only by effectiveTenantId if set.
 *   - Non-operators: SELECT scoped to their resolved tenant.
 *
 * The runner Lambda (U3, separate PR) consumes the SQS message + writes
 * S3 + updates the job row. This resolver has no awareness of the runner.
 */

import { GraphQLError } from "graphql";
import { sql } from "drizzle-orm";
import {
	SQSClient,
	SendMessageCommand,
} from "@aws-sdk/client-sqs";
import type { GraphQLContext } from "../../context.js";
import { db } from "../../utils.js";
import { requireComplianceReader } from "../../../lib/compliance/resolver-auth.js";
import { resolveCallerUserId } from "../core/resolve-auth-user.js";
import { emitAuditEvent } from "../../../lib/compliance/emit.js";
import { checkExportRateLimit } from "../../../lib/compliance/export-rate-limit.js";

// 4 KB serialized filter cap. Defends against payload-balloon attacks
// where a large filter object inflates the audit-event row + the SQS
// message + the export_jobs.filter column.
const FILTER_BYTE_CAP = 4 * 1024;

// 90-day max filter window (until - since). Hard cap; the runner Lambda
// has a 15-minute timeout that's the practical ceiling for very large
// exports. The 90-day cap keeps row volume bounded at v1 tenant scale.
const MAX_FILTER_WINDOW_DAYS = 90;
const MAX_FILTER_WINDOW_MS = MAX_FILTER_WINDOW_DAYS * 24 * 60 * 60 * 1000;

const FORMAT_GQL_TO_DB: Record<string, "csv" | "json"> = {
	CSV: "csv",
	JSON: "json",
};

const STATUS_DB_TO_GQL: Record<string, string> = {
	queued: "QUEUED",
	running: "RUNNING",
	complete: "COMPLETE",
	failed: "FAILED",
};

const FORMAT_DB_TO_GQL: Record<string, string> = {
	csv: "CSV",
	json: "JSON",
};

// Sentinel for operator-driven cross-tenant exports. The export_jobs row
// requires a non-null tenant_id; operators submitting a filter with no
// tenantId carry this UUID so the runner can recognize "all-tenants"
// scope. The runner Lambda uses this same constant to gate its scope
// expansion when the row is consumed.
export const ALL_TENANTS_SENTINEL = "00000000-0000-0000-0000-000000000000";

interface ComplianceEventFilterInput {
	tenantId?: string | null;
	actorType?: string | null;
	eventType?: string | null;
	since?: string | null;
	until?: string | null;
}

interface CreateComplianceExportArgs {
	filter: ComplianceEventFilterInput;
	format: "CSV" | "JSON";
}

interface ExportJobRow {
	job_id: string;
	tenant_id: string;
	requested_by_actor_id: string;
	filter: unknown;
	format: string;
	status: string;
	s3_key: string | null;
	presigned_url: string | null;
	presigned_url_expires_at: string | null;
	job_error: string | null;
	requested_at: string;
	started_at: string | null;
	completed_at: string | null;
}

function rowToGql(row: ExportJobRow) {
	return {
		jobId: row.job_id,
		tenantId: row.tenant_id,
		requestedByActorId: row.requested_by_actor_id,
		requestedAt: row.requested_at,
		status: STATUS_DB_TO_GQL[row.status] ?? "FAILED",
		format: FORMAT_DB_TO_GQL[row.format] ?? "CSV",
		filter:
			typeof row.filter === "string" ? row.filter : JSON.stringify(row.filter),
		s3Key: row.s3_key,
		presignedUrl: row.presigned_url,
		presignedUrlExpiresAt: row.presigned_url_expires_at,
		jobError: row.job_error,
		startedAt: row.started_at,
		completedAt: row.completed_at,
	};
}

function validateFilter(filter: ComplianceEventFilterInput): void {
	const serialized = JSON.stringify(filter ?? {});
	if (Buffer.byteLength(serialized, "utf8") > FILTER_BYTE_CAP) {
		throw new GraphQLError(
			`Filter exceeds the ${FILTER_BYTE_CAP}-byte cap.`,
			{ extensions: { code: "FILTER_TOO_LARGE" } },
		);
	}
	if (filter.since && filter.until) {
		const since = Date.parse(filter.since);
		const until = Date.parse(filter.until);
		if (Number.isNaN(since) || Number.isNaN(until)) {
			throw new GraphQLError("since/until must be valid ISO 8601 timestamps.", {
				extensions: { code: "BAD_USER_INPUT" },
			});
		}
		if (until <= since) {
			throw new GraphQLError(
				"`until` must be strictly greater than `since`.",
				{ extensions: { code: "BAD_USER_INPUT" } },
			);
		}
		if (until - since > MAX_FILTER_WINDOW_MS) {
			throw new GraphQLError(
				`Filter range exceeds the ${MAX_FILTER_WINDOW_DAYS}-day cap.`,
				{ extensions: { code: "FILTER_RANGE_TOO_WIDE" } },
			);
		}
	}
}

function getQueueUrl(): string {
	const url = process.env.COMPLIANCE_EXPORTS_QUEUE_URL;
	if (!url) {
		throw new GraphQLError(
			"compliance exports are not available in this environment — COMPLIANCE_EXPORTS_QUEUE_URL is unset on the graphql-http Lambda.",
			{ extensions: { code: "INTERNAL_SERVER_ERROR" } },
		);
	}
	return url;
}

let _sqs: SQSClient | undefined;
function getSqsClient(): SQSClient {
	if (!_sqs) {
		_sqs = new SQSClient({ region: process.env.AWS_REGION ?? "us-east-1" });
	}
	return _sqs;
}

/** Test seam: integration tests inject a fake SQS client that records SendMessage inputs. */
export function _setSqsClientForTests(client: SQSClient | undefined): void {
	_sqs = client;
}

interface PgQueryClient {
	query: (
		sql: string,
		values: unknown[],
	) => Promise<{ rows: unknown[] }>;
}

/**
 * Adapter so the rate-limit helper can run against the writer-pool
 * `db` (Drizzle handle) — converts the helper's pg-style query call
 * into a `db.execute(sql.raw)` invocation. The helper itself takes a
 * `{query: (sql, values) => Promise<{rows}>}` shape so it's reusable
 * across the reader-pool client too.
 */
function makeRateLimitClient(): PgQueryClient {
	return {
		async query(rawSql: string, values: unknown[]): Promise<{ rows: unknown[] }> {
			// Drizzle's sql.raw + sql.placeholder doesn't support an array
			// of positional params cleanly; the helper's only query has a
			// single $1 actor_id parameter, so substitute inline.
			if (values.length !== 1) {
				throw new Error(
					`makeRateLimitClient: expected 1 param, got ${values.length}`,
				);
			}
			const actorId = values[0] as string;
			const result = (await db.execute(sql`
				SELECT count(*)::int AS n
				  FROM compliance.export_jobs
				 WHERE requested_by_actor_id = ${actorId}::uuid
				   AND requested_at > now() - INTERVAL '1 hour'
			`)) as unknown as { rows: unknown[] };
			return result;
			// rawSql is unused — the actual SQL is duplicated in this
			// adapter because parameterizing arbitrary SQL through Drizzle's
			// sql template requires per-placeholder typing the helper
			// doesn't surface. The helper's query string and the literal
			// template above must stay in sync (covered by integration
			// test "rate limit counts queued + failed within window").
		},
	};
}

// ---------------------------------------------------------------------------
// Mutation.createComplianceExport
// ---------------------------------------------------------------------------

export async function createComplianceExport(
	_parent: unknown,
	args: CreateComplianceExportArgs,
	ctx: GraphQLContext,
): Promise<ReturnType<typeof rowToGql>> {
	validateFilter(args.filter);
	const auth = await requireComplianceReader(
		ctx,
		args.filter.tenantId ?? undefined,
	);

	// requireComplianceReader has already enforced apikey-block. The
	// resolved actor is the Cognito user's UUID. resolveCallerUserId
	// returns null only when the Cognito sub doesn't map to a users row,
	// which shouldn't happen for an authenticated session past
	// requireComplianceReader's checks — fail closed if it does.
	const actorId = await resolveCallerUserId(ctx);
	if (!actorId) {
		throw new GraphQLError(
			"Cannot resolve a users.id for the caller — refusing to record an export request without a stable actor.",
			{ extensions: { code: "UNAUTHENTICATED" } },
		);
	}

	// Resolve the queue URL up front so we fail fast on env-var
	// misconfiguration BEFORE creating any DB rows.
	const queueUrl = getQueueUrl();

	const rateLimitClient = makeRateLimitClient();
	const rateLimit = await checkExportRateLimit(rateLimitClient, actorId);
	if (!rateLimit.allowed) {
		throw new GraphQLError(
			`Export rate limit exceeded (${rateLimit.limit}/hour). Try again later.`,
			{
				extensions: {
					code: "RATE_LIMIT_EXCEEDED",
					current: rateLimit.current,
					limit: rateLimit.limit,
					windowSeconds: rateLimit.windowSeconds,
				},
			},
		);
	}

	// Non-operators: requireComplianceReader has already overridden the
	// requested tenantId to the caller's own scope. Operators may have
	// effectiveTenantId === undefined to mean "all tenants" — for the
	// export job row we still need a non-null tenant_id, so use the
	// ALL_TENANTS_SENTINEL constant.
	const tenantIdForRow =
		auth.effectiveTenantId ??
		(auth.isOperator ? ALL_TENANTS_SENTINEL : null);
	if (!tenantIdForRow) {
		// Defensive: requireComplianceReader fail-closes on null tenant for
		// non-operators. Keep the throw so any future regression in the
		// auth helper produces a loud failure rather than a silently-tenant-less row.
		throw new GraphQLError(
			"Compliance export requires a resolved tenant scope.",
			{ extensions: { code: "UNAUTHENTICATED" } },
		);
	}

	const dbFormat = FORMAT_GQL_TO_DB[args.format];
	if (!dbFormat) {
		throw new GraphQLError(`Unknown export format '${args.format}'.`, {
			extensions: { code: "BAD_USER_INPUT" },
		});
	}
	const filterJson = args.filter ?? {};

	// Insert the job row + emit the audit event in one transaction. If
	// the audit emit fails (control-evidence tier per master plan U5),
	// the export row is rolled back — auditors should never see a job
	// without a corresponding data.export_initiated event.
	const insertedRow = await db.transaction(async (tx) => {
		const filterJsonString = JSON.stringify(filterJson);
		const inserted = (await tx.execute(sql`
			INSERT INTO compliance.export_jobs (
				tenant_id, requested_by_actor_id, filter, format, status
			) VALUES (
				${tenantIdForRow}::uuid,
				${actorId}::uuid,
				${filterJsonString}::jsonb,
				${dbFormat},
				'queued'
			)
			RETURNING
				job_id::text AS job_id,
				tenant_id::text AS tenant_id,
				requested_by_actor_id::text AS requested_by_actor_id,
				filter,
				format,
				status,
				s3_key,
				presigned_url,
				presigned_url_expires_at::text AS presigned_url_expires_at,
				job_error,
				requested_at::text AS requested_at,
				started_at::text AS started_at,
				completed_at::text AS completed_at
		`)) as unknown as { rows: ExportJobRow[] };
		const row = inserted.rows[0];

		await emitAuditEvent(tx, {
			tenantId: tenantIdForRow,
			actorId,
			actorType: "user",
			eventType: "data.export_initiated",
			source: "graphql",
			payload: {
				jobId: row.job_id,
				format: dbFormat,
				filter: filterJson,
			},
			resourceType: "compliance_export_job",
			resourceId: row.job_id,
			action: "create",
			outcome: "success",
		});

		return row;
	});

	// Post-commit SQS dispatch. If SendMessage fails, mark the job FAILED
	// so the listing UI surfaces the error rather than leaving a queued
	// job no runner will pick up.
	const sqs = getSqsClient();
	try {
		await sqs.send(
			new SendMessageCommand({
				QueueUrl: queueUrl,
				MessageBody: JSON.stringify({ jobId: insertedRow.job_id }),
			}),
		);
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		await db.execute(sql`
			UPDATE compliance.export_jobs
			   SET status = 'failed',
			       job_error = ${`SQS dispatch failed: ${message}`},
			       completed_at = now()
			 WHERE job_id = ${insertedRow.job_id}::uuid
			   AND status = 'queued'
		`);
		throw new GraphQLError(
			`Failed to queue export — SQS dispatch error: ${message}`,
			{ extensions: { code: "INTERNAL_SERVER_ERROR" } },
		);
	}

	return rowToGql(insertedRow);
}

// ---------------------------------------------------------------------------
// Query.complianceExports
// ---------------------------------------------------------------------------

const LIST_LIMIT = 50;

export async function complianceExports(
	_parent: unknown,
	_args: unknown,
	ctx: GraphQLContext,
): Promise<ReturnType<typeof rowToGql>[]> {
	const auth = await requireComplianceReader(ctx, undefined);

	// Mirror the complianceEvents shape: non-operators are scoped to
	// their tenant; operators see all rows unless they passed a
	// tenantId filter (which requireComplianceReader has already
	// captured into auth.effectiveTenantId).
	const tenantFilter = auth.effectiveTenantId;

	const result = (await db.execute(
		tenantFilter
			? sql`
				SELECT
					job_id::text AS job_id,
					tenant_id::text AS tenant_id,
					requested_by_actor_id::text AS requested_by_actor_id,
					filter,
					format,
					status,
					s3_key,
					presigned_url,
					presigned_url_expires_at::text AS presigned_url_expires_at,
					job_error,
					requested_at::text AS requested_at,
					started_at::text AS started_at,
					completed_at::text AS completed_at
				FROM compliance.export_jobs
				WHERE tenant_id = ${tenantFilter}::uuid
				ORDER BY requested_at DESC
				LIMIT ${LIST_LIMIT}
			`
			: sql`
				SELECT
					job_id::text AS job_id,
					tenant_id::text AS tenant_id,
					requested_by_actor_id::text AS requested_by_actor_id,
					filter,
					format,
					status,
					s3_key,
					presigned_url,
					presigned_url_expires_at::text AS presigned_url_expires_at,
					job_error,
					requested_at::text AS requested_at,
					started_at::text AS started_at,
					completed_at::text AS completed_at
				FROM compliance.export_jobs
				ORDER BY requested_at DESC
				LIMIT ${LIST_LIMIT}
			`,
	)) as unknown as { rows: ExportJobRow[] };

	return result.rows.map(rowToGql);
}
