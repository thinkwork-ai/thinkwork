/**
 * tenant_mcp_admin_keys — per-tenant Bearer tokens for the admin-ops MCP.
 *
 * See drizzle/0024_tenant_mcp_admin_keys.sql for the canonical DDL and
 * pre-migration invariants. This Drizzle schema mirrors that DDL but is
 * hand-rolled (not registered in meta/_journal.json) — apply via psql.
 */

import {
	pgTable,
	uuid,
	text,
	timestamp,
	uniqueIndex,
	index,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { tenants } from "./core.js";

export const tenantMcpAdminKeys = pgTable(
	"tenant_mcp_admin_keys",
	{
		id: uuid("id")
			.primaryKey()
			.default(sql`gen_random_uuid()`),
		tenant_id: uuid("tenant_id")
			.references(() => tenants.id, { onDelete: "cascade" })
			.notNull(),
		/** SHA-256 hex digest of the raw token; raw value never stored. */
		key_hash: text("key_hash").notNull(),
		/** Human label ("default", "ci", "ops-laptop-eric"). */
		name: text("name").notNull(),
		created_at: timestamp("created_at", { withTimezone: true })
			.notNull()
			.defaultNow(),
		/** Nullable for break-glass bootstrap via apikey. */
		created_by_user_id: uuid("created_by_user_id"),
		/** Bumped on successful auth; async, best-effort. */
		last_used_at: timestamp("last_used_at", { withTimezone: true }),
		/** Soft-delete; NULL = active. */
		revoked_at: timestamp("revoked_at", { withTimezone: true }),
	},
	(t) => ({
		uq_hash: uniqueIndex("uq_tenant_mcp_admin_keys_hash").on(t.key_hash),
		// Partial index is declared in the raw SQL migration (WHERE
		// revoked_at IS NULL). Drizzle's `.where(...)` on unique indexes has
		// versioned quirks; relying on the hand-rolled SQL keeps the source
		// of truth in one place (see drizzle/0024_*.sql).
		idx_tenant: index("idx_tenant_mcp_admin_keys_tenant").on(
			t.tenant_id,
			t.created_at,
		),
	}),
);
