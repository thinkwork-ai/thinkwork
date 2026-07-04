/**
 * routine_repair_events — durable repair-ladder history for git_python
 * routines (deterministic routines v1). One row per repair-ladder event:
 * mechanical revert annotations, agent repair attempts (with the commit
 * they produced and the fixture-gate verdict), out-of-envelope pending
 * commits, and budget-exhaustion disables. Backs the visible repair log
 * (R12) and "who changed this" attribution (R15) alongside the repo
 * history itself.
 *
 * Plan: docs/plans/2026-07-03-004-feat-deterministic-routines-v1-plan.md
 * (U1, KTD-4/KTD-7).
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
import { routines } from "./routines";
import { routineExecutions } from "./routine-executions";

export const routineRepairEvents = pgTable(
  "routine_repair_events",
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
    // Execution that triggered this repair-ladder event. Nullable: budget
    // disables and pending-commit decisions aren't tied to a single run.
    execution_id: uuid("execution_id").references(() => routineExecutions.id),
    // What happened at this rung of the ladder.
    // retry — tier-0 mechanical retry
    // revert — tier-0 revert to last-validated SHA
    // repair_attempt — tier-1 agent commit, gate ran
    // pending_commit — out-of-envelope repair awaiting operator approval
    // disabled — budget circuit-breaker disabled the routine
    // infra_failure — classified infra failure (no budget burn)
    event_type: text("event_type").notNull(),
    // Thread / wakeup that carried the agent repair. Null for mechanical
    // tiers. Free-form ref (thread id or wakeup id) — the repair dispatch
    // stamps it so the repair log links back to the conversation.
    thread_ref: text("thread_ref"),
    // SHA transition this event describes (either side nullable — e.g. an
    // infra failure has no transition).
    from_sha: text("from_sha"),
    to_sha: text("to_sha"),
    // Fixture-gate verdict for repair_attempt events: green | red.
    gate_result: text("gate_result"),
    // R18 diff-envelope verdict for agent commits:
    // in_envelope | out_of_envelope.
    envelope_verdict: text("envelope_verdict"),
    // Repair attempts remaining for the UTC day AFTER this event.
    budget_snapshot: integer("budget_snapshot"),
    // Free-form detail (error summary, envelope violation description).
    detail_json: jsonb("detail_json"),
    created_at: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    index("idx_routine_repair_events_routine_created").on(
      table.routine_id,
      table.created_at,
    ),
    index("idx_routine_repair_events_tenant").on(table.tenant_id),
    check(
      "routine_repair_events_event_type_enum",
      sql`${table.event_type} IN ('retry', 'revert', 'repair_attempt', 'pending_commit', 'disabled', 'infra_failure')`,
    ),
  ],
);

export const routineRepairEventsRelations = relations(
  routineRepairEvents,
  ({ one }) => ({
    tenant: one(tenants, {
      fields: [routineRepairEvents.tenant_id],
      references: [tenants.id],
    }),
    routine: one(routines, {
      fields: [routineRepairEvents.routine_id],
      references: [routines.id],
    }),
    execution: one(routineExecutions, {
      fields: [routineRepairEvents.execution_id],
      references: [routineExecutions.id],
    }),
  }),
);
