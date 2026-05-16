/**
 * Evaluations domain tables: eval_test_cases, eval_runs, eval_results.
 *
 * v1 scope: dev-authored test cases scored by AWS Bedrock AgentCore Evaluations.
 * Built-in evaluators are pre-provisioned globally by AWS at
 * arn:aws:bedrock-agentcore:::evaluator/Builtin.* — we reference them by ID and
 * do not store evaluator configs here. Custom code-based evaluators (e.g. our
 * deterministic-assertions Lambda) are also referenced by AgentCore evaluator ID.
 *
 * Migration optionality: eval_results.evaluator_results is JSONB with a `source`
 * tag per entry, so additive scoring layers (Mastra, promptfoo) can be wired in
 * later without schema change.
 */

import {
	pgTable,
	uuid,
	text,
	integer,
	numeric,
	boolean,
	timestamp,
	jsonb,
	index,
} from "drizzle-orm/pg-core";
import { relations, sql } from "drizzle-orm";
import { tenants } from "./core";
import { agents } from "./agents";
import { agentTemplates } from "./agent-templates";
import { scheduledJobs } from "./scheduled-jobs";
import { computers } from "./computers";

// ---------------------------------------------------------------------------
// eval_test_cases — Studio-managed test definitions
// ---------------------------------------------------------------------------

export const evalTestCases = pgTable(
	"eval_test_cases",
	{
		id: uuid("id")
			.primaryKey()
			.default(sql`gen_random_uuid()`),
		tenant_id: uuid("tenant_id")
			.references(() => tenants.id)
			.notNull(),
		name: text("name").notNull(),
		category: text("category").notNull(), // free-form grouping label (e.g. "tool-safety", "red-team")
		query: text("query").notNull(), // user-facing prompt sent to the agent
		system_prompt: text("system_prompt"), // optional override for the agent's system prompt
		// agent_template_id: which agent template to instantiate as the
		// "agent under test" for this case. Different templates expose
		// different tool surfaces, so a test like "should refuse to web-
		// search" only makes sense against a template that lacks web search.
		// Null = use the run-level default (eval-runner falls back to a
		// generic test agent).
		agent_template_id: uuid("agent_template_id").references(() => agentTemplates.id),
		// assertions: deterministic checks evaluated by our custom code-based
		// AgentCore evaluator. Shape: [{ type: "contains" | "regex" | "equals" |
		// "json-path", value: string, ... }]
		assertions: jsonb("assertions").notNull().default(sql`'[]'::jsonb`),
		// agentcore_evaluator_ids: built-in or custom AgentCore evaluator IDs
		// to invoke per test (e.g. ["Builtin.Helpfulness", "Builtin.ToolSelectionAccuracy"])
		agentcore_evaluator_ids: text("agentcore_evaluator_ids")
			.array()
			.notNull()
			.default(sql`'{}'::text[]`),
		tags: text("tags").array().notNull().default(sql`'{}'::text[]`),
		enabled: boolean("enabled").notNull().default(true),
		source: text("source").notNull().default("manual"), // 'manual' | 'yaml-seed' | 'imported'
		created_at: timestamp("created_at", { withTimezone: true })
			.notNull()
			.default(sql`now()`),
		updated_at: timestamp("updated_at", { withTimezone: true })
			.notNull()
			.default(sql`now()`),
	},
	(table) => [
		index("idx_eval_test_cases_tenant_category").on(
			table.tenant_id,
			table.category,
		),
		index("idx_eval_test_cases_tenant_enabled").on(
			table.tenant_id,
			table.enabled,
		),
	],
);

// ---------------------------------------------------------------------------
// eval_runs — one per "Run Evaluation" invocation
// ---------------------------------------------------------------------------

export const evalRuns = pgTable(
	"eval_runs",
	{
		id: uuid("id")
			.primaryKey()
			.default(sql`gen_random_uuid()`),
		tenant_id: uuid("tenant_id")
			.references(() => tenants.id)
			.notNull(),
		agent_id: uuid("agent_id").references(() => agents.id),
		computer_id: uuid("computer_id").references(() => computers.id),
		// Run-level agent template — picked when the user clicks Run
		// Evaluation. Determines the workspace/tools/model the eval test
		// agent loads for every test case in this run, unless the test
		// case overrides via its own agent_template_id.
		agent_template_id: uuid("agent_template_id").references(() => agentTemplates.id),
		scheduled_job_id: uuid("scheduled_job_id").references(() => scheduledJobs.id, {
			onDelete: "set null",
		}),
		status: text("status").notNull().default("pending"), // 'pending' | 'running' | 'completed' | 'failed' | 'cancelled'
		model: text("model"), // model_id used for the agent under test (informational)
		categories: text("categories").array().notNull().default(sql`'{}'::text[]`),
		total_tests: integer("total_tests").notNull().default(0),
		passed: integer("passed").notNull().default(0),
		failed: integer("failed").notNull().default(0),
		// pass_rate: 0.0–1.0 fraction; null while pending/running
		pass_rate: numeric("pass_rate", { precision: 5, scale: 4 }),
		regression: boolean("regression").notNull().default(false),
		cost_usd: numeric("cost_usd", { precision: 12, scale: 6 }),
		error_message: text("error_message"),
		started_at: timestamp("started_at", { withTimezone: true }),
		completed_at: timestamp("completed_at", { withTimezone: true }),
		created_at: timestamp("created_at", { withTimezone: true })
			.notNull()
			.default(sql`now()`),
	},
	(table) => [
		index("idx_eval_runs_tenant_created").on(
			table.tenant_id,
			table.created_at,
		),
		index("idx_eval_runs_tenant_agent_created").on(
			table.tenant_id,
			table.agent_id,
			table.created_at,
		),
		index("idx_eval_runs_tenant_computer_created").on(
			table.tenant_id,
			table.computer_id,
			table.created_at,
		),
		index("idx_eval_runs_tenant_status").on(table.tenant_id, table.status),
		index("idx_eval_runs_scheduled_job_id").on(table.scheduled_job_id),
	],
);

// ---------------------------------------------------------------------------
// eval_results — per-test-case result within a run
// ---------------------------------------------------------------------------

export const evalResults = pgTable(
	"eval_results",
	{
		id: uuid("id")
			.primaryKey()
			.default(sql`gen_random_uuid()`),
		run_id: uuid("run_id")
			.references(() => evalRuns.id, { onDelete: "cascade" })
			.notNull(),
		test_case_id: uuid("test_case_id").references(() => evalTestCases.id),
		status: text("status").notNull(), // 'pass' | 'fail' | 'error'
		// score: 0.0–1.0 aggregated across evaluators; null if no scorer ran
		score: numeric("score", { precision: 5, scale: 4 }),
		duration_ms: integer("duration_ms"),
		// agent_session_id: stable session ID used to invoke the agent under test;
		// also the key for querying CloudWatch spans in the runner
		agent_session_id: text("agent_session_id"),
		input: text("input"), // the rendered prompt sent to the agent
		expected: text("expected"), // optional expected-answer text (informational)
		actual_output: text("actual_output"), // agent's final response
		// evaluator_results: array of per-evaluator scores. Shape:
		// [{ evaluator_id: "Builtin.Helpfulness", source: "agentcore" | "in_house",
		//    value: 0.85, label: "good", explanation: "...", token_usage: {...} }]
		// `source` is the migration-optionality hook for adding Mastra/promptfoo later.
		evaluator_results: jsonb("evaluator_results")
			.notNull()
			.default(sql`'[]'::jsonb`),
		// assertions: snapshot of which deterministic assertions passed/failed
		// (mirror of test_case assertions at run time, with pass/fail flag)
		assertions: jsonb("assertions").notNull().default(sql`'[]'::jsonb`),
		error_message: text("error_message"),
		created_at: timestamp("created_at", { withTimezone: true })
			.notNull()
			.default(sql`now()`),
	},
	(table) => [
		index("idx_eval_results_run").on(table.run_id),
		index("idx_eval_results_test_case_created").on(
			table.test_case_id,
			table.created_at,
		),
	],
);

// ---------------------------------------------------------------------------
// Relations
// ---------------------------------------------------------------------------

export const evalTestCasesRelations = relations(
	evalTestCases,
	({ one, many }) => ({
		tenant: one(tenants, {
			fields: [evalTestCases.tenant_id],
			references: [tenants.id],
		}),
		agentTemplate: one(agentTemplates, {
			fields: [evalTestCases.agent_template_id],
			references: [agentTemplates.id],
		}),
		results: many(evalResults),
	}),
);

export const evalRunsRelations = relations(evalRuns, ({ one, many }) => ({
	tenant: one(tenants, {
		fields: [evalRuns.tenant_id],
		references: [tenants.id],
	}),
	agent: one(agents, {
		fields: [evalRuns.agent_id],
		references: [agents.id],
	}),
	computer: one(computers, {
		fields: [evalRuns.computer_id],
		references: [computers.id],
	}),
	agentTemplate: one(agentTemplates, {
		fields: [evalRuns.agent_template_id],
		references: [agentTemplates.id],
	}),
	scheduledJob: one(scheduledJobs, {
		fields: [evalRuns.scheduled_job_id],
		references: [scheduledJobs.id],
	}),
	results: many(evalResults),
}));

export const evalResultsRelations = relations(evalResults, ({ one }) => ({
	run: one(evalRuns, {
		fields: [evalResults.run_id],
		references: [evalRuns.id],
	}),
	testCase: one(evalTestCases, {
		fields: [evalResults.test_case_id],
		references: [evalTestCases.id],
	}),
}));
