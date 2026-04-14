/**
 * webhook_deliveries — durable record of every inbound webhook request.
 *
 * Populated by `packages/api/src/handlers/webhooks.ts` on every call to
 * `POST /webhooks/{token}`, regardless of target_type (agent / routine /
 * task) or outcome (ok / rate_limited / unresolved_token / invalid_body /
 * unverified / unresolved_connection / error). Each row is a single
 * INSERT at the end of the handler — build the working record as the
 * handler runs, then commit once in a try/catch so a logging failure
 * never masks the actual response.
 *
 * **PII-bearing table.** `body_preview` contains task titles, customer
 * names, and comment text from the source provider. Do not export to
 * analytics without masking. Retention is enforced by a scheduled
 * cleanup Lambda that deletes rows older than 90 days.
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
import { webhooks } from "./webhooks";
import { connectProviders } from "./integrations";

export const webhookDeliveries = pgTable(
	"webhook_deliveries",
	{
		id: uuid("id")
			.primaryKey()
			.default(sql`gen_random_uuid()`),

		// Routing — nullable because completely-unmatched requests (token
		// doesn't resolve to any webhook row) still get logged. SET NULL on
		// webhook delete so delivery history survives a connector hard-delete
		// — the audit trail is more valuable than referential integrity here.
		webhook_id: uuid("webhook_id").references(() => webhooks.id, {
			onDelete: "set null",
		}),
		tenant_id: uuid("tenant_id").references(() => tenants.id),
		target_type: text("target_type"), // agent | routine | task | null

		// For task-type webhooks, captured from the adapter's normalizeEvent.
		provider_id: uuid("provider_id").references(() => connectProviders.id),
		provider_name: text("provider_name"),
		provider_event_id: text("provider_event_id"),
		external_task_id: text("external_task_id"),
		provider_user_id: text("provider_user_id"),
		normalized_kind: text("normalized_kind"),

		// Request snapshot — sized for safety + privacy.
		received_at: timestamp("received_at", { withTimezone: true })
			.notNull()
			.default(sql`now()`),
		source_ip: text("source_ip"),
		body_preview: text("body_preview"), // first 8KB only
		body_sha256: text("body_sha256"),
		body_size_bytes: integer("body_size_bytes"),
		headers_safe: jsonb("headers_safe"), // whitelisted only — see redactHeaders
		signature_prefix: text("signature_prefix"), // first 16 chars, debug only

		// Pipeline state.
		// verified | invalid | missing | skipped_dev | not_required
		signature_status: text("signature_status").notNull(),
		// ok | unverified | unresolved_token | unresolved_connection
		//  | rate_limited | invalid_body | ignored | error
		resolution_status: text("resolution_status").notNull(),
		// NOT a FK — delivery rows must outlive thread deletion for audit.
		thread_id: uuid("thread_id"),
		thread_created: boolean("thread_created"),
		status_code: integer("status_code"),
		error_message: text("error_message"),
		duration_ms: integer("duration_ms"),

		retry_count: integer("retry_count").notNull().default(0),
		is_replay: boolean("is_replay").notNull().default(false),

		created_at: timestamp("created_at", { withTimezone: true })
			.notNull()
			.default(sql`now()`),
		updated_at: timestamp("updated_at", { withTimezone: true })
			.notNull()
			.default(sql`now()`),
	},
	(table) => [
		index("idx_webhook_deliveries_webhook_received").on(
			table.webhook_id,
			table.received_at,
		),
		index("idx_webhook_deliveries_tenant_received").on(
			table.tenant_id,
			table.received_at,
		),
		index("idx_webhook_deliveries_status").on(table.resolution_status),
		// Idempotency for providers that send a delivery id — partial unique
		// via raw SQL since drizzle doesn't yet expose .where() on index defs.
		uniqueIndex("uq_webhook_deliveries_provider_event")
			.on(table.provider_name, table.provider_event_id)
			.where(sql`provider_event_id IS NOT NULL`),
	],
);

export const webhookDeliveriesRelations = relations(
	webhookDeliveries,
	({ one }) => ({
		webhook: one(webhooks, {
			fields: [webhookDeliveries.webhook_id],
			references: [webhooks.id],
		}),
		tenant: one(tenants, {
			fields: [webhookDeliveries.tenant_id],
			references: [tenants.id],
		}),
		provider: one(connectProviders, {
			fields: [webhookDeliveries.provider_id],
			references: [connectProviders.id],
		}),
	}),
);
