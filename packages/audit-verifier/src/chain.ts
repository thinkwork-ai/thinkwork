/**
 * --check-chain — per-tenant Aurora chain walk.
 *
 * For each tenant in scope, SELECT every audit_events row in
 * (recorded_at ASC, event_id ASC) order and assert that each row's
 * `prev_hash` equals the previous row's `event_hash`. The first row
 * must have `prev_hash = NULL` (genesis).
 *
 * `pg` is dynamically imported so anchor-only audits (the default
 * invocation) don't require auditors to install Postgres client deps.
 *
 * Per ce-doc-review F10: streams rows via `pg.Cursor` chunks instead
 * of loading 10M+ rows into memory. The chain walk is purely
 * sequential — only the previous row's `event_hash` ever needs to be
 * in memory.
 */

export interface ChainFailure {
	tenant_id: string;
	broken_at_event_id: string | null;
	reason: "prev_hash_mismatch" | "non_null_genesis" | "query_error";
	expected_prev_hash?: string | null;
	actual_prev_hash?: string | null;
}

export interface WalkOptions {
	dbUrl: string;
	/**
	 * Tenants to walk. Pass `"all"` to enumerate `SELECT DISTINCT
	 * tenant_id FROM compliance.audit_events` — important when the
	 * caller wants to catch tenants whose slices failed verification
	 * (and so wouldn't appear in any anchor-verification-derived set).
	 */
	tenants: string[] | "all";
}

interface ChainRow {
	event_id: string;
	event_hash: string;
	prev_hash: string | null;
}

const CHUNK_SIZE = 1000;

export async function walkTenantChain(
	opts: WalkOptions,
): Promise<ChainFailure[]> {
	const failures: ChainFailure[] = [];
	if (Array.isArray(opts.tenants) && opts.tenants.length === 0) {
		return failures;
	}

	// Lazy import — only loads pg if the auditor actually requested
	// chain checking. R3-friendly: anchor-only consumers never trigger
	// the require.
	const pgModule = (await import("pg")) as unknown as {
		default?: PgModuleShape;
	} & PgModuleShape;
	const pg: PgModuleShape = pgModule.default ?? pgModule;
	const Client = pg.Client;
	const Cursor = pg.Cursor;
	if (!Client || !Cursor) {
		throw new Error(
			"audit-verifier/chain: `pg` package is missing required exports (Client, Cursor). Install with `npm install pg pg-cursor` or use a recent pg version.",
		);
	}

	const client = new Client({ connectionString: opts.dbUrl });
	await client.connect();
	try {
		// Resolve `"all"` → SELECT DISTINCT tenant_id from audit_events.
		// This is the case where the caller doesn't know the tenant
		// universe up-front (e.g. multi-tenant audit run). We DO NOT
		// fall back to anchor-derived tenant sets because tenants
		// whose slices failed verification would be silently skipped —
		// exactly the tenants that most need a chain check.
		let tenants: string[];
		if (opts.tenants === "all") {
			const distinct = await runDistinctTenants(client);
			tenants = distinct;
		} else {
			tenants = opts.tenants;
		}
		for (const tenantId of tenants) {
			try {
				const cursor = client.query(
					new Cursor(
						`SELECT event_id::text AS event_id,
                                event_hash AS event_hash,
                                prev_hash AS prev_hash
                         FROM compliance.audit_events
                         WHERE tenant_id = $1::uuid
                         ORDER BY recorded_at ASC, event_id ASC`,
						[tenantId],
					),
				) as PgCursor;

				let isFirst = true;
				let lastEventHash: string | null = null;
				let broken = false;

				while (!broken) {
					const rows: ChainRow[] = await readChunk(cursor, CHUNK_SIZE);
					if (rows.length === 0) break;
					for (const row of rows) {
						if (isFirst) {
							if (row.prev_hash !== null) {
								failures.push({
									tenant_id: tenantId,
									broken_at_event_id: row.event_id,
									reason: "non_null_genesis",
									expected_prev_hash: null,
									actual_prev_hash: row.prev_hash,
								});
								broken = true;
								break;
							}
							isFirst = false;
						} else if (row.prev_hash !== lastEventHash) {
							failures.push({
								tenant_id: tenantId,
								broken_at_event_id: row.event_id,
								reason: "prev_hash_mismatch",
								expected_prev_hash: lastEventHash,
								actual_prev_hash: row.prev_hash,
							});
							broken = true;
							break;
						}
						lastEventHash = row.event_hash;
					}
				}

				await closeCursor(cursor);
			} catch (err) {
				failures.push({
					tenant_id: tenantId,
					broken_at_event_id: null,
					reason: "query_error",
					expected_prev_hash:
						err instanceof Error ? err.message : String(err),
				});
			}
		}
	} finally {
		await client.end();
	}

	return failures;
}

// ---------------------------------------------------------------------------
// Type shims for the lazy pg import (no static type info available).
// ---------------------------------------------------------------------------

interface PgModuleShape {
	Client?: PgClientCtor;
	Cursor?: PgCursorCtor;
}

type PgClientCtor = new (config: { connectionString: string }) => PgClient;

interface PgClient {
	connect(): Promise<void>;
	query(cursorOrText: PgCursor | string, values?: unknown[]): PgCursor | Promise<{ rows: unknown[] }>;
	end(): Promise<void>;
}

type PgCursorCtor = new (
	sql: string,
	values?: unknown[],
) => PgCursor;

interface PgCursor {
	read(rowCount: number, callback: (err: Error | null, rows: ChainRow[]) => void): void;
	close(callback: (err: Error | null) => void): void;
}

async function runDistinctTenants(client: PgClient): Promise<string[]> {
	const res = (await client.query(
		"SELECT DISTINCT tenant_id::text AS tenant_id FROM compliance.audit_events ORDER BY tenant_id ASC",
	)) as unknown as { rows: { tenant_id: string }[] };
	return res.rows.map((r) => r.tenant_id);
}

function readChunk(cursor: PgCursor, n: number): Promise<ChainRow[]> {
	return new Promise((resolve, reject) => {
		cursor.read(n, (err, rows) => {
			if (err) reject(err);
			else resolve(rows);
		});
	});
}

function closeCursor(cursor: PgCursor): Promise<void> {
	return new Promise((resolve, reject) => {
		cursor.close((err) => {
			if (err) reject(err);
			else resolve();
		});
	});
}
