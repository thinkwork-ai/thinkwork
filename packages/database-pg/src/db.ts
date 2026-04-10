/**
 * Drizzle ORM client for PostgreSQL (Aurora or RDS).
 *
 * Uses the standard `pg` driver with a connection pool. Works with any
 * PostgreSQL-compatible database — Aurora Serverless v2, RDS, or local.
 *
 * Connection resolution (in order):
 *   1. DATABASE_URL environment variable (direct connection string)
 *   2. DATABASE_SECRET_ARN → Secrets Manager → construct URL from JSON secret
 *   3. Explicit opts passed to createDb()
 */

import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";

import * as schema from "./schema/index";

const { Pool } = pg;

let _pool: InstanceType<typeof Pool> | undefined;
let _db: ReturnType<typeof createDbSync> | undefined;

/**
 * Resolve the DATABASE_URL from environment or Secrets Manager.
 */
async function resolveDatabaseUrl(): Promise<string> {
	// 1. Direct DATABASE_URL
	if (process.env.DATABASE_URL) {
		return process.env.DATABASE_URL;
	}

	// 2. Resolve from Secrets Manager
	const secretArn = process.env.DATABASE_SECRET_ARN;
	const host = process.env.DATABASE_HOST || process.env.DB_CLUSTER_ENDPOINT;
	const dbName = process.env.DATABASE_NAME || "thinkwork";

	if (secretArn) {
		const { SecretsManagerClient, GetSecretValueCommand } = await import("@aws-sdk/client-secrets-manager");
		const sm = new SecretsManagerClient({});
		const result = await sm.send(new GetSecretValueCommand({ SecretId: secretArn }));
		const secret = JSON.parse(result.SecretString || "{}");

		const user = secret.username || "thinkwork_admin";
		const pass = encodeURIComponent(secret.password || "");
		const resolvedHost = secret.host || host || "localhost";
		const port = secret.port || 5432;

		return `postgresql://${user}:${pass}@${resolvedHost}:${port}/${dbName}?sslmode=no-verify`;
	}

	throw new Error(
		"Database connection not configured. Set DATABASE_URL or DATABASE_SECRET_ARN.",
	);
}

/**
 * Create a Drizzle client from an existing pg.Pool (synchronous).
 */
function createDbSync(pool: InstanceType<typeof Pool>) {
	return drizzle(pool, { schema });
}

/**
 * Create a Drizzle client. Resolves connection from env vars or Secrets Manager.
 */
export async function createDb(opts?: {
	connectionString?: string;
	pool?: InstanceType<typeof Pool>;
}) {
	if (opts?.pool) {
		return createDbSync(opts.pool);
	}

	const url = opts?.connectionString ?? await resolveDatabaseUrl();
	const pool = new Pool({
		connectionString: url,
		max: 1,           // Lambda: single connection per instance
		idleTimeoutMillis: 120_000,
		connectionTimeoutMillis: 5_000,
	});

	_pool = pool;
	return createDbSync(pool);
}

/**
 * Singleton Drizzle client — lazily initialised on first access.
 *
 * Note: This is now async. Callers that previously used the sync version
 * need to await it. In practice, most Lambda handlers already have an
 * async handler function.
 */
let _dbPromise: Promise<ReturnType<typeof createDbSync>> | undefined;

export function getDb() {
	if (!_db) {
		if (!_dbPromise) {
			_dbPromise = createDb().then((db) => {
				_db = db;
				return db;
			});
		}
		// Return a proxy that defers to the promise for backward compat
		// with sync callers. The first query will await the connection.
		return new Proxy({} as ReturnType<typeof createDbSync>, {
			get(_target, prop) {
				if (!_db) {
					// For common drizzle methods, return an async wrapper
					return (...args: any[]) => _dbPromise!.then((db: any) => db[prop](...args));
				}
				return (_db as any)[prop];
			},
		});
	}
	return _db;
}

export type Database = ReturnType<typeof createDbSync>;
