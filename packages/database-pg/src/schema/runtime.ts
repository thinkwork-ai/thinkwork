/**
 * Runtime domain: wakeup_requests.
 *
 * The original PRD-04/PRD-05 design also defined agent_runtime_state and
 * agent_task_sessions, but those tables were never written to by any
 * code path and were retired in PR #1690 alongside the broader agent_*
 * dead-table cleanup.
 */

import {
  pgTable,
  uuid,
  text,
  timestamp,
  jsonb,
  index,
} from "drizzle-orm/pg-core";
import { relations, sql } from "drizzle-orm";
import { tenants } from "./core";
import { agents } from "./agents";

// ---------------------------------------------------------------------------
// 6.12 — wakeup_requests
// ---------------------------------------------------------------------------

export const wakeupRequests = pgTable(
  "wakeup_requests",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    tenant_id: uuid("tenant_id")
      .references(() => tenants.id)
      .notNull(),
    agent_id: uuid("agent_id")
      .references(() => agents.id)
      .notNull(),
    reason: text("reason"),
    priority: text("priority").notNull().default("normal"),
    status: text("status").notNull().default("pending"),
    payload: jsonb("payload"),
    scheduled_for: timestamp("scheduled_for", { withTimezone: true }),
    processed_at: timestamp("processed_at", { withTimezone: true }),
    created_at: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    index("idx_wakeup_requests_status_scheduled").on(
      table.status,
      table.scheduled_for,
    ),
  ],
);

// ---------------------------------------------------------------------------
// Relations (for Drizzle query builder)
// ---------------------------------------------------------------------------

export const wakeupRequestsRelations = relations(wakeupRequests, ({ one }) => ({
  tenant: one(tenants, {
    fields: [wakeupRequests.tenant_id],
    references: [tenants.id],
  }),
  agent: one(agents, {
    fields: [wakeupRequests.agent_id],
    references: [agents.id],
  }),
}));
