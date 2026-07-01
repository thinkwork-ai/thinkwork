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
    kind: text("kind").notNull().default("custom"), // 'baseline' | 'custom' | 'skill' (no CHECK — widened by app enum normalizeEvalDatasetKind)
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
    // quality_state: curation disposition (Eval Profiles U1/U7). Enum-by-CHECK
    // in 0197: 'active' | 'retired' | 'needs-revision'. Retired cases are
    // excluded from run-snapshot capture but keep their result history.
    // Seed re-sync propagates transitions one-way (never retired -> active).
    quality_state: text("quality_state").notNull().default("active"),
    // rewritten_from_id: dataset_case_id of the predecessor case when a
    // curation rewrite minted a new identity (R14). Null otherwise.
    rewritten_from_id: text("rewritten_from_id"),
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
// eval_profiles — the agent-under-test as a named, reusable configuration
// (Eval Profiles U1; CONCEPTS.md "Eval Profile").
//
// A profile bundles agent model + pinned judge model + trial count. Runs
// stamp profile_id at insert and pin the resolved profile_snapshot at
// dispatch, so later edits never reinterpret past runs. Exactly one
// default per tenant (partial unique index); the resolution seam
// synthesizes a default transactionally when none exists, so automatic
// consumers (skill-eval gate, scheduled runs) can never fail on a missing
// default. Profiles soft-archive (archived_at) — never hard-delete while
// runs reference them; archiving the current default is rejected.
// Distinct from the unrelated "Agent Profile" prompt presets.
// ---------------------------------------------------------------------------

export const evalProfiles = pgTable(
  "eval_profiles",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    tenant_id: uuid("tenant_id")
      .references(() => tenants.id)
      .notNull(),
    name: text("name").notNull(),
    // model: Bedrock model id of the agent under test. Validated against
    // the tenant model catalog at write time.
    model: text("model").notNull(),
    // judge_model: pinned LLM-judge model for llm-rubric scoring. Null =
    // the deployed default (EVAL_JUDGE_MODEL_ID). Threaded into scoring-
    // engine creation per run (KTD11) — the pin is enforced, not recorded.
    judge_model: text("judge_model"),
    // trials: per-case trial count applied to llm-rubric cases only
    // (deterministic-only cases always run once). CHECK (trials >= 1) in
    // 0197. Default 1; 3 recommended for comparison profiles.
    trials: integer("trials").notNull().default(1),
    is_default: boolean("is_default").notNull().default(false),
    archived_at: timestamp("archived_at", { withTimezone: true }),
    created_at: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    updated_at: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    uniqueIndex("uq_eval_profiles_tenant_name").on(table.tenant_id, table.name),
    uniqueIndex("uq_eval_profiles_tenant_default")
      .on(table.tenant_id)
      .where(sql`${table.is_default} = true`),
    index("idx_eval_profiles_tenant").on(table.tenant_id),
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
    // profile_id / profile_snapshot: the Eval Profile (agent-under-test
    // config) the run executed against. profile_id is stamped at run-row
    // insert; profile_snapshot (jsonb: { model, judgeModel, trials,
    // workspaceFingerprint }) is pinned at dispatch alongside
    // dataset_version so later profile edits never reinterpret past runs.
    // Both null on pre-profile runs, rendered "Legacy (pre-profile)".
    profile_id: uuid("profile_id").references(() => evalProfiles.id),
    profile_snapshot: jsonb("profile_snapshot"),
    // pinned_trial_plan: per-case trial counts pinned at dispatch —
    // [{ caseId, trials }] where caseId is the eval_test_cases row uuid
    // the fan-out messages carry (both dispatch paths). The reconciler
    // reconstructs expected trial rows from this immutable plan, never
    // from live assertions.
    pinned_trial_plan: jsonb("pinned_trial_plan"),
    // expected_result_rows: sum of the trial plan — the true fan-out count.
    // Completion checks read COALESCE(expected_result_rows, total_tests)
    // so pre-profile and in-flight runs keep finalizing. total_tests keeps
    // its case-count meaning for every existing reader.
    expected_result_rows: integer("expected_result_rows"),
    total_tests: integer("total_tests").notNull().default(0),
    passed: integer("passed").notNull().default(0),
    failed: integer("failed").notNull().default(0),
    // errored: count of status='error' result rows. Only written under
    // versioned scoring semantics (scoring_version >= 2); null on legacy
    // runs where errors stay folded into `failed`. Nullable, no default —
    // a null-errored discriminator must never be used to infer semantics.
    errored: integer("errored"),
    // unstable: count of unstable CASE verdicts (Eval Profiles U4, KTD4)
    // — scored trials splitting with no majority in the evals-core
    // trial-aggregation layer. Excluded from pass_rate and gate math
    // exactly like errors. Null on legacy runs and on runs finalized
    // before 0198 shipped. Hand-rolled migration 0198_eval_runs_unstable.
    unstable: integer("unstable"),
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
    // trial_index: which trial of the case this row is (0-based). Row
    // identity is (run_id, test_case_id, trial_index) — enforced at the
    // app layer (worker dedup check + advisory lock), matching the
    // existing convention of app-level identity on this table. Legacy
    // single-trial rows carry 0 via the column default.
    trial_index: integer("trial_index").notNull().default(0),
    // score: 0.0–1.0 aggregated across evaluators; null if no scorer ran
    score: numeric("score", { precision: 5, scale: 4 }),
    duration_ms: integer("duration_ms"),
    // Agent-turn telemetry (Eval Profiles U5). Token usage of the agent
    // invocation itself (not evaluator tokens), priced against the run's
    // snapshot model. Tokens without resolved catalog pricing record with
    // agent_cost_usd null — the summary marks cost partial, never zero.
    agent_input_tokens: integer("agent_input_tokens"),
    agent_output_tokens: integer("agent_output_tokens"),
    agent_cost_usd: numeric("agent_cost_usd", { precision: 12, scale: 6 }),
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
// eval_case_overrides — operator verdict override at CASE level
// (Eval Profiles KTD9).
//
// Multi-trial cases have no single eval_results row to carry an override:
// the case verdict (including 'unstable') exists only in the evals-core
// trial-aggregation layer above the per-trial rows. This table is that
// layer's override input — aggregation applies it LAST (effective case
// verdict = case override ?? aggregate). Same immutable-override shape as
// the row-level fields on eval_results; per-trial rows are never
// overridden individually. Row-level override_status remains the path for
// legacy/single-trial rows.
// ---------------------------------------------------------------------------

export const evalCaseOverrides = pgTable(
  "eval_case_overrides",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    run_id: uuid("run_id")
      .references(() => evalRuns.id, { onDelete: "cascade" })
      .notNull(),
    test_case_id: uuid("test_case_id")
      .references(() => evalTestCases.id)
      .notNull(),
    // override_status: 'pass' | 'fail' (enum-by-CHECK in 0197).
    override_status: text("override_status").notNull(),
    // overridden_by: authenticated caller identity (users.id), derived
    // server-side — never accepted as an argument.
    overridden_by: text("overridden_by"),
    overridden_at: timestamp("overridden_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    // override_reason: required non-empty audit note; overrides accumulate
    // as labeled data for rubric hardening.
    override_reason: text("override_reason").notNull(),
    created_at: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    uniqueIndex("uq_eval_case_overrides_run_case").on(
      table.run_id,
      table.test_case_id,
    ),
  ],
);

// ---------------------------------------------------------------------------
// eval_replay_tool_allowlist — per-tenant MCP tool OVERRIDE list for replay
// (Evaluations Trust Core U13 → reworked U14).
//
// Replay now DEFAULT-ALLOWS read-shaped MCP tools (classified by name via
// @thinkwork/evals-core classifyMcpToolAccess) and blocks write-shaped tools,
// so a flagged thread's read tools run automatically without operator setup.
// The outbound side-effect kill-list (email/web) stays blocked
// unconditionally. This table is the optional OVERRIDE layer:
//   * mode 'allow' — force-allow a tool the heuristic would block (e.g. a
//     trusted write).
//   * mode 'block' — force-block a tool the heuristic would allow (e.g.
//     suppress a read).
// Per-tool granularity — one row per (server_name, tool_name); toggling mode
// UPDATEs the existing row. (Name retained for migration continuity.)
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
    // mode: override direction (enum-by-comment) — 'allow' force-allows a
    // tool the heuristic blocks; 'block' force-blocks a tool the heuristic
    // allows. Existing (pre-U14) rows default to 'allow', matching their
    // prior force-allow meaning. Guarded by a CHECK constraint in 0164.
    mode: text("mode").notNull().default("allow"),
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
// eval_skill_gate — per-tenant skill-update gate threshold
// (Skill Tests & Evals U6).
//
// A skill UPDATE whose candidate version scores below this threshold is
// HELD: the workspace swap is deferred until an operator applies it once
// the candidate passes (or overrides). A row's PRESENCE = the gate is
// enabled for the tenant; no row = no gate (nothing blocks). Initial
// install is never gated; unrated skills (no bundled cases) are never
// gated. Per-tenant single threshold in v1 — tenant_id is the PRIMARY
// KEY, so a tenant carries at most one gate row (per-skill thresholds are
// deferred). Hand-rolled migration 0168_eval_skill_gate.sql.
// ---------------------------------------------------------------------------

export const evalSkillGate = pgTable("eval_skill_gate", {
  tenant_id: uuid("tenant_id")
    .primaryKey()
    .references(() => tenants.id),
  // threshold: fraction in [0, 1] (same scale as eval_runs.pass_rate).
  // Guarded by a CHECK (threshold >= 0 AND threshold <= 1) in 0166.
  threshold: numeric("threshold", { precision: 5, scale: 4 }).notNull(),
  created_at: timestamp("created_at", { withTimezone: true })
    .notNull()
    .default(sql`now()`),
  updated_at: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .default(sql`now()`),
});

// ---------------------------------------------------------------------------
// Relations
// ---------------------------------------------------------------------------

export const evalSkillGateRelations = relations(evalSkillGate, ({ one }) => ({
  tenant: one(tenants, {
    fields: [evalSkillGate.tenant_id],
    references: [tenants.id],
  }),
}));

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

export const evalProfilesRelations = relations(
  evalProfiles,
  ({ one, many }) => ({
    tenant: one(tenants, {
      fields: [evalProfiles.tenant_id],
      references: [tenants.id],
    }),
    runs: many(evalRuns),
  }),
);

export const evalCaseOverridesRelations = relations(
  evalCaseOverrides,
  ({ one }) => ({
    run: one(evalRuns, {
      fields: [evalCaseOverrides.run_id],
      references: [evalRuns.id],
    }),
    testCase: one(evalTestCases, {
      fields: [evalCaseOverrides.test_case_id],
      references: [evalTestCases.id],
    }),
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
  profile: one(evalProfiles, {
    fields: [evalRuns.profile_id],
    references: [evalProfiles.id],
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
