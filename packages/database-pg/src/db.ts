/**
 * Drizzle ORM client for Aurora Serverless v2 PostgreSQL.
 *
 * Uses the RDS Data API driver, which communicates over HTTPS and
 * doesn't require a direct TCP connection or VPC networking from
 * the caller (Lambda, ECS, etc.).
 *
 * Required environment variables (provided via SST resource linking):
 *   - DATABASE_CLUSTER_ARN: Aurora cluster ARN
 *   - DATABASE_SECRET_ARN:  Secrets Manager secret ARN for DB credentials
 *   - DATABASE_NAME:        Database name (defaults to "thinkwork")
 */

import { RDSDataClient } from "@aws-sdk/client-rds-data";
import { drizzle } from "drizzle-orm/aws-data-api/pg";

import * as schema from "./schema/index";

let _db: ReturnType<typeof createDb> | undefined;

/**
 * Create a Drizzle client backed by the RDS Data API.
 *
 * Accepts explicit config or falls back to environment variables.
 */
export function createDb(opts?: {
	resourceArn?: string;
	secretArn?: string;
	database?: string;
	client?: RDSDataClient;
}) {
	const resourceArn =
		opts?.resourceArn ?? process.env.DATABASE_CLUSTER_ARN;
	const secretArn =
		opts?.secretArn ?? process.env.DATABASE_SECRET_ARN;
	const database =
		opts?.database ?? process.env.DATABASE_NAME ?? "thinkwork";

	if (!resourceArn) {
		throw new Error(
			"DATABASE_CLUSTER_ARN is required (env or opts.resourceArn)",
		);
	}
	if (!secretArn) {
		throw new Error(
			"DATABASE_SECRET_ARN is required (env or opts.secretArn)",
		);
	}

	const rdsClient = opts?.client ?? new RDSDataClient({});

	return drizzle(rdsClient, {
		resourceArn,
		secretArn,
		database,
		schema,
	});
}

/**
 * Singleton Drizzle client — lazily initialised on first access.
 */
export function getDb() {
	if (!_db) {
		_db = createDb();
	}
	return _db;
}

export type Database = ReturnType<typeof createDb>;
