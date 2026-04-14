/**
 * Webhooks domain tables: webhooks, webhook_idempotency.
 *
 * A webhook is an externally-triggered endpoint that dispatches work to an
 * agent (via wakeup queue) or routine (via routine-runner). Each webhook
 * gets a unique, cryptographically random token embedded in its URL.
 *
 * Execution records are stored in thread_turns (webhook_id FK).
 */

import {
	pgTable,
	uuid,
	text,
	integer,
	timestamp,
	jsonb,
	boolean,
	index,
	uniqueIndex,
} from "drizzle-orm/pg-core";
import { relations, sql } from "drizzle-orm";
import { tenants } from "./core";
import { agents } from "./agents";
import { routines } from "./routines";
import { connectProviders } from "./integrations";

// ---------------------------------------------------------------------------
// webhooks — webhook endpoint definitions
// ---------------------------------------------------------------------------

export const webhooks = pgTable(
	"webhooks",
	{
		id: uuid("id")
			.primaryKey()
			.default(sql`gen_random_uuid()`),
		tenant_id: uuid("tenant_id")
			.references(() => tenants.id)
			.notNull(),
		name: text("name").notNull(),
		description: text("description"),
		token: text("token").notNull(),
		target_type: text("target_type").notNull(), // agent | routine | task
		agent_id: uuid("agent_id").references(() => agents.id),
		routine_id: uuid("routine_id").references(() => routines.id),
		connect_provider_id: uuid("connect_provider_id").references(() => connectProviders.id),
		prompt: text("prompt"), // injected into agent context with payload
		config: jsonb("config"), // future: allowed_ips, headers_to_extract, etc.
		enabled: boolean("enabled").notNull().default(true),
		rate_limit: integer("rate_limit").default(60), // max invocations per minute
		last_invoked_at: timestamp("last_invoked_at", { withTimezone: true }),
		invocation_count: integer("invocation_count").notNull().default(0),
		created_by_type: text("created_by_type"), // system | user
		created_by_id: text("created_by_id"),
		created_at: timestamp("created_at", { withTimezone: true })
			.notNull()
			.default(sql`now()`),
		updated_at: timestamp("updated_at", { withTimezone: true })
			.notNull()
			.default(sql`now()`),
	},
	(table) => [
		uniqueIndex("idx_webhooks_token").on(table.token),
		index("idx_webhooks_tenant").on(table.tenant_id),
		index("idx_webhooks_tenant_enabled").on(table.tenant_id, table.enabled),
		index("idx_webhooks_provider_tenant").on(
			table.connect_provider_id,
			table.tenant_id,
		),
	],
);

// ---------------------------------------------------------------------------
// webhook_idempotency — deduplication for incoming webhook calls
// ---------------------------------------------------------------------------

export const webhookIdempotency = pgTable(
	"webhook_idempotency",
	{
		id: uuid("id")
			.primaryKey()
			.default(sql`gen_random_uuid()`),
		webhook_id: uuid("webhook_id")
			.references(() => webhooks.id, { onDelete: "cascade" })
			.notNull(),
		idempotency_key: text("idempotency_key").notNull(),
		turn_id: uuid("turn_id"), // FK to thread_turns
		created_at: timestamp("created_at", { withTimezone: true })
			.notNull()
			.default(sql`now()`),
	},
	(table) => [
		uniqueIndex("idx_webhook_idempotency_key").on(
			table.webhook_id,
			table.idempotency_key,
		),
	],
);

// ---------------------------------------------------------------------------
// Relations
// ---------------------------------------------------------------------------

export const webhooksRelations = relations(webhooks, ({ one }) => ({
	tenant: one(tenants, {
		fields: [webhooks.tenant_id],
		references: [tenants.id],
	}),
	agent: one(agents, {
		fields: [webhooks.agent_id],
		references: [agents.id],
	}),
	routine: one(routines, {
		fields: [webhooks.routine_id],
		references: [routines.id],
	}),
	connectProvider: one(connectProviders, {
		fields: [webhooks.connect_provider_id],
		references: [connectProviders.id],
	}),
}));

export const webhookIdempotencyRelations = relations(
	webhookIdempotency,
	({ one }) => ({
		webhook: one(webhooks, {
			fields: [webhookIdempotency.webhook_id],
			references: [webhooks.id],
		}),
	}),
);
