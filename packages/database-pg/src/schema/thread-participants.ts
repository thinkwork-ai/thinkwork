/**
 * Thread participants.
 *
 * Space-scoped threads can have many human and agent participants. This table
 * is intentionally separate from thread ownership/assignee fields so Space
 * membership, mention delivery, and assignment can evolve independently.
 */

import {
  pgTable,
  uuid,
  text,
  timestamp,
  uniqueIndex,
  index,
  check,
} from "drizzle-orm/pg-core";
import { relations, sql } from "drizzle-orm";
import { agents } from "./agents";
import { tenants, users } from "./core";
import { spaces } from "./spaces";
import { threads } from "./threads";

export const threadParticipants = pgTable(
  "thread_participants",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    tenant_id: uuid("tenant_id")
      .references(() => tenants.id, { onDelete: "cascade" })
      .notNull(),
    thread_id: uuid("thread_id")
      .references(() => threads.id, { onDelete: "cascade" })
      .notNull(),
    space_id: uuid("space_id")
      .references(() => spaces.id)
      .notNull(),
    participant_type: text("participant_type").notNull(),
    user_id: uuid("user_id").references(() => users.id, {
      onDelete: "cascade",
    }),
    agent_id: uuid("agent_id").references(() => agents.id, {
      onDelete: "cascade",
    }),
    role: text("role").notNull().default("member"),
    source: text("source").notNull().default("manual"),
    notification_preference: text("notification_preference")
      .notNull()
      .default("subscribed"),
    created_at: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    updated_at: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    uniqueIndex("uq_thread_participants_user")
      .on(table.tenant_id, table.thread_id, table.user_id)
      .where(sql`${table.user_id} IS NOT NULL`),
    uniqueIndex("uq_thread_participants_agent")
      .on(table.tenant_id, table.thread_id, table.agent_id)
      .where(sql`${table.agent_id} IS NOT NULL`),
    index("idx_thread_participants_thread").on(table.thread_id),
    index("idx_thread_participants_space").on(table.tenant_id, table.space_id),
    check(
      "thread_participants_type_allowed",
      sql`${table.participant_type} IN ('user','agent')`,
    ),
    check(
      "thread_participants_target_matches_type",
      sql`(
				(${table.participant_type} = 'user' AND ${table.user_id} IS NOT NULL AND ${table.agent_id} IS NULL)
				OR
				(${table.participant_type} = 'agent' AND ${table.agent_id} IS NOT NULL AND ${table.user_id} IS NULL)
			)`,
    ),
    check(
      "thread_participants_notification_preference_allowed",
      sql`${table.notification_preference} IN ('subscribed','mentions','muted')`,
    ),
  ],
);

export const threadParticipantsRelations = relations(
  threadParticipants,
  ({ one }) => ({
    tenant: one(tenants, {
      fields: [threadParticipants.tenant_id],
      references: [tenants.id],
    }),
    thread: one(threads, {
      fields: [threadParticipants.thread_id],
      references: [threads.id],
    }),
    space: one(spaces, {
      fields: [threadParticipants.space_id],
      references: [spaces.id],
    }),
    user: one(users, {
      fields: [threadParticipants.user_id],
      references: [users.id],
    }),
    agent: one(agents, {
      fields: [threadParticipants.agent_id],
      references: [agents.id],
    }),
  }),
);
