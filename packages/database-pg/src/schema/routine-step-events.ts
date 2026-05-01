/**
 * Routine step events domain table: routine_step_events.
 *
 * High-volume append-only event log for each step state in a routine
 * execution. Captures the metadata Step Functions does not natively
 * carry: per-step LLM cost (for agent_invoke + python steps), python()
 * stdout/stderr S3 URIs + 4KB preview, retry counts, recipe type.
 *
 * Populated by routine-step-callback REST endpoint, which is hit by:
 *   - python() / resume / approval-callback Lambdas (direct callback)
 *   - EventBridge rule routing SFN state-change events for recipes that
 *     don't have a wrapper Lambda (notably agent_invoke via the
 *     aws-sdk:bedrockagentcore:invokeAgentRuntime direct integration).
 *
 * Idempotent on (execution_id, node_id, status, started_at) since
 * EventBridge can double-deliver. Plan:
 * docs/plans/2026-05-01-004-feat-routines-phase-a-substrate-plan.md (U2).
 */

import {
	pgTable,
	uuid,
	text,
	timestamp,
	jsonb,
	integer,
	bigint,
	bigserial,
	boolean,
	index,
} from "drizzle-orm/pg-core";
import { relations, sql } from "drizzle-orm";
import { tenants } from "./core";
import { routineExecutions } from "./routine-executions";

export const routineStepEvents = pgTable(
	"routine_step_events",
	{
		id: bigserial("id", { mode: "number" }).primaryKey(),
		tenant_id: uuid("tenant_id")
			.references(() => tenants.id)
			.notNull(),
		execution_id: uuid("execution_id")
			.references(() => routineExecutions.id)
			.notNull(),
		// ASL state name (e.g., "FetchOvernightEmails", "ClassifyEmail").
		// Stable per routine version.
		node_id: text("node_id").notNull(),
		// One of the v0 recipe ids: http_request | aurora_query |
		// transform_json | set_variable | slack_send | email_send |
		// inbox_approval | python | agent_invoke | tool_invoke |
		// routine_invoke | choice | wait | map | sequence | fail
		recipe_type: text("recipe_type").notNull(),
		status: text("status").notNull(), // running | succeeded | failed | cancelled | timed_out | awaiting_approval
		started_at: timestamp("started_at", { withTimezone: true }),
		finished_at: timestamp("finished_at", { withTimezone: true }),
		input_json: jsonb("input_json"),
		output_json: jsonb("output_json"),
		error_json: jsonb("error_json"),
		// LLM cost in USD cents. Set for agent_invoke + python steps that
		// invoked models; null for deterministic recipes.
		llm_cost_usd_cents: bigint("llm_cost_usd_cents", { mode: "number" }),
		retry_count: integer("retry_count").notNull().default(0),
		// python() stdout/stderr offload — full content in S3, 4KB preview
		// inline for fast UI render.
		stdout_s3_uri: text("stdout_s3_uri"),
		stderr_s3_uri: text("stderr_s3_uri"),
		stdout_preview: text("stdout_preview"),
		truncated: boolean("truncated").notNull().default(false),
		created_at: timestamp("created_at", { withTimezone: true })
			.notNull()
			.default(sql`now()`),
	},
	(table) => [
		index("idx_routine_step_events_execution").on(
			table.execution_id,
			table.started_at,
		),
		index("idx_routine_step_events_tenant_recipe").on(
			table.tenant_id,
			table.recipe_type,
		),
		index("idx_routine_step_events_python_dashboard").on(
			table.tenant_id,
			table.recipe_type,
			table.created_at,
		),
	],
);

export const routineStepEventsRelations = relations(
	routineStepEvents,
	({ one }) => ({
		tenant: one(tenants, {
			fields: [routineStepEvents.tenant_id],
			references: [tenants.id],
		}),
		execution: one(routineExecutions, {
			fields: [routineStepEvents.execution_id],
			references: [routineExecutions.id],
		}),
	}),
);
