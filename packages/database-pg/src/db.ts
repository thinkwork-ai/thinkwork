/**
 * Drizzle ORM client for PostgreSQL (Aurora or RDS).
 *
 * Uses the standard `pg` driver with a connection pool. Works with any
 * PostgreSQL-compatible database — Aurora Serverless v2, RDS, or local.
 *
 * Connection resolution:
 *   1. DATABASE_URL environment variable (preferred)
 *   2. Construct from DATABASE_HOST + DATABASE_SECRET_ARN (Lambda deploy)
 *
 * For Lambda: the pool is created eagerly with DATABASE_URL. The actual TCP
 * connection is lazy (pg.Pool connects on first query), so cold start is fast.
 */

import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";

import * as schema from "./schema/index";

const { Pool } = pg;

let _db: ReturnType<typeof drizzle<typeof schema>> | undefined;
let _pool: InstanceType<typeof Pool> | undefined;

/**
 * Build DATABASE_URL from environment variables.
 * Falls back to Secrets Manager resolution (async, called once on cold start).
 */
function buildDatabaseUrl(): string | null {
	if (process.env.DATABASE_URL) return process.env.DATABASE_URL;

	// Construct from individual components (set by Terraform)
	const host = process.env.DATABASE_HOST || process.env.DB_CLUSTER_ENDPOINT;
	const dbName = process.env.DATABASE_NAME || "thinkwork";
	const user = process.env.DATABASE_USER || "thinkwork_admin";
	const password = process.env.DATABASE_PASSWORD;
	const port = process.env.DATABASE_PORT || "5432";

	if (host && password) {
		return `postgresql://${user}:${encodeURIComponent(password)}@${host}:${port}/${dbName}?sslmode=no-verify`;
	}

	return null;
}

/**
 * Resolve DATABASE_URL from Secrets Manager (async, used when password not in env).
 */
async function resolveDatabaseUrlFromSecrets(): Promise<string> {
	const secretArn = process.env.DATABASE_SECRET_ARN;
	const host = process.env.DATABASE_HOST || process.env.DB_CLUSTER_ENDPOINT || "localhost";
	const dbName = process.env.DATABASE_NAME || "thinkwork";

	if (!secretArn) {
		throw new Error("Database not configured. Set DATABASE_URL or DATABASE_SECRET_ARN + DATABASE_HOST.");
	}

	const { SecretsManagerClient, GetSecretValueCommand } = await import("@aws-sdk/client-secrets-manager");
	const sm = new SecretsManagerClient({});
	const result = await sm.send(new GetSecretValueCommand({ SecretId: secretArn }));
	const secret = JSON.parse(result.SecretString || "{}");

	const user = secret.username || "thinkwork_admin";
	const pass = encodeURIComponent(secret.password || "");
	const resolvedHost = secret.host || host;
	const port = secret.port || 5432;

	return `postgresql://${user}:${pass}@${resolvedHost}:${port}/${dbName}?sslmode=no-verify`;
}

/**
 * Create a Drizzle client from a connection string.
 */
export function createDb(connectionString: string) {
	const pool = new Pool({
		connectionString,
		max: 1,
		idleTimeoutMillis: 120_000,
		connectionTimeoutMillis: 5_000,
	});
	_pool = pool;
	return drizzle(pool, { schema });
}

/**
 * Singleton Drizzle client — lazily initialised on first access.
 *
 * Synchronous when DATABASE_URL is available (common case in Lambda).
 * When only DATABASE_SECRET_ARN is set, the first getDb() call triggers
 * an async Secrets Manager fetch; subsequent calls return the cached client.
 */
export function getDb() {
	if (_db) return _db;

	const url = buildDatabaseUrl();
	if (url) {
		_db = createDb(url);
		return _db;
	}

	// Fallback: async resolution from Secrets Manager.
	// Create a proxy that queues operations until the real DB is ready.
	// This only happens on cold start when DATABASE_URL is not set.
	let resolving: Promise<ReturnType<typeof drizzle<typeof schema>>> | undefined;

	return new Proxy({} as ReturnType<typeof drizzle<typeof schema>>, {
		get(_target, prop) {
			if (_db) return (_db as any)[prop];

			if (!resolving) {
				resolving = resolveDatabaseUrlFromSecrets().then((resolvedUrl) => {
					_db = createDb(resolvedUrl);
					return _db;
				});
			}

			// Return a function that awaits the DB then calls the method
			return (...args: any[]) =>
				resolving!.then((db: any) => {
					const result = db[prop](...args);
					return result;
				});
		},
	});
}

export type Database = ReturnType<typeof drizzle<typeof schema>>;
