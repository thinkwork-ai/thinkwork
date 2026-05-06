/**
 * Connector execution domain table: connector_executions.
 *
 * Each row tracks one connector-dispatched work item. The follow-up connector
 * chassis owns state transitions; U1 only declares the execution-row shape,
 * partial active-ref uniqueness, and downstream spend/kill surfaces.
 */

import {
	pgTable,
	uuid,
	text,
	integer,
	timestamp,
	jsonb,
	bigint,
	uniqueIndex,
	index,
	check,
} from "drizzle-orm/pg-core";
import { relations, sql } from "drizzle-orm";
import { tenants } from "./core";
import { connectors } from "./connectors";

export const connectorExecutions = pgTable(
	"connector_executions",
	{
		id: uuid("id")
			.primaryKey()
			.default(sql`gen_random_uuid()`),
		tenant_id: uuid("tenant_id")
			.references(() => tenants.id, { onDelete: "cascade" })
			.notNull(),
		connector_id: uuid("connector_id")
			.references(() => connectors.id, { onDelete: "restrict" })
			.notNull(),
		external_ref: text("external_ref").notNull(),
		current_state: text("current_state").notNull().default("pending"),
		spend_envelope_usd_cents: bigint("spend_envelope_usd_cents", {
			mode: "number",
		}),
		state_machine_arn: text("state_machine_arn"),
		started_at: timestamp("started_at", { withTimezone: true }),
		finished_at: timestamp("finished_at", { withTimezone: true }),
		error_class: text("error_class"),
		outcome_payload: jsonb("outcome_payload"),
		cost_finalized_at: timestamp("cost_finalized_at", {
			withTimezone: true,
		}),
		last_usage_event_at: timestamp("last_usage_event_at", {
			withTimezone: true,
		}),
		kill_target: text("kill_target"),
		kill_target_at: timestamp("kill_target_at", { withTimezone: true }),
		retry_attempt: integer("retry_attempt").notNull().default(0),
		created_at: timestamp("created_at", { withTimezone: true })
			.notNull()
			.default(sql`now()`),
	},
	(table) => [
		uniqueIndex("uq_connector_executions_active_external_ref")
			.on(table.connector_id, table.external_ref)
			.where(
				sql`${table.current_state} IN ('pending', 'dispatching', 'invoking', 'recording_result')`,
			),
		index("idx_connector_executions_tenant_state").on(
			table.tenant_id,
			table.current_state,
		),
		index("idx_connector_executions_connector_started").on(
			table.connector_id,
			table.started_at,
		),
		index("idx_connector_executions_state_machine_arn").on(
			table.state_machine_arn,
		),
		index("idx_connector_executions_external_ref").on(
			table.tenant_id,
			table.external_ref,
		),
		check(
			"connector_executions_current_state_enum",
			sql`${table.current_state} IN ('pending', 'dispatching', 'invoking', 'recording_result', 'terminal', 'failed', 'cancelled')`,
		),
		check(
			"connector_executions_kill_target_enum",
			sql`${table.kill_target} IS NULL OR ${table.kill_target} IN ('cooperative', 'hard')`,
		),
		check(
			"connector_executions_spend_envelope_nonnegative",
			sql`${table.spend_envelope_usd_cents} IS NULL OR ${table.spend_envelope_usd_cents} >= 0`,
		),
		check(
			"connector_executions_retry_attempt_nonnegative",
			sql`${table.retry_attempt} >= 0`,
		),
	],
);

export const connectorExecutionsRelations = relations(
	connectorExecutions,
	({ one }) => ({
		tenant: one(tenants, {
			fields: [connectorExecutions.tenant_id],
			references: [tenants.id],
		}),
		connector: one(connectors, {
			fields: [connectorExecutions.connector_id],
			references: [connectors.id],
		}),
	}),
);
