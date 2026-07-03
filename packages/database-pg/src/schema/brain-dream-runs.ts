/**
 * Dream-state audit ledger (THINK-133 U4, KTD-2).
 *
 * Every dream run stages a per-bank plan (what will merge / forget /
 * quarantine) into `brain_dream_actions` BEFORE mutating Hindsight, applies
 * the staged actions atomically per action, and marks them applied. The
 * plan→apply split is the crash-safety boundary: staging is re-runnable,
 * apply is guarded by per-action ledger state, so a crashed or retried run
 * resumes without double-deleting.
 *
 * Idempotency: `dedupe_key` is `{tenantId}:{bankId}:{bucket}` where the next
 * bucket is parsed forward from the prior run's key — never recomputed from
 * wall-clock (docs/solutions/logic-errors/compile-continuation-dedupe-bucket-
 * 2026-04-20.md).
 */

import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { tenants } from "./core";

export const brainDreamRunStatuses = [
  "planned",
  "applying",
  "applied",
  "failed",
  "skipped",
] as const;
export type BrainDreamRunStatus = (typeof brainDreamRunStatuses)[number];

export const brainDreamActionTypes = [
  "quarantine",
  "forget",
  "consolidate",
] as const;
export type BrainDreamActionType = (typeof brainDreamActionTypes)[number];

export const brainDreamActionStatuses = [
  "staged",
  "applied",
  "skipped",
] as const;
export type BrainDreamActionStatus = (typeof brainDreamActionStatuses)[number];

export const brainDreamRuns = pgTable(
  "brain_dream_runs",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    tenant_id: uuid("tenant_id")
      .references(() => tenants.id, { onDelete: "cascade" })
      .notNull(),
    bank_id: text("bank_id").notNull(),
    dedupe_key: text("dedupe_key").notNull(),
    status: text("status").notNull().default("planned"),
    /** Planned action counts by type, e.g. {"quarantine":3,"forget":8,"consolidate":1}. */
    planned_counts: jsonb("planned_counts"),
    /** Applied action counts by type; written as apply progresses. */
    applied_counts: jsonb("applied_counts"),
    error_message: text("error_message"),
    started_at: timestamp("started_at", { withTimezone: true }),
    finished_at: timestamp("finished_at", { withTimezone: true }),
    created_at: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    updated_at: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    uniqueIndex("brain_dream_runs_dedupe_key_uidx").on(table.dedupe_key),
    index("brain_dream_runs_tenant_bank_idx").on(
      table.tenant_id,
      table.bank_id,
      table.created_at,
    ),
    index("brain_dream_runs_tenant_status_idx").on(
      table.tenant_id,
      table.status,
    ),
    check(
      "brain_dream_runs_status_check",
      sql`status IN ('planned', 'applying', 'applied', 'failed', 'skipped')`,
    ),
  ],
);

export const brainDreamActions = pgTable(
  "brain_dream_actions",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    run_id: uuid("run_id")
      .references(() => brainDreamRuns.id, { onDelete: "cascade" })
      .notNull(),
    /** Apply order within the run: quarantine → forget → consolidate. */
    ordinal: integer("ordinal").notNull(),
    action_type: text("action_type").notNull(),
    status: text("status").notNull().default("staged"),
    /** Target refs: memory_unit ids / document ids the action mutates. */
    target: jsonb("target"),
    /** Human-auditable rationale ("junk meta-memory pattern: ..."). */
    reason: text("reason"),
    applied_at: timestamp("applied_at", { withTimezone: true }),
    error_message: text("error_message"),
    created_at: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    uniqueIndex("brain_dream_actions_run_ordinal_uidx").on(
      table.run_id,
      table.ordinal,
    ),
    index("brain_dream_actions_run_status_idx").on(table.run_id, table.status),
    check(
      "brain_dream_actions_type_check",
      sql`action_type IN ('quarantine', 'forget', 'consolidate')`,
    ),
    check(
      "brain_dream_actions_status_check",
      sql`status IN ('staged', 'applied', 'skipped')`,
    ),
  ],
);

export const brainDreamRunsRelations = relations(
  brainDreamRuns,
  ({ many }) => ({
    actions: many(brainDreamActions),
  }),
);

export const brainDreamActionsRelations = relations(
  brainDreamActions,
  ({ one }) => ({
    run: one(brainDreamRuns, {
      fields: [brainDreamActions.run_id],
      references: [brainDreamRuns.id],
    }),
  }),
);
