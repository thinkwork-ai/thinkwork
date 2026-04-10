/**
 * Thread dependencies (PRD-09 §9.1): blocking relationships between threads.
 * A row means thread_id is blocked by blocked_by_thread_id.
 */

import {
	pgTable,
	uuid,
	timestamp,
	uniqueIndex,
	index,
} from "drizzle-orm/pg-core";
import { relations, sql } from "drizzle-orm";
import { tenants } from "./core";
import { threads } from "./threads";

export const threadDependencies = pgTable(
	"thread_dependencies",
	{
		id: uuid("id")
			.primaryKey()
			.default(sql`gen_random_uuid()`),
		tenant_id: uuid("tenant_id")
			.references(() => tenants.id)
			.notNull(),
		thread_id: uuid("thread_id")
			.references(() => threads.id, { onDelete: "cascade" })
			.notNull(),
		blocked_by_thread_id: uuid("blocked_by_thread_id")
			.references(() => threads.id, { onDelete: "cascade" })
			.notNull(),
		created_at: timestamp("created_at", { withTimezone: true })
			.notNull()
			.default(sql`now()`),
	},
	(table) => [
		uniqueIndex("uq_thread_dependency").on(
			table.thread_id,
			table.blocked_by_thread_id,
		),
		index("idx_thread_deps_thread").on(table.thread_id),
		index("idx_thread_deps_blocked_by").on(table.blocked_by_thread_id),
		index("idx_thread_deps_tenant").on(table.tenant_id),
	],
);

export const threadDependenciesRelations = relations(
	threadDependencies,
	({ one }) => ({
		tenant: one(tenants, {
			fields: [threadDependencies.tenant_id],
			references: [tenants.id],
		}),
		thread: one(threads, {
			fields: [threadDependencies.thread_id],
			references: [threads.id],
			relationName: "dependencyBlockedBy",
		}),
		blockedByThread: one(threads, {
			fields: [threadDependencies.blocked_by_thread_id],
			references: [threads.id],
			relationName: "dependencyBlocks",
		}),
	}),
);
