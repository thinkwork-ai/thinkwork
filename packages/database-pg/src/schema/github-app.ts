/**
 * GitHub App installation + webhook delivery tables.
 *
 * Lifted out of the removed code-factory.ts schema file. Consumed by
 * packages/api/src/handlers/github-app.ts (installations + delivery log).
 * The Code Factory product was retired 2026-05-24 (P1 cleanup), but these
 * two tables are kept because they're a generic GitHub App integration
 * surface, not Code-Factory-specific.
 */

import { pgTable, uuid, text, integer, timestamp, jsonb } from "drizzle-orm/pg-core";
import { relations, sql } from "drizzle-orm";
import { tenants } from "./core";

export const githubAppInstallations = pgTable("github_app_installations", {
	id: uuid("id")
		.primaryKey()
		.default(sql`gen_random_uuid()`),
	tenant_id: uuid("tenant_id")
		.references(() => tenants.id)
		.notNull(),
	installation_id: integer("installation_id").notNull().unique(),
	account_login: text("account_login").notNull(),
	account_type: text("account_type").notNull(),
	status: text("status").notNull().default("active"),
	permissions: jsonb("permissions"),
	created_at: timestamp("created_at", { withTimezone: true })
		.notNull()
		.default(sql`now()`),
	updated_at: timestamp("updated_at", { withTimezone: true })
		.notNull()
		.default(sql`now()`),
});

export const githubWebhookDeliveries = pgTable("github_webhook_deliveries", {
	id: uuid("id")
		.primaryKey()
		.default(sql`gen_random_uuid()`),
	tenant_id: uuid("tenant_id")
		.references(() => tenants.id)
		.notNull(),
	event_type: text("event_type").notNull(),
	delivery_id: text("delivery_id"),
	payload: jsonb("payload"),
	status: text("status").notNull().default("pending"),
	processed_at: timestamp("processed_at", { withTimezone: true }),
	error: text("error"),
	created_at: timestamp("created_at", { withTimezone: true })
		.notNull()
		.default(sql`now()`),
});

export const githubAppInstallationsRelations = relations(
	githubAppInstallations,
	({ one }) => ({
		tenant: one(tenants, {
			fields: [githubAppInstallations.tenant_id],
			references: [tenants.id],
		}),
	}),
);

export const githubWebhookDeliveriesRelations = relations(
	githubWebhookDeliveries,
	({ one }) => ({
		tenant: one(tenants, {
			fields: [githubWebhookDeliveries.tenant_id],
			references: [tenants.id],
		}),
	}),
);
