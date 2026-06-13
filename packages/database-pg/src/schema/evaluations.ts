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
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { relations, sql } from "drizzle-orm";
import { tenants } from "./core";
import { agents } from "./agents";
import { scheduledJobs, threadTurns } from "./scheduled-jobs";

// ---------------------------------------------------------------------------
// eval_datasets — derived index of the S3-canonical dataset artifacts
//
// S3 is canonical (tenants/<slug>/eval-datasets/<dataset-slug>/ in the
// workspace bucket); this table is a write-through projection synced by
// packages/api/src/lib/evals/dataset-store.ts and must stay fully
// reconstructible from S3 alone. Datasets soft-archive (archived_at) —
// never hard-delete while eval_test_cases / eval_results history
// references them.
// ---------------------------------------------------------------------------

export const evalDatasets = pgTable(
  "eval_datasets",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    tenant_id: uuid("tenant_id")
      .references(() => tenants.id)
      .notNull(),
    slug: text("slug").notNull(),
    name: text("name"),
    kind: text("kind").notNull().default("custom"), // 'baseline' | 'custom'
    // version: monotonically bumped on every dataset mutation; runs pin it.
    version: integer("version").notNull().default(1),
    // manifest_sha: sha256 of the S3 dataset.json content — the drift
    // detector recomputes from S3 on dataset read and re-syncs on mismatch.
    manifest_sha: text("manifest_sha"),
    archived_at: timestamp("archived_at", { withTimezone: true }),
    created_at: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    updated_at: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    uniqueIndex("uq_eval_datasets_tenant_slug").on(table.tenant_id, table.slug),
    index("idx_eval_datasets_tenant_created").on(
      table.tenant_id,
      table.created_at,
    ),
  ],
);

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
    // assertions: deterministic checks evaluated by our custom code-based
    // AgentCore evaluator. Shape: [{ type: "contains" | "regex" | "equals" |
    // "json-path", value: string, ... }]
    assertions: jsonb("assertions")
      .notNull()
      .default(sql`'[]'::jsonb`),
    // agentcore_evaluator_ids: built-in or custom AgentCore evaluator IDs
    // to invoke per test (e.g. ["Builtin.Helpfulness", "Builtin.ToolSelectionAccuracy"])
    agentcore_evaluator_ids: text("agentcore_evaluator_ids")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    tags: text("tags")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    enabled: boolean("enabled").notNull().default(true),
    source: text("source").notNull().default("manual"), // 'manual' | 'yaml-seed' | 'imported' | 'dataset'
    // dataset_id / dataset_case_id: linkage into the S3-canonical dataset
    // substrate (Evaluations Trust Core U4). Null on pre-dataset rows.
    // ON DELETE NO ACTION by design — datasets soft-archive, never hard
    // delete while result history references their cases. Case removal is
    // a manifest tombstone + enabled=false here, never a row delete.
    dataset_id: uuid("dataset_id").references(() => evalDatasets.id),
    dataset_case_id: text("dataset_case_id"),
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
    uniqueIndex("uq_eval_test_cases_dataset_case")
      .on(table.dataset_id, table.dataset_case_id)
      .where(sql`${table.dataset_id} IS NOT NULL`),
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
    computer_id: uuid("computer_id"),
    scheduled_job_id: uuid("scheduled_job_id").references(
      () => scheduledJobs.id,
      {
        onDelete: "set null",
      },
    ),
    status: text("status").notNull().default("pending"), // 'pending' | 'running' | 'completed' | 'failed' | 'cancelled'
    execution_target: text("execution_target").notNull().default("agentcore"), // 'agentcore' | 'desktop-pi'
    runtime_host: text("runtime_host").notNull().default("aws-agentcore"), // 'aws-agentcore' | 'desktop-local'
    model: text("model"), // model_id used for the agent under test (informational)
    categories: text("categories")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    selected_test_case_ids: uuid("selected_test_case_ids")
      .array()
      .notNull()
      .default(sql`'{}'::uuid[]`),
    // Run scope pinning (Trust Core U6). Dataset launches record the
    // dataset id at creation; the eval-runner pins dataset_version and
    // pinned_case_ids (the resolved dataset_case_ids) when it captures
    // the run snapshot, *before* fan-out. Case content is COPIED at
    // launch to the run snapshot prefix
    // tenants/<slug>/eval-datasets/.runs/<run-id>/ in S3 — workers never
    // read the live dataset prefix after launch. ON DELETE NO ACTION by
    // design: datasets soft-archive, never hard-delete while runs pin
    // them. All three null on legacy category/test-case launches.
    dataset_id: uuid("dataset_id").references(() => evalDatasets.id),
    dataset_version: integer("dataset_version"),
    pinned_case_ids: text("pinned_case_ids").array(),
    total_tests: integer("total_tests").notNull().default(0),
    passed: integer("passed").notNull().default(0),
    failed: integer("failed").notNull().default(0),
    // errored: count of status='error' result rows. Only written under
    // versioned scoring semantics (scoring_version >= 2); null on legacy
    // runs where errors stay folded into `failed`. Nullable, no default —
    // a null-errored discriminator must never be used to infer semantics.
    errored: integer("errored"),
    // scoring_version: scoring-semantics version stamped at run creation
    // (CURRENT_EVAL_SCORING_VERSION in @thinkwork/evals-core). Null =
    // legacy run (~v1: errors count as failed); legacy runs are labeled
    // in the API and never recomputed under new semantics.
    scoring_version: integer("scoring_version"),
    // summary_scoring_version: the semantics version the finalizing
    // summarizer actually computed under. Diverges from scoring_version
    // during a deploy window (old warm worker finalizes a new-stamped
    // run); the read path/reconciler recompute on divergence.
    summary_scoring_version: integer("summary_scoring_version"),
    // pass_rate: 0.0–1.0 fraction; null while pending/running. Under
    // scoring_version >= 2 also null on completed runs with no clean
    // scoreable execution (all-error / zero-case) — "no score", never 0%.
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
    index("idx_eval_runs_tenant_created").on(table.tenant_id, table.created_at),
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
    index("idx_eval_runs_tenant_execution_target_created").on(
      table.tenant_id,
      table.execution_target,
      table.created_at,
    ),
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
    // thread_turn_id: the thread turn this eval execution corresponds to.
    // Set when the test case carries workspace-projection assertions that
    // target a stored turn snapshot (plan 2026-06-12-002 U10, origin R17).
    // Direct eval sessions use synthetic session IDs that never join to
    // thread_turns, so the linkage is recorded explicitly here. NULL on
    // output-only eval rows and rows from before this column shipped.
    thread_turn_id: uuid("thread_turn_id").references(() => threadTurns.id, {
      onDelete: "set null",
    }),
    input: text("input"), // the rendered prompt sent to the agent
    // system_prompt: the composed system prompt the agent ran against
    // (workspace files + tool policy + attachment preamble). Captured from
    // Pi's `composed_system_prompt` response field so the result-detail UI
    // can show operators exactly what the LLM saw. Null on rows from runs
    // that completed before the Pi response shape carried this field.
    system_prompt: text("system_prompt"),
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
    assertions: jsonb("assertions")
      .notNull()
      .default(sql`'[]'::jsonb`),
    error_message: text("error_message"),
    // error_cause: why a status='error' row errored. Enum-by-comment:
    // 'timeout' | 'throttle' | 'evaluator_error' | 'reconciler' |
    // 'infra_other'. Null on pass/fail rows and on legacy error rows
    // written before this column existed.
    error_cause: text("error_cause"),
    // Operator verdict override (Trust Core U9). The override is a
    // SEPARATE field, never a mutation of `status` — the judge's
    // original verdict + rendered rubric stay immutable on this row
    // while aggregation reads the override last
    // (effective = override_status ?? status).
    // override_status: 'pass' | 'fail' (enum-by-comment); null = no
    // override. Only scored rows (status pass|fail) may carry one.
    override_status: text("override_status"),
    // overridden_by: authenticated caller identity (users.id), derived
    // server-side — never accepted as an argument.
    overridden_by: text("overridden_by"),
    overridden_at: timestamp("overridden_at", { withTimezone: true }),
    // override_reason: required non-empty audit note; overrides
    // accumulate as labeled data for rubric hardening.
    override_reason: text("override_reason"),
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
// eval_replay_tool_allowlist — per-tenant read-only MCP tool allowlist for
// replay (Evaluations Trust Core U13).
//
// Replay strips all MCP tools by default (mcp_configs undefined in
// buildEvalAgentCorePayload) so a flagged thread that needed an MCP tool
// degrades to "I can't access tools" and the quality eval tests nothing.
// This table is a DEFAULT-DENY allowlist: an MCP tool is restored on replay
// ONLY if an operator explicitly lists it here for the tenant. Mutating tools
// and the outbound side-effect kill-list (email/web) stay blocked
// unconditionally. Per-tool granularity — one row per (server_name, tool_name).
// ---------------------------------------------------------------------------

export const evalReplayToolAllowlist = pgTable(
  "eval_replay_tool_allowlist",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    tenant_id: uuid("tenant_id")
      .references(() => tenants.id)
      .notNull(),
    // server_name: the MCP server slug as it appears in
    // runtimeConfig.mcpConfigs[].name (e.g. "lastmile--crm").
    server_name: text("server_name").notNull(),
    // tool_name: the per-server tool the runtime exposes via the entry's
    // toolWhitelist (e.g. "opportunities_list").
    tool_name: text("tool_name").notNull(),
    created_at: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    uniqueIndex("uq_eval_replay_tool_allowlist_tenant_server_tool").on(
      table.tenant_id,
      table.server_name,
      table.tool_name,
    ),
    index("idx_eval_replay_tool_allowlist_tenant").on(table.tenant_id),
  ],
);

// ---------------------------------------------------------------------------
// Relations
// ---------------------------------------------------------------------------

export const evalReplayToolAllowlistRelations = relations(
  evalReplayToolAllowlist,
  ({ one }) => ({
    tenant: one(tenants, {
      fields: [evalReplayToolAllowlist.tenant_id],
      references: [tenants.id],
    }),
  }),
);

export const evalDatasetsRelations = relations(
  evalDatasets,
  ({ one, many }) => ({
    tenant: one(tenants, {
      fields: [evalDatasets.tenant_id],
      references: [tenants.id],
    }),
    testCases: many(evalTestCases),
  }),
);

export const evalTestCasesRelations = relations(
  evalTestCases,
  ({ one, many }) => ({
    tenant: one(tenants, {
      fields: [evalTestCases.tenant_id],
      references: [tenants.id],
    }),
    dataset: one(evalDatasets, {
      fields: [evalTestCases.dataset_id],
      references: [evalDatasets.id],
    }),
    results: many(evalResults),
  }),
);

export const evalRunsRelations = relations(evalRuns, ({ one, many }) => ({
  tenant: one(tenants, {
    fields: [evalRuns.tenant_id],
    references: [tenants.id],
  }),
  dataset: one(evalDatasets, {
    fields: [evalRuns.dataset_id],
    references: [evalDatasets.id],
  }),
  agent: one(agents, {
    fields: [evalRuns.agent_id],
    references: [agents.id],
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
  threadTurn: one(threadTurns, {
    fields: [evalResults.thread_turn_id],
    references: [threadTurns.id],
  }),
}));
