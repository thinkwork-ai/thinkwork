import { defineConfig } from "drizzle-kit";

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
	dbCredentials: {
		url: process.env.DATABASE_URL!,
	},
});
