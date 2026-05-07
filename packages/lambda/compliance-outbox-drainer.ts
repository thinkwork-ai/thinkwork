/**
 * Compliance Outbox Drainer Lambda
 *
 * Single-writer (reserved-concurrency=1), EventBridge `rate(1 minute)`
 * scheduled Lambda that:
 *   1. Polls `compliance.audit_outbox` for un-drained, non-poison rows.
 *   2. Computes the per-tenant SHA-256 hash chain (`prev_hash` →
 *      `event_hash`) using the U3 helpers.
 *   3. Inserts each row into `compliance.audit_events` with `ON CONFLICT
 *      (outbox_id) DO NOTHING` (drainer-replay idempotency).
 *   4. Marks the outbox row drained.
 *
 * Connects to Aurora as `compliance_drainer` (per master plan Decision
 * #4 — least-privilege per-role secret). The role has SELECT/UPDATE on
 * `audit_outbox` + INSERT on `audit_events` + SELECT on
 * `actor_pseudonym` (per U2 GRANT matrix). Connection details resolve
 * via `DATABASE_SECRET_ARN` env var pointing at the drainer secret.
 *
 * Per-row processing happens in its own transaction so a poison row
 * (e.g., malformed payload that breaks canonicalization) doesn't roll
 * back already-processed rows in the same batch. Poison rows write
 * `audit_outbox.drainer_error` and are skipped on subsequent invocations.
 *
 * Plan: `docs/plans/2026-05-07-004-feat-compliance-u4-outbox-drainer-plan.md`
 * Master: `docs/plans/2026-05-06-011-feat-compliance-audit-event-log-plan.md`
 */

import { createHash } from "node:crypto";
import { createDb, type Database } from "@thinkwork/database-pg";
import {
	auditEvents,
	auditOutbox,
} from "@thinkwork/database-pg/schema";
import { and, desc, eq, isNull, sql } from "drizzle-orm";

// ---------------------------------------------------------------------------
// Hash chain helpers (mirror of packages/api/src/lib/compliance/hash-chain.ts)
//
// Inlined rather than imported from @thinkwork/api — packages/lambda
// doesn't depend on the API package and adding that dep for ~50 lines of
// pure functions isn't worth the coupling. The two implementations
// share a documented contract (sorted-key canonical JSON +
// SHA-256(prev || canonical)). If either drifts, hash chain
// verification (U9) breaks. Test coverage asserts the contract on both
// sides; mirroring this comment from job-trigger.ts:53-59.
// ---------------------------------------------------------------------------

const SET_LIKE_ARRAY_FIELDS = new Set([
	"control_ids",
	"payload_redacted_fields",
]);

interface HashableEnvelope {
	event_id: string;
	tenant_id: string;
	occurred_at: Date | string;
	actor: string;
	actor_type: string;
	source: string;
	event_type: string;
	resource_type: string | null;
	resource_id: string | null;
	action: string | null;
	outcome: string | null;
	request_id: string | null;
	thread_id: string | null;
	agent_id: string | null;
	payload: Record<string, unknown>;
	payload_schema_version: number;
	control_ids: string[];
	payload_redacted_fields: string[];
	payload_oversize_s3_key: string | null;
}

function canonicalize(value: unknown, parentKey: string | null): string {
	if (value === undefined || value === null) return "null";
	if (value instanceof Date) return JSON.stringify(value.toISOString());
	if (typeof value !== "object") return JSON.stringify(value);

	if (Array.isArray(value)) {
		const items =
			parentKey !== null && SET_LIKE_ARRAY_FIELDS.has(parentKey)
				? [...value]
						.map((v) => (typeof v === "string" ? v : String(v)))
						.sort()
				: value;
		return `[${items.map((v) => canonicalize(v, null)).join(",")}]`;
	}

	const obj = value as Record<string, unknown>;
	const keys = Object.keys(obj).sort();
	const entries = keys.map(
		(k) => `${JSON.stringify(k)}:${canonicalize(obj[k], k)}`,
	);
	return `{${entries.join(",")}}`;
}

function canonicalizeEvent(envelope: HashableEnvelope): string {
	return canonicalize(envelope, null);
}

function computeEventHash(canonical: string, prevHash: string): string {
	return createHash("sha256")
		.update(prevHash, "utf-8")
		.update(canonical, "utf-8")
		.digest("hex");
}

// ---------------------------------------------------------------------------
// Boot — env snapshot + connection cache
//
// Per `feedback_completion_callback_snapshot_pattern`: snapshot env at
// module load. The Lambda runtime sets these once per container; warm
// invocations reuse the same _db connection.
// ---------------------------------------------------------------------------

const BATCH_SIZE = parseInt(
	process.env.COMPLIANCE_DRAINER_BATCH_SIZE || "50",
	10,
);

let _db: Database | undefined;

async function getDrainerDb(): Promise<Database> {
	if (_db) return _db;
	const url = await resolveDrainerDatabaseUrl();
	_db = createDb(url);
	return _db;
}

/**
 * Build the drainer's DATABASE_URL from `compliance_drainer` Secrets
 * Manager credentials. Distinct from the master `getDb()` because the
 * drainer connects as a different role (compliance_drainer, not
 * thinkwork_admin) and cross-contaminating module-scope state would
 * be a footgun.
 */
async function resolveDrainerDatabaseUrl(): Promise<string> {
	if (process.env.COMPLIANCE_DRAINER_DATABASE_URL) {
		// Test override.
		return process.env.COMPLIANCE_DRAINER_DATABASE_URL;
	}

	const secretArn = process.env.COMPLIANCE_DRAINER_SECRET_ARN;
	if (!secretArn) {
		throw new Error(
			"compliance-outbox-drainer: COMPLIANCE_DRAINER_SECRET_ARN env var is required",
		);
	}

	const { SecretsManagerClient, GetSecretValueCommand } = await import(
		"@aws-sdk/client-secrets-manager"
	);
	const sm = new SecretsManagerClient({});
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

// ---------------------------------------------------------------------------
// Drainer logic — exported for testing
// ---------------------------------------------------------------------------

export interface DrainerResult {
	drained_count: number;
	error_count: number;
	oldest_age_ms: number | null;
	dispatched: true;
}

/**
 * Drain up to `batchSize` outbox rows.
 *
 * Single-row poll loop: each iteration BEGINs a transaction, SELECTs
 * one row with FOR UPDATE SKIP LOCKED, processes it, COMMITs. Loops
 * until SELECT returns 0 rows OR we've drained `batchSize` rows.
 *
 * Per-row failure isolation: poison rows write `drainer_error` in a
 * separate transaction (so the per-row failure doesn't cascade), and
 * the loop continues with the next row.
 */
export async function processOutboxBatch(
	db: Database,
	batchSize = BATCH_SIZE,
): Promise<DrainerResult> {
	let drained_count = 0;
	let error_count = 0;

	while (drained_count + error_count < batchSize) {
		const processed = await processNextRow(db);
		if (processed === "empty") break;
		if (processed === "drained") drained_count += 1;
		else error_count += 1;
	}

	const oldest_age_ms = await getOldestPendingAgeMs(db);
	return { drained_count, error_count, oldest_age_ms, dispatched: true };
}

type RowOutcome = "drained" | "errored" | "empty";

async function processNextRow(db: Database): Promise<RowOutcome> {
	let outcome: RowOutcome = "empty";

	try {
		await db.transaction(async (tx) => {
			// Single-row poll with FOR UPDATE SKIP LOCKED. The lock holds
			// for the duration of this transaction; once we COMMIT, the
			// outbox row's `drained_at` is set so subsequent polls skip
			// it via the WHERE clause.
			const rows = await tx
				.select()
				.from(auditOutbox)
				.where(
					and(
						isNull(auditOutbox.drained_at),
						isNull(auditOutbox.drainer_error),
					),
				)
				.orderBy(auditOutbox.enqueued_at)
				.limit(1)
				.for("update", { skipLocked: true });

			if (rows.length === 0) {
				outcome = "empty";
				return;
			}

			const row = rows[0];

			// Look up the tenant's chain head (latest event_hash for this
			// tenant_id by occurred_at). Genesis event has no predecessor;
			// pass "" to computeEventHash.
			const headRows = await tx
				.select({ event_hash: auditEvents.event_hash })
				.from(auditEvents)
				.where(eq(auditEvents.tenant_id, row.tenant_id))
				.orderBy(desc(auditEvents.occurred_at))
				.limit(1);

			const prevHash =
				headRows.length > 0 ? (headRows[0].event_hash ?? "") : "";

			// Build the hashable envelope. Field set matches HashableEnvelope.
			const envelope: HashableEnvelope = {
				event_id: row.event_id,
				tenant_id: row.tenant_id,
				occurred_at: row.occurred_at,
				actor: row.actor,
				actor_type: row.actor_type,
				source: row.source,
				event_type: row.event_type,
				resource_type: row.resource_type,
				resource_id: row.resource_id,
				action: row.action,
				outcome: row.outcome,
				request_id: row.request_id,
				thread_id: row.thread_id,
				agent_id: row.agent_id,
				payload: row.payload as Record<string, unknown>,
				payload_schema_version: row.payload_schema_version,
				control_ids: row.control_ids,
				payload_redacted_fields: row.payload_redacted_fields,
				payload_oversize_s3_key: row.payload_oversize_s3_key,
			};

			const canonical = canonicalizeEvent(envelope);
			const eventHash = computeEventHash(canonical, prevHash);

			// INSERT audit_events. ON CONFLICT (outbox_id) DO NOTHING is the
			// drainer-replay idempotency guarantee: if a previous invocation
			// crashed between this insert and the outbox UPDATE below, the
			// re-attempt no-ops here and the UPDATE retries cleanly.
			await tx
				.insert(auditEvents)
				.values({
					event_id: row.event_id,
					outbox_id: row.outbox_id,
					tenant_id: row.tenant_id,
					occurred_at: row.occurred_at,
					actor: row.actor,
					actor_type: row.actor_type,
					source: row.source,
					event_type: row.event_type,
					resource_type: row.resource_type,
					resource_id: row.resource_id,
					action: row.action,
					outcome: row.outcome,
					request_id: row.request_id,
					thread_id: row.thread_id,
					agent_id: row.agent_id,
					payload: row.payload,
					payload_schema_version: row.payload_schema_version,
					control_ids: row.control_ids,
					payload_redacted_fields: row.payload_redacted_fields,
					payload_oversize_s3_key: row.payload_oversize_s3_key,
					prev_hash: prevHash === "" ? null : prevHash,
					event_hash: eventHash,
				})
				.onConflictDoNothing({ target: auditOutbox.outbox_id });

			// Mark the outbox row drained.
			await tx
				.update(auditOutbox)
				.set({ drained_at: sql`now()` })
				.where(eq(auditOutbox.outbox_id, row.outbox_id));

			outcome = "drained";
		});
	} catch (err) {
		// Per-row error: record the error message on the outbox row so the
		// next invocation skips it. Use a fresh transaction so the original
		// transaction's rollback doesn't take this UPDATE with it.
		const errMessage = err instanceof Error ? err.message : String(err);
		const failingRow = await findFailingRow(db);
		if (failingRow) {
			await db
				.update(auditOutbox)
				.set({ drainer_error: errMessage.slice(0, 4096) })
				.where(eq(auditOutbox.outbox_id, failingRow.outbox_id));
			outcome = "errored";
			console.error(
				JSON.stringify({
					level: "error",
					msg: "compliance-drainer: poison row marked",
					outbox_id: failingRow.outbox_id,
					event_id: failingRow.event_id,
					tenant_id: failingRow.tenant_id,
					error: errMessage,
				}),
			);
		} else {
			// Re-throw if we can't even identify the failing row — the
			// failure is structural (DB unreachable, schema mismatch).
			throw err;
		}
	}

	return outcome;
}

/**
 * Look up the row that the failed transaction was attempting to drain.
 * Best-effort: returns the same row that processNextRow's poll would
 * have selected. Used only on the error path.
 */
async function findFailingRow(
	db: Database,
): Promise<{ outbox_id: string; event_id: string; tenant_id: string } | null> {
	const rows = await db
		.select({
			outbox_id: auditOutbox.outbox_id,
			event_id: auditOutbox.event_id,
			tenant_id: auditOutbox.tenant_id,
		})
		.from(auditOutbox)
		.where(
			and(
				isNull(auditOutbox.drained_at),
				isNull(auditOutbox.drainer_error),
			),
		)
		.orderBy(auditOutbox.enqueued_at)
		.limit(1);
	return rows[0] ?? null;
}

async function getOldestPendingAgeMs(db: Database): Promise<number | null> {
	const result = await db.execute(sql`
		SELECT EXTRACT(EPOCH FROM (NOW() - MIN(enqueued_at))) * 1000 AS age_ms
		FROM compliance.audit_outbox
		WHERE drained_at IS NULL AND drainer_error IS NULL
	`);
	const rows = result as unknown as Array<{ age_ms: number | null }>;
	const ageMs = rows[0]?.age_ms;
	if (ageMs === null || ageMs === undefined) return null;
	return Math.round(Number(ageMs));
}

// ---------------------------------------------------------------------------
// Lambda handler
// ---------------------------------------------------------------------------

export async function handler(): Promise<DrainerResult> {
	const db = await getDrainerDb();
	const result = await processOutboxBatch(db);

	// Smoke-pin: emit `dispatched: true` + counts so deploy smoke can
	// observe drainer activity without log filters
	// (per `feedback_smoke_pin_dispatch_status_in_response`).
	console.log(
		JSON.stringify({
			level: "info",
			msg: "compliance-drainer: batch complete",
			...result,
		}),
	);
	return result;
}
