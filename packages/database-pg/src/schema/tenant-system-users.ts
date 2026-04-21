/**
 * tenant_system_users — one stable system-actor uuid per tenant.
 *
 * Used as `skill_runs.invoker_user_id` for webhook-triggered composition runs
 * (Unit 8). The actor has no Cognito identity, no chat thread, no direct DB
 * mutation path outside `skill_runs`. Its compiled-in scope is "invoke a
 * composition via the webhook ingress path, nothing else" — the only code
 * that loads this row is the webhook `_shared.ts` helper.
 *
 * Lazy bootstrap: the first webhook request for a tenant inserts this row
 * (ON CONFLICT DO NOTHING on tenant_id). No admin-facing management UI in
 * v1; revocation is a manual DB op if a tenant's webhooks need to be cut off.
 */

import { pgTable, uuid, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { relations, sql } from "drizzle-orm";
import { tenants } from "./core";

export const tenantSystemUsers = pgTable(
	"tenant_system_users",
	{
		id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
		tenant_id: uuid("tenant_id")
			.references(() => tenants.id)
			.notNull(),
		created_at: timestamp("created_at", { withTimezone: true })
			.notNull()
			.default(sql`now()`),
	},
	(table) => [
		uniqueIndex("uq_tenant_system_users_tenant").on(table.tenant_id),
	],
);

export const tenantSystemUsersRelations = relations(
	tenantSystemUsers,
	({ one }) => ({
		tenant: one(tenants, {
			fields: [tenantSystemUsers.tenant_id],
			references: [tenants.id],
		}),
	}),
);

export type TenantSystemUser = typeof tenantSystemUsers.$inferSelect;
export type NewTenantSystemUser = typeof tenantSystemUsers.$inferInsert;
