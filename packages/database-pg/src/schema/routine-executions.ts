/**
 * Routine execution domain table: routine_executions.
 *
 * Each row tracks a single Step Functions execution of a Routine. The
 * source of truth for execution state is Step Functions itself
 * (DescribeExecution / GetExecutionHistory); this table mirrors what
 * ThinkWork needs to query without an AWS call (run list, status filters,
 * cumulative LLM cost, trigger source).
 *
 * Created pre-emptively at trigger time (status='running'); status is
 * flipped to terminal values by routine-execution-callback events fired
 * by EventBridge from Step Functions execution-state-change events.
 *
 * Distinct from thread_turns: routines are structurally multi-step with
 * native Step Functions history; thread_turns continues to record agent
 * loops. Plan: docs/plans/2026-05-01-004-feat-routines-phase-a-substrate-plan.md (U2).
 */

import {
	pgTable,
	uuid,
	text,
	timestamp,
	jsonb,
	bigint,
	index,
	uniqueIndex,
} from "drizzle-orm/pg-core";
import { relations, sql } from "drizzle-orm";
import { tenants } from "./core";
import { routines } from "./routines";
import { scheduledJobs } from "./scheduled-jobs";
import { routineAslVersions } from "./routine-asl-versions";

export const routineExecutions = pgTable(
	"routine_executions",
	{
		id: uuid("id")
			.primaryKey()
			.default(sql`gen_random_uuid()`),
		tenant_id: uuid("tenant_id")
			.references(() => tenants.id)
			.notNull(),
		routine_id: uuid("routine_id")
			.references(() => routines.id)
			.notNull(),
		// State Functions resource ARNs at the moment this execution started.
		// Captured for audit even if the routine is later edited or the alias
		// pointer-flips to a new version.
		state_machine_arn: text("state_machine_arn").notNull(),
		alias_arn: text("alias_arn"),
		version_arn: text("version_arn"),
		// Exact routine_asl_versions row used when this execution was started.
		// Nullable for pre-column rows and out-of-band executions; resolvers
		// fall back to version_arn matching in those cases.
		routine_asl_version_id: uuid("routine_asl_version_id").references(
			() => routineAslVersions.id,
		),
		// SFN execution ARN. Unique per execution; used to correlate
		// EventBridge state-change events back to this row.
		sfn_execution_arn: text("sfn_execution_arn").notNull(),
		// Optional FK to the scheduled_jobs row that triggered this run.
		// Null for manual / agent-tool / routine_invoke triggers.
		trigger_id: uuid("trigger_id").references(() => scheduledJobs.id),
		trigger_source: text("trigger_source").notNull(), // manual | schedule | webhook | event | agent_tool | routine_invoke
		input_json: jsonb("input_json"),
		output_json: jsonb("output_json"),
		status: text("status").notNull().default("running"), // running | succeeded | failed | cancelled | awaiting_approval | timed_out
		started_at: timestamp("started_at", { withTimezone: true }),
		finished_at: timestamp("finished_at", { withTimezone: true }),
		error_code: text("error_code"),
		error_message: text("error_message"),
		// Cumulative LLM cost across agent_invoke + python steps that called
		// models. Sum of routine_step_events.llm_cost_usd_cents.
		total_llm_cost_usd_cents: bigint("total_llm_cost_usd_cents", {
			mode: "number",
		}),
		created_at: timestamp("created_at", { withTimezone: true })
			.notNull()
			.default(sql`now()`),
	},
	(table) => [
		uniqueIndex("idx_routine_executions_sfn_arn").on(table.sfn_execution_arn),
		index("idx_routine_executions_tenant_status").on(
			table.tenant_id,
			table.status,
		),
		index("idx_routine_executions_routine_started").on(
			table.routine_id,
			table.started_at,
		),
		index("idx_routine_executions_asl_version").on(
			table.routine_asl_version_id,
		),
		index("idx_routine_executions_tenant_started").on(
			table.tenant_id,
			table.started_at,
		),
	],
);

export const routineExecutionsRelations = relations(
	routineExecutions,
	({ one }) => ({
		tenant: one(tenants, {
			fields: [routineExecutions.tenant_id],
			references: [tenants.id],
		}),
		routine: one(routines, {
			fields: [routineExecutions.routine_id],
			references: [routines.id],
		}),
		trigger: one(scheduledJobs, {
			fields: [routineExecutions.trigger_id],
			references: [scheduledJobs.id],
		}),
		aslVersion: one(routineAslVersions, {
			fields: [routineExecutions.routine_asl_version_id],
			references: [routineAslVersions.id],
		}),
	}),
);
