/**
 * Managed AgentCore Harness proof state.
 *
 * The selected proof strategy is fresh-per-turn. These tables therefore keep
 * canonical public ordering and durable turn/effect evidence without retaining
 * a reusable provider session or treating Harness state as authoritative.
 */

import {
  bigint,
  bigserial,
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
import { sql } from "drizzle-orm";
import { agents } from "./agents";
import { tenants, users } from "./core";
import { threadTurns } from "./scheduled-jobs";
import { threads } from "./threads";

export const harnessManagedThreadEnrollments = pgTable(
  "harness_managed_thread_enrollments",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    tenant_id: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    thread_id: uuid("thread_id")
      .notNull()
      .references(() => threads.id, { onDelete: "cascade" }),
    logical_agent_id: uuid("logical_agent_id")
      .notNull()
      .references(() => agents.id),
    trust_profile: text("trust_profile").notNull(),
    harness_arn: text("harness_arn").notNull(),
    qualifier: text("qualifier").notNull(),
    resolved_version: text("resolved_version").notNull(),
    session_strategy: text("session_strategy").notNull().default("fresh"),
    prior_runtime: text("prior_runtime").notNull(),
    status: text("status").notNull().default("active"),
    enrolled_by_user_id: uuid("enrolled_by_user_id")
      .notNull()
      .references(() => users.id),
    created_at: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    restored_at: timestamp("restored_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("uq_harness_enrollment_tenant_thread").on(
      table.tenant_id,
      table.thread_id,
    ),
    uniqueIndex("uq_harness_enrollment_active_profile")
      .on(table.tenant_id, table.trust_profile)
      .where(sql`${table.status} = 'active'`),
    check(
      "harness_enrollment_strategy_fresh",
      sql`${table.session_strategy} = 'fresh'`,
    ),
    check(
      "harness_enrollment_status_allowed",
      sql`${table.status} IN ('active','restoring','restored','failed')`,
    ),
  ],
);

export const threadPublicEvents = pgTable(
  "thread_public_events",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    tenant_id: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    thread_id: uuid("thread_id")
      .notNull()
      .references(() => threads.id, { onDelete: "cascade" }),
    source_kind: text("source_kind").notNull(),
    source_id: uuid("source_id").notNull(),
    source_version: text("source_version").notNull(),
    event_kind: text("event_kind").notNull(),
    canonical_digest: text("canonical_digest").notNull(),
    created_at: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    uniqueIndex("uq_thread_public_event_source_version").on(
      table.tenant_id,
      table.thread_id,
      table.source_kind,
      table.source_id,
      table.source_version,
    ),
    index("idx_thread_public_events_prefix").on(
      table.tenant_id,
      table.thread_id,
      table.id,
    ),
    check(
      "thread_public_events_source_kind_allowed",
      sql`${table.source_kind} IN ('message','message_artifact')`,
    ),
    check(
      "thread_public_events_event_kind_allowed",
      sql`${table.event_kind} IN ('insert','invalidate')`,
    ),
  ],
);

export const harnessParticipantSessions = pgTable(
  "harness_participant_sessions",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    tenant_id: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    enrollment_id: uuid("enrollment_id")
      .notNull()
      .references(() => harnessManagedThreadEnrollments.id, {
        onDelete: "cascade",
      }),
    thread_id: uuid("thread_id")
      .notNull()
      .references(() => threads.id, { onDelete: "cascade" }),
    participant_user_id: uuid("participant_user_id")
      .notNull()
      .references(() => users.id),
    turn_id: uuid("turn_id")
      .notNull()
      .references(() => threadTurns.id, { onDelete: "cascade" }),
    runtime_session_id: text("runtime_session_id").notNull(),
    generation: integer("generation").notNull().default(1),
    captured_high_water: bigint("captured_high_water", {
      mode: "number",
    }).notNull(),
    applied_high_water: bigint("applied_high_water", { mode: "number" }),
    qualifier: text("qualifier").notNull(),
    resolved_version: text("resolved_version").notNull(),
    base_fingerprint: text("base_fingerprint").notNull(),
    participant_fingerprint: text("participant_fingerprint").notNull(),
    state: text("state").notNull().default("allocated"),
    failure_reason: text("failure_reason"),
    created_at: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    started_at: timestamp("started_at", { withTimezone: true }),
    finished_at: timestamp("finished_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("uq_harness_participant_session_turn").on(
      table.tenant_id,
      table.turn_id,
    ),
    uniqueIndex("uq_harness_participant_runtime_session").on(
      table.runtime_session_id,
    ),
    index("idx_harness_participant_sessions_thread").on(
      table.tenant_id,
      table.thread_id,
      table.participant_user_id,
      table.created_at,
    ),
    check(
      "harness_participant_session_generation_one",
      sql`${table.generation} = 1`,
    ),
    check(
      "harness_participant_session_state_allowed",
      sql`${table.state} IN ('allocated','running','finalizing','completed','abandoned')`,
    ),
    check(
      "harness_participant_session_terminal_shape",
      sql`(${table.state} IN ('completed','abandoned') AND ${table.finished_at} IS NOT NULL) OR (${table.state} NOT IN ('completed','abandoned') AND ${table.finished_at} IS NULL)`,
    ),
  ],
);

export const harnessParticipantSessionEvents = pgTable(
  "harness_participant_session_events",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    tenant_id: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    session_id: uuid("session_id")
      .notNull()
      .references(() => harnessParticipantSessions.id, {
        onDelete: "cascade",
      }),
    turn_id: uuid("turn_id")
      .notNull()
      .references(() => threadTurns.id, { onDelete: "cascade" }),
    event_type: text("event_type").notNull(),
    from_state: text("from_state"),
    to_state: text("to_state").notNull(),
    reason_code: text("reason_code"),
    applied_high_water: bigint("applied_high_water", { mode: "number" }),
    evidence: jsonb("evidence"),
    created_at: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    index("idx_harness_session_events_session").on(table.session_id, table.id),
    check(
      "harness_session_events_to_state_allowed",
      sql`${table.to_state} IN ('allocated','running','finalizing','completed','abandoned')`,
    ),
  ],
);

export const harnessGovernedToolExecutions = pgTable(
  "harness_governed_tool_executions",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    tenant_id: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    turn_id: uuid("turn_id")
      .notNull()
      .references(() => threadTurns.id, { onDelete: "cascade" }),
    participant_user_id: uuid("participant_user_id")
      .notNull()
      .references(() => users.id),
    session_id: uuid("session_id")
      .notNull()
      .references(() => harnessParticipantSessions.id, {
        onDelete: "cascade",
      }),
    idempotency_key: text("idempotency_key").notNull(),
    audience: text("audience").notNull(),
    operation: text("operation").notNull(),
    tool_use_id: text("tool_use_id").notNull(),
    input_digest: text("input_digest").notNull(),
    state: text("state").notNull().default("claimed"),
    policy_decision_id: text("policy_decision_id"),
    credential_owner_alias: text("credential_owner_alias"),
    sanitized_result: jsonb("sanitized_result"),
    failure_reason: text("failure_reason"),
    claimed_at: timestamp("claimed_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    completed_at: timestamp("completed_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("uq_harness_governed_tool_idempotency").on(
      table.tenant_id,
      table.idempotency_key,
    ),
    index("idx_harness_governed_tool_turn").on(table.turn_id),
    check(
      "harness_governed_tool_state_allowed",
      sql`${table.state} IN ('claimed','completed','failed','ambiguous')`,
    ),
  ],
);

export const harnessDisclosureDecisions = pgTable(
  "harness_disclosure_decisions",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    tenant_id: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    participant_user_id: uuid("participant_user_id")
      .notNull()
      .references(() => users.id),
    thread_id: uuid("thread_id")
      .notNull()
      .references(() => threads.id, { onDelete: "cascade" }),
    turn_id: uuid("turn_id")
      .notNull()
      .references(() => threadTurns.id, { onDelete: "cascade" }),
    session_id: uuid("session_id")
      .notNull()
      .references(() => harnessParticipantSessions.id, {
        onDelete: "cascade",
      }),
    operation: text("operation").notNull(),
    projection_digest: text("projection_digest").notNull(),
    status: text("status").notNull(),
    reason_code: text("reason_code").notNull(),
    expires_at: timestamp("expires_at", { withTimezone: true }).notNull(),
    created_at: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    index("idx_harness_disclosure_turn").on(table.turn_id),
    check(
      "harness_disclosure_status_allowed",
      sql`${table.status} IN ('published','withheld','confirmation_required')`,
    ),
  ],
);
