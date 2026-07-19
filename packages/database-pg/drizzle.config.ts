import { defineConfig } from "drizzle-kit";

export const UNMANAGED_AUTH_ROLLBACK_TABLES = [
  "!workos_auth_bridges",
  "!workos_auth_sessions",
] as const;

/**
 * Drizzle Kit configuration for migrations and schema management.
 *
 * Uses a direct PostgreSQL connection (DATABASE_URL) because drizzle-kit
 * does not support the RDS Data API driver. Provide DATABASE_URL when
 * running migration commands:
 *
 *   DATABASE_URL="postgresql://user:pass@host:5432/thinkwork" pnpm db:push
 */
export default defineConfig({
  dialect: "postgresql",
  schema: "./src/schema/index.ts",
  out: "./drizzle",
  // These tables remain physically present until migration 0263 proves that
  // rollback is no longer required. They are deliberately absent from the
  // canonical schema, so push must neither drop them early nor recreate them
  // after retirement.
  tablesFilter: ["*", ...UNMANAGED_AUTH_ROLLBACK_TABLES],
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
});
