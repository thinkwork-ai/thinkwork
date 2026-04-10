import { getDb } from "@thinkwork/database-pg";

// Re-export the singleton DB client for use by Lambda handlers
export const db = getDb();
export type { Database } from "@thinkwork/database-pg";
