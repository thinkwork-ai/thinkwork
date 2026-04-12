/**
 * tenant_builtin_tools — per-tenant configuration for built-in agent tools
 * (e.g. web_search backed by Exa or SerpAPI).
 *
 * One row per (tenant, tool_slug). Disabled-by-default: a tool is only injected
 * into the Strands agent when a row exists with enabled=true. API keys live in
 * Secrets Manager, referenced by secret_ref.
 */

import {
	pgTable,
	uuid,
	text,
	timestamp,
	jsonb,
	boolean,
	uniqueIndex,
	index,
} from "drizzle-orm/pg-core";
import { relations, sql } from "drizzle-orm";
import { tenants } from "./core.js";

export const tenantBuiltinTools = pgTable(
	"tenant_builtin_tools",
	{
		id: uuid("id")
			.primaryKey()
			.default(sql`gen_random_uuid()`),
		tenant_id: uuid("tenant_id")
			.references(() => tenants.id)
			.notNull(),
		/** Matches the skill slug in packages/skill-catalog/<slug>/skill.yaml */
		tool_slug: text("tool_slug").notNull(),
		/** Provider identifier, e.g. "exa", "serpapi". Null for single-provider tools. */
		provider: text("provider"),
		enabled: boolean("enabled").notNull().default(false),
		/** Non-secret provider options (e.g. { numResults: 5 }) */
		config: jsonb("config"),
		/** Secrets Manager ARN: thinkwork/{stage}/tenant/{tenantId}/builtin/{toolSlug} */
		secret_ref: text("secret_ref"),
		/** Timestamp of last successful test() call */
		last_tested_at: timestamp("last_tested_at", { withTimezone: true }),
		created_at: timestamp("created_at", { withTimezone: true })
			.notNull()
			.default(sql`now()`),
		updated_at: timestamp("updated_at", { withTimezone: true })
			.notNull()
			.default(sql`now()`),
	},
	(table) => [
		uniqueIndex("uq_tenant_builtin_tools").on(table.tenant_id, table.tool_slug),
		index("idx_tenant_builtin_tools_tenant").on(table.tenant_id),
	],
);

export const tenantBuiltinToolsRelations = relations(
	tenantBuiltinTools,
	({ one }) => ({
		tenant: one(tenants, {
			fields: [tenantBuiltinTools.tenant_id],
			references: [tenants.id],
		}),
	}),
);
