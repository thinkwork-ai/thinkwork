import { getDb } from "@thinkwork/database-pg";

// Re-export the singleton DB client for use by Lambda handlers
export const db = getDb();
export type { Database } from "@thinkwork/database-pg";
import type { Database as DatabaseType } from "@thinkwork/database-pg";

/** Drizzle transaction handle as passed to `db.transaction` callbacks. */
export type DatabaseTransaction = Parameters<
  Parameters<DatabaseType["transaction"]>[0]
>[0];
