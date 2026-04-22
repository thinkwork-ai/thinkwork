/**
 * mutation_idempotency — server-authoritative idempotency + replay cache
 * for admin-skill mutations.
 *
 * Each row represents one logical mutation attempt keyed by
 * (tenant, invoker, mutation_name, idempotency_key). The key is either
 * a recipe-step-level string supplied by the caller (e.g.
 * "onboard-foo-corp:create-agent:marco") or the SHA256 of the
 * canonicalized resolved inputs when the caller omits it.
 *
 * Unlike skill_runs (which uses a partial-on-status='running' unique
 * index so failed runs can be safely re-attempted), this table uses a
 * FULL unique index. A succeeded mutation's key MUST block a duplicate
 * retry and return the stored result; a re-attempt after failure is
 * only possible by passing a different key (e.g. the caller bumping
 * its recipe-step counter).
 *
 * Plan reference: docs/plans/2026-04-22-004-feat-thinkwork-admin-skill-plan.md
 * Unit 4. Applied via hand-rolled migration
 * `drizzle/0020_mutation_idempotency.sql` (see CLAUDE.md + Learning #6).
 */

import {
  pgTable,
  uuid,
  text,
  timestamp,
  jsonb,
  index,
  uniqueIndex,
  check,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { tenants } from "./core";

export const MUTATION_IDEMPOTENCY_STATUSES = [
  "pending",
  "succeeded",
  "failed",
] as const;
export type MutationIdempotencyStatus =
  (typeof MUTATION_IDEMPOTENCY_STATUSES)[number];

export const mutationIdempotency = pgTable(
  "mutation_idempotency",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    tenant_id: uuid("tenant_id")
      .references(() => tenants.id, { onDelete: "cascade" })
      .notNull(),
    // No FK to users — matches skill_runs.invoker_user_id. Service-auth
    // callers may assert principalIds whose users row is managed
    // elsewhere.
    invoker_user_id: uuid("invoker_user_id").notNull(),
    mutation_name: text("mutation_name").notNull(),
    idempotency_key: text("idempotency_key").notNull(),
    resolved_inputs_hash: text("resolved_inputs_hash").notNull(),
    status: text("status").notNull().default("pending"),
    result_json: jsonb("result_json"),
    failure_reason: text("failure_reason"),
    created_at: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    completed_at: timestamp("completed_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("uq_mutation_idempotency_key").on(
      table.tenant_id,
      table.invoker_user_id,
      table.mutation_name,
      table.idempotency_key,
    ),
    index("idx_mutation_idempotency_tenant_created").on(
      table.tenant_id,
      table.created_at,
    ),
    check("status_allowed", sql`status IN ('pending','succeeded','failed')`),
  ],
);

export type MutationIdempotency = typeof mutationIdempotency.$inferSelect;
export type NewMutationIdempotency = typeof mutationIdempotency.$inferInsert;
