/**
 * Routine domain table: routines (definitions only).
 *
 * routine_runs, routine_steps, and routine_triggers have been removed —
 * replaced by trigger_runs / trigger_run_events / triggers (see scheduled-jobs.ts).
 *
 * Step Functions migration: as of plan 2026-05-01-004 (Routines Phase A),
 * each routine carries an `engine` partition (legacy_python | step_functions).
 * Step-functions-engine routines also have state_machine_arn, alias_arn,
 * documentation_md, and current_version columns. The legacy Python
 * `code` field still lives in `config: jsonb` on legacy_python rows;
 * those rows are archived in Phase E (U15) but not deleted.
 */

import {
  pgTable,
  uuid,
  text,
  integer,
  timestamp,
  jsonb,
  index,
  check,
} from "drizzle-orm/pg-core";
import { relations, sql } from "drizzle-orm";
import { tenants } from "./core";
import { agents } from "./agents";

// ---------------------------------------------------------------------------
// routines — routine definitions (code/config stays, scheduling moved to triggers)
// ---------------------------------------------------------------------------

export const routines = pgTable(
  "routines",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    tenant_id: uuid("tenant_id")
      .references(() => tenants.id)
      .notNull(),
    agent_id: uuid("agent_id").references(() => agents.id),
    name: text("name").notNull(),
    description: text("description"),
    type: text("type").notNull().default("scheduled"),
    status: text("status").notNull().default("active"),
    schedule: text("schedule"),
    config: jsonb("config"),
    // Engine partition. legacy_python rows pre-date Phase A; step_functions
    // rows are the new ASL-backed shape. CHECK constraint enforces the
    // enum at the DB layer so resolvers can filter without joining.
    engine: text("engine").notNull().default("legacy_python"),
    // Step Functions resource ARNs. Null for legacy_python routines.
    state_machine_arn: text("state_machine_arn"),
    state_machine_alias_arn: text("state_machine_alias_arn"),
    // Agent-authored markdown summary, regenerated on every publish.
    // Surfaced alongside the execution graph in the run UI.
    documentation_md: text("documentation_md"),
    // Pointer to the latest published version_number in routine_asl_versions.
    // Null for legacy_python; sequential starting at 1 for step_functions.
    current_version: integer("current_version"),
    // Visibility model (schema follow-up bundle): splits the conflated
    // agent_id field. visibility is 'agent_private' or 'tenant_shared';
    // owning_agent_id is the agent that authored the routine (separate
    // from agent_id, which is the primary execution agent). The MCP
    // routine_invoke tool reads these columns to enforce ownership.
    // Lower-snake enum values match the literals already baked into
    // admin-ops/checkRoutineVisibility.
    visibility: text("visibility").notNull().default("agent_private"),
    owning_agent_id: uuid("owning_agent_id").references(() => agents.id),
    // Stable pointer back to `tenant_workflow_catalog.slug` for routines
    // surfaced through the apps/web Customize page. Null for
    // user-authored routines that don't map to a catalog row.
    // Plan: docs/plans/2026-05-09-010-feat-customize-workflows-live-plan.md (U6-1).
    catalog_slug: text("catalog_slug"),
    // ---- git_python engine columns (deterministic routines v1) ----
    // Null on legacy_python / step_functions rows. Code lives only in the
    // tenant-configured GitHub repo (R1); these columns store identity and
    // pointers, never code. Plan: 2026-07-03-004 (U1, KTD-1/KTD-7/KTD-11).
    // Path of the Python module inside the tenant repo,
    // e.g. routines/<slug>/main.py.
    module_path: text("module_path"),
    // Repo paths of the routine's recorded fixture files (jsonb string[]).
    fixture_paths: jsonb("fixture_paths"),
    // Named tenant-credential ids this routine declares (jsonb string[]).
    // The executor resolves ONLY these at invoke time and injects them into
    // the sandbox session — no shared credential pool (R19).
    credential_refs: jsonb("credential_refs"),
    // Denormalized fast-path pointer to the last fixture-validated commit
    // SHA. routine_code_cache is authoritative; written only by the
    // fixture gate (KTD-7).
    validated_sha: text("validated_sha"),
    // Human-readable reason when the repair budget circuit-breaker (or an
    // operator) disabled the routine. Null while enabled.
    disabled_reason: text("disabled_reason"),
    last_run_at: timestamp("last_run_at", { withTimezone: true }),
    next_run_at: timestamp("next_run_at", { withTimezone: true }),
    created_at: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    updated_at: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    index("idx_routines_tenant_id").on(table.tenant_id),
    index("idx_routines_status").on(table.status),
    index("idx_routines_engine").on(table.engine),
    check(
      "routines_engine_enum",
      sql`${table.engine} IN ('legacy_python', 'step_functions', 'git_python')`,
    ),
    check(
      "routines_visibility_enum",
      sql`${table.visibility} IN ('agent_private', 'tenant_shared')`,
    ),
  ],
);

// ---------------------------------------------------------------------------
// Relations
// ---------------------------------------------------------------------------

export const routinesRelations = relations(routines, ({ one }) => ({
  tenant: one(tenants, {
    fields: [routines.tenant_id],
    references: [tenants.id],
  }),
  agent: one(agents, {
    fields: [routines.agent_id],
    references: [agents.id],
  }),
}));
