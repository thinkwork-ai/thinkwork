import {
	pgTable,
	uuid,
	text,
	integer,
	timestamp,
	jsonb,
	uniqueIndex,
	index,
	check,
} from "drizzle-orm/pg-core";
import { relations, sql } from "drizzle-orm";
import { tenants } from "./core";

export const tenantEntityExternalRefs = pgTable(
	"tenant_entity_external_refs",
	{
		id: uuid("id")
			.primaryKey()
			.default(sql`gen_random_uuid()`),
		tenant_id: uuid("tenant_id")
			.references(() => tenants.id, { onDelete: "cascade" })
			.notNull(),
		source_kind: text("source_kind").notNull(),
		external_id: text("external_id"),
		source_payload: jsonb("source_payload"),
		as_of: timestamp("as_of", { withTimezone: true }).notNull(),
		ttl_seconds: integer("ttl_seconds").notNull(),
		created_at: timestamp("created_at", { withTimezone: true })
			.notNull()
			.default(sql`now()`),
		updated_at: timestamp("updated_at", { withTimezone: true })
			.notNull()
			.default(sql`now()`),
	},
	(table) => [
		uniqueIndex("uq_tenant_entity_external_refs_source")
			.on(table.tenant_id, table.source_kind, table.external_id)
			.where(sql`${table.external_id} IS NOT NULL`),
		index("idx_tenant_entity_external_refs_tenant_source").on(
			table.tenant_id,
			table.source_kind,
		),
		check(
			"tenant_entity_external_refs_kind_allowed",
			sql`${table.source_kind} IN ('erp_customer','crm_opportunity','erp_order','crm_person','support_case','bedrock_kb')`,
		),
		check(
			"tenant_entity_external_refs_ttl_positive",
			sql`${table.ttl_seconds} > 0`,
		),
	],
);

export const tenantEntityExternalRefsRelations = relations(
	tenantEntityExternalRefs,
	({ one }) => ({
		tenant: one(tenants, {
			fields: [tenantEntityExternalRefs.tenant_id],
			references: [tenants.id],
		}),
	}),
);
