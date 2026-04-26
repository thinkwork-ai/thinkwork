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
import { relations, sql } from "drizzle-orm";
import { tenants, users } from "./core";
import { agents } from "./agents";

export const ACTIVATION_LAYERS = [
  "rhythms",
  "decisions",
  "dependencies",
  "knowledge",
  "friction",
] as const;
export type ActivationLayer = (typeof ACTIVATION_LAYERS)[number];

export const ACTIVATION_SESSION_MODES = ["full", "refresh"] as const;
export type ActivationSessionMode = (typeof ACTIVATION_SESSION_MODES)[number];

export const ACTIVATION_SESSION_STATUSES = [
  "in_progress",
  "ready_for_review",
  "applied",
  "abandoned",
] as const;
export type ActivationSessionStatus =
  (typeof ACTIVATION_SESSION_STATUSES)[number];

export const ACTIVATION_OUTBOX_STATUSES = [
  "pending",
  "processing",
  "completed",
  "failed",
] as const;
export type ActivationOutboxStatus =
  (typeof ACTIVATION_OUTBOX_STATUSES)[number];

export const ACTIVATION_AUTOMATION_CANDIDATE_STATUSES = [
  "generated",
  "deferred",
  "dismissed",
] as const;
export type ActivationAutomationCandidateStatus =
  (typeof ACTIVATION_AUTOMATION_CANDIDATE_STATUSES)[number];

export const activationSessions = pgTable(
  "activation_sessions",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    user_id: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    tenant_id: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    mode: text("mode").notNull().default("full"),
    focus_layer: text("focus_layer"),
    current_layer: text("current_layer").notNull().default("rhythms"),
    layer_states: jsonb("layer_states")
      .notNull()
      .default(sql`'{}'::jsonb`),
    status: text("status").notNull().default("in_progress"),
    last_agent_message: text("last_agent_message"),
    last_apply_id: uuid("last_apply_id"),
    created_at: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    updated_at: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    last_active_at: timestamp("last_active_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    completed_at: timestamp("completed_at", { withTimezone: true }),
  },
  (table) => [
    index("idx_activation_sessions_user_status").on(
      table.user_id,
      table.status,
    ),
    index("idx_activation_sessions_tenant").on(table.tenant_id),
    uniqueIndex("uq_activation_sessions_user_in_progress")
      .on(table.user_id)
      .where(sql`status = 'in_progress'`),
    check("activation_session_mode_allowed", sql`mode IN ('full','refresh')`),
    check(
      "activation_session_status_allowed",
      sql`status IN ('in_progress','ready_for_review','applied','abandoned')`,
    ),
    check(
      "activation_refresh_requires_focus_layer",
      sql`mode <> 'refresh' OR focus_layer IS NOT NULL`,
    ),
  ],
);

export const activationSessionTurns = pgTable(
  "activation_session_turns",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    session_id: uuid("session_id")
      .notNull()
      .references(() => activationSessions.id, { onDelete: "cascade" }),
    layer_id: text("layer_id").notNull(),
    turn_index: integer("turn_index").notNull(),
    role: text("role").notNull(),
    content: text("content").notNull(),
    created_at: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    index("idx_activation_session_turns_session_order").on(
      table.session_id,
      table.turn_index,
    ),
    uniqueIndex("uq_activation_session_turns_order").on(
      table.session_id,
      table.turn_index,
    ),
    check("activation_turn_role_allowed", sql`role IN ('user','agent')`),
  ],
);

export const activationApplyOutbox = pgTable(
  "activation_apply_outbox",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    session_id: uuid("session_id")
      .notNull()
      .references(() => activationSessions.id, { onDelete: "cascade" }),
    item_type: text("item_type").notNull(),
    payload: jsonb("payload")
      .notNull()
      .default(sql`'{}'::jsonb`),
    status: text("status").notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    last_error: text("last_error"),
    created_at: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    updated_at: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    completed_at: timestamp("completed_at", { withTimezone: true }),
  },
  (table) => [
    index("idx_activation_apply_outbox_status_created").on(
      table.status,
      table.created_at,
    ),
    index("idx_activation_apply_outbox_session").on(table.session_id),
    check(
      "activation_apply_outbox_status_allowed",
      sql`status IN ('pending','processing','completed','failed')`,
    ),
    check(
      "activation_apply_outbox_item_type_allowed",
      sql`item_type IN ('user_md','memory_seed','wiki_seed')`,
    ),
  ],
);

export const activationAutomationCandidates = pgTable(
  "activation_automation_candidates",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    session_id: uuid("session_id")
      .notNull()
      .references(() => activationSessions.id, { onDelete: "cascade" }),
    tenant_id: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    user_id: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    source_layer: text("source_layer").notNull(),
    title: text("title").notNull(),
    summary: text("summary").notNull(),
    why_suggested: text("why_suggested"),
    target_type: text("target_type").notNull().default("agent"),
    target_agent_id: uuid("target_agent_id").references(() => agents.id),
    trigger_type: text("trigger_type").notNull().default("agent_scheduled"),
    schedule_type: text("schedule_type").notNull().default("cron"),
    schedule_expression: text("schedule_expression").notNull(),
    timezone: text("timezone").notNull().default("UTC"),
    prompt: text("prompt"),
    config: jsonb("config")
      .notNull()
      .default(sql`'{}'::jsonb`),
    status: text("status").notNull().default("generated"),
    cost_estimate: jsonb("cost_estimate")
      .notNull()
      .default(sql`'{}'::jsonb`),
    disclosure_version: text("disclosure_version")
      .notNull()
      .default("activation-automation-v1"),
    duplicate_key: text("duplicate_key").notNull(),
    created_at: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    updated_at: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    index("idx_activation_automation_candidates_session").on(table.session_id),
    index("idx_activation_automation_candidates_user_status").on(
      table.tenant_id,
      table.user_id,
      table.status,
    ),
    uniqueIndex("uq_activation_automation_candidates_active_duplicate")
      .on(table.tenant_id, table.user_id, table.duplicate_key)
      .where(sql`status = 'generated'`),
    check(
      "activation_automation_candidates_status_allowed",
      sql`status IN ('generated','deferred','dismissed')`,
    ),
    check(
      "activation_automation_candidates_target_allowed",
      sql`target_type = 'agent'`,
    ),
  ],
);

export const activationSessionsRelations = relations(
  activationSessions,
  ({ one, many }) => ({
    user: one(users, {
      fields: [activationSessions.user_id],
      references: [users.id],
    }),
    tenant: one(tenants, {
      fields: [activationSessions.tenant_id],
      references: [tenants.id],
    }),
    turns: many(activationSessionTurns),
    outboxItems: many(activationApplyOutbox),
    automationCandidates: many(activationAutomationCandidates),
  }),
);

export const activationSessionTurnsRelations = relations(
  activationSessionTurns,
  ({ one }) => ({
    session: one(activationSessions, {
      fields: [activationSessionTurns.session_id],
      references: [activationSessions.id],
    }),
  }),
);

export const activationApplyOutboxRelations = relations(
  activationApplyOutbox,
  ({ one }) => ({
    session: one(activationSessions, {
      fields: [activationApplyOutbox.session_id],
      references: [activationSessions.id],
    }),
  }),
);

export const activationAutomationCandidatesRelations = relations(
  activationAutomationCandidates,
  ({ one }) => ({
    session: one(activationSessions, {
      fields: [activationAutomationCandidates.session_id],
      references: [activationSessions.id],
    }),
    user: one(users, {
      fields: [activationAutomationCandidates.user_id],
      references: [users.id],
    }),
    tenant: one(tenants, {
      fields: [activationAutomationCandidates.tenant_id],
      references: [tenants.id],
    }),
    targetAgent: one(agents, {
      fields: [activationAutomationCandidates.target_agent_id],
      references: [agents.id],
    }),
  }),
);
