/**
 * Tenant-shared credential vault.
 *
 * Secret values live in AWS Secrets Manager. This table stores tenant-scoped
 * metadata, lifecycle state, and derived runtime artifacts such as optional
 * EventBridge Connection ARNs for Step Functions HTTP Tasks.
 */

import {
	pgTable,
	uuid,
	text,
	timestamp,
	jsonb,
	uniqueIndex,
	index,
	check,
} from "drizzle-orm/pg-core";
import { relations, sql } from "drizzle-orm";
import { tenants, users } from "./core";

export const tenantCredentials = pgTable(
	"tenant_credentials",
	{
		id: uuid("id")
			.primaryKey()
			.default(sql`gen_random_uuid()`),
		tenant_id: uuid("tenant_id")
			.references(() => tenants.id)
			.notNull(),
		display_name: text("display_name").notNull(),
		slug: text("slug").notNull(),
		kind: text("kind").notNull(),
		status: text("status").notNull().default("active"),
		secret_ref: text("secret_ref").notNull(),
		eventbridge_connection_arn: text("eventbridge_connection_arn"),
		schema_json: jsonb("schema_json").notNull().default({}),
		metadata_json: jsonb("metadata_json").notNull().default({}),
		last_used_at: timestamp("last_used_at", { withTimezone: true }),
		last_validated_at: timestamp("last_validated_at", { withTimezone: true }),
		created_by_user_id: uuid("created_by_user_id").references(() => users.id),
		deleted_at: timestamp("deleted_at", { withTimezone: true }),
		created_at: timestamp("created_at", { withTimezone: true })
			.notNull()
			.default(sql`now()`),
		updated_at: timestamp("updated_at", { withTimezone: true })
			.notNull()
			.default(sql`now()`),
	},
	(table) => [
		uniqueIndex("uq_tenant_credentials_slug").on(table.tenant_id, table.slug),
		index("idx_tenant_credentials_tenant").on(table.tenant_id),
		index("idx_tenant_credentials_status").on(table.tenant_id, table.status),
		check(
			"tenant_credentials_kind_enum",
			sql`${table.kind} IN ('api_key','bearer_token','basic_auth','soap_partner','webhook_signing_secret','json')`,
		),
		check(
			"tenant_credentials_status_enum",
			sql`${table.status} IN ('active','disabled','deleted')`,
		),
	],
);

export const tenantCredentialsRelations = relations(
	tenantCredentials,
	({ one }) => ({
		tenant: one(tenants, {
			fields: [tenantCredentials.tenant_id],
			references: [tenants.id],
		}),
		createdByUser: one(users, {
			fields: [tenantCredentials.created_by_user_id],
			references: [users.id],
		}),
	}),
);
