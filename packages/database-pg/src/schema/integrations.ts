/**
 * Integration domain tables: connect_providers, connections, credentials.
 */

import {
	pgTable,
	uuid,
	text,
	timestamp,
	jsonb,
	boolean,
	index,
} from "drizzle-orm/pg-core";
import { relations, sql } from "drizzle-orm";
import { tenants, users } from "./core";

// ---------------------------------------------------------------------------
// 4.1 — connect_providers
// ---------------------------------------------------------------------------

export const connectProviders = pgTable("connect_providers", {
	id: uuid("id")
		.primaryKey()
		.default(sql`gen_random_uuid()`),
	name: text("name").notNull().unique(),
	display_name: text("display_name").notNull(),
	provider_type: text("provider_type").notNull(),
	auth_type: text("auth_type").notNull(),
	config: jsonb("config"),
	is_available: boolean("is_available").notNull().default(true),
	created_at: timestamp("created_at", { withTimezone: true })
		.notNull()
		.default(sql`now()`),
	updated_at: timestamp("updated_at", { withTimezone: true })
		.notNull()
		.default(sql`now()`),
});

// ---------------------------------------------------------------------------
// 4.2 — connections
// ---------------------------------------------------------------------------

export const connections = pgTable(
	"connections",
	{
		id: uuid("id")
			.primaryKey()
			.default(sql`gen_random_uuid()`),
		tenant_id: uuid("tenant_id")
			.references(() => tenants.id)
			.notNull(),
		user_id: uuid("user_id")
			.references(() => users.id)
			.notNull(),
		provider_id: uuid("provider_id")
			.references(() => connectProviders.id)
			.notNull(),
		status: text("status").notNull().default("active"),
		external_id: text("external_id"),
		metadata: jsonb("metadata"),
		connected_at: timestamp("connected_at", { withTimezone: true }),
		disconnected_at: timestamp("disconnected_at", { withTimezone: true }),
		created_at: timestamp("created_at", { withTimezone: true })
			.notNull()
			.default(sql`now()`),
		updated_at: timestamp("updated_at", { withTimezone: true })
			.notNull()
			.default(sql`now()`),
	},
	(table) => [
		index("idx_connections_tenant_provider").on(
			table.tenant_id,
			table.provider_id,
		),
	],
);

// ---------------------------------------------------------------------------
// 4.3 — credentials
// ---------------------------------------------------------------------------

export const credentials = pgTable("credentials", {
	id: uuid("id")
		.primaryKey()
		.default(sql`gen_random_uuid()`),
	connection_id: uuid("connection_id")
		.references(() => connections.id)
		.notNull(),
	tenant_id: uuid("tenant_id")
		.references(() => tenants.id)
		.notNull(),
	credential_type: text("credential_type").notNull(),
	encrypted_value: text("encrypted_value").notNull(),
	expires_at: timestamp("expires_at", { withTimezone: true }),
	created_at: timestamp("created_at", { withTimezone: true })
		.notNull()
		.default(sql`now()`),
	updated_at: timestamp("updated_at", { withTimezone: true })
		.notNull()
		.default(sql`now()`),
});

// ---------------------------------------------------------------------------
// Relations (for Drizzle query builder)
// ---------------------------------------------------------------------------

export const connectProvidersRelations = relations(
	connectProviders,
	({ many }) => ({
		connections: many(connections),
	}),
);

export const connectionsRelations = relations(connections, ({ one, many }) => ({
	tenant: one(tenants, {
		fields: [connections.tenant_id],
		references: [tenants.id],
	}),
	user: one(users, {
		fields: [connections.user_id],
		references: [users.id],
	}),
	provider: one(connectProviders, {
		fields: [connections.provider_id],
		references: [connectProviders.id],
	}),
	credentials: many(credentials),
}));

export const credentialsRelations = relations(credentials, ({ one }) => ({
	connection: one(connections, {
		fields: [credentials.connection_id],
		references: [connections.id],
	}),
	tenant: one(tenants, {
		fields: [credentials.tenant_id],
		references: [tenants.id],
	}),
}));

